import {z} from 'zod';
import {existsSync} from 'node:fs';
import {runProgramLoop,type LoopTrace} from './runtime';
import {sandboxDocument} from '@/app/components-registry/sandbox-contracts';
import {sandboxContextFiles} from '@/app/context-files/server';
import {connectorCallIsAutomatic} from '@/app/connectors/service';
import {api,output} from '@/app/api/ask/ai';
import {model} from '@/db/store';
import type {PageCode} from './page-code';
import type {CodeProgram} from '@/app/sandboxes/contracts';
import type {PageView} from './contracts';
import type {Agent} from '@/app/agents/runtime';

// Verification of a generated or revised web app before it is saved or proposed:
//  1. the backend program runs through the real step loop (writes and approval-gated calls
//     are skipped, not executed) and must end in a valid view;
//  2. a custom frontend is rendered in headless Chromium at desktop and phone widths with
//     the real bridge (pageTools.run reaches the draft backend), errors are collected,
//     scripted interactions run, and layout is measured;
//  3. a vision model reviews the screenshots against the user's request.
// Hard failures block; everything else is reported so the agent can polish.

const step=z.object({action:z.enum(['click','fill','select','press','wait']),selector:z.string().max(300).optional(),value:z.string().max(2000).optional(),ms:z.number().int().min(0).max(10000).optional()}).strict();
export const verifyTestsSchema=z.array(z.object({name:z.string().max(100).optional(),input:z.object({query:z.string().max(2000).optional(),values:z.record(z.unknown()).optional()}).strict().optional(),steps:z.array(step).max(12).optional(),expectText:z.array(z.string().min(1).max(200)).max(8).optional()}).strict()).max(6);
export type VerifyTests=z.infer<typeof verifyTestsSchema>;
export type VerifyTarget={request:string;title:string;program?:CodeProgram|null;templateId?:string;frontend?:PageCode|null;tests?:VerifyTests;pageId?:string};
type BackendRun={test:string;ok:boolean;rounds?:number;view?:Record<string,unknown>;error?:string;toolErrors:string[];skipped:number};
type ViewportCheck={viewport:string;ok:boolean;errors:string[];bridgeErrors:string[];textChars:number;horizontalOverflow:boolean;contentHeight:number;brokenImages:number;unlabeledControls:number;tinyText:number;test?:string;missingText?:string[]};
export type VerifyReport={passed:boolean;blocking:string[];warnings:string[];backend:BackendRun[];frontend:ViewportCheck[];review?:{verdict:string;summary:string;issues:{severity:string;area?:string;problem:string;fix?:string}[]};logic?:{verdict:string;summary:string;issues:{severity:string;problem:string;fix?:string}[]};durationMs:number};

const chromiumPath=()=>[process.env.CHROMIUM_PATH,'/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome'].find(p=>p&&existsSync(p));
export const frontendVerificationAvailable=()=>!!chromiumPath();
let browsers=0;const waiting:(()=>void)[]=[];
async function slot(){if(browsers>=2)await new Promise<void>(r=>waiting.push(r));browsers++;}
function release(){browsers--;waiting.shift()?.();}

const summarizeView=(v:PageView)=>({templateId:v.templateId,title:v.title,summary:v.summary.slice(0,300),bodyChars:(v.body||'').length,body:(v.body||'').slice(0,600),reply:(v.reply||'').slice(0,300),results:Array.isArray((v as any).results)?(v as any).results.length:undefined,files:Array.isArray(v.files)?v.files.length:undefined,datasetRows:(v as any).dataset?.rows?.length,chart:!!v.chart,form:!!(v as any).form,map:!!(v as any).map});
const emptyView=(v:PageView)=>!(v.body||'').trim()&&!(v.reply||'').trim()&&!(v as any).results?.length&&!v.files?.length&&!(v as any).dataset?.rows?.length&&!(v as any).form&&!(v as any).map;
const traceIssues=(trace:LoopTrace)=>({toolErrors:trace.filter(t=>t.error).map(t=>t.tool+' '+t.id+': '+t.error).slice(0,8),skipped:trace.filter(t=>t.skipped).length});

export async function verifyApp(target:VerifyTarget,ctx:{userId:string;agent?:Agent;signal?:AbortSignal}):Promise<VerifyReport>{
 const started=Date.now(),report:VerifyReport={passed:false,blocking:[],warnings:[],backend:[],frontend:[],durationMs:0};
 const tests=target.tests?.length?target.tests:[{name:'first load',input:{query:target.request,values:{}}}];
 const uploads=target.pageId?await sandboxContextFiles(target.pageId,ctx.userId).catch(()=>({metadata:[],uploads:[]})):{metadata:[],uploads:[]};
 const logicRuns:{test:string;input:unknown;trace:LoopTrace;view:PageView}[]=[];
 const runBackend=async(query:string,values:Record<string,unknown>,extra:Record<string,unknown>={})=>runProgramLoop(target.program,{query,values,...extra,files:uploads.metadata},ctx.userId,target.pageId||'',uploads.uploads,{verification:true,signal:ctx.signal});
 // 1. Backend
 if(target.program){
  for(const test of tests.filter(t=>t.input||!t.steps).slice(0,4)){
   const name=test.name||'test';
   try{const r=await runBackend(test.input?.query??target.request,test.input?.values||{}),issues=traceIssues(r.trace);
    report.backend.push({test:name,ok:true,rounds:r.rounds,view:summarizeView(r.view),...issues});logicRuns.push({test:name,input:test.input||{},trace:r.trace,view:r.view});
    if(target.templateId&&r.view.templateId!==target.templateId)report.warnings.push(`Backend (${name}) returned templateId ${r.view.templateId} but the app declares ${target.templateId}.`);
    if(emptyView(r.view))report.warnings.push(`Backend (${name}) returned a view with no body, reply, results, files, data, form or map; readers would see an empty page.`);
    if(issues.toolErrors.length)report.warnings.push(`Backend (${name}) tool calls failed: ${issues.toolErrors.join(' | ')}. Handle these results in the program and show a clear message.`);
   }catch(e){const message=e instanceof Error?e.message:String(e);report.backend.push({test:name,ok:false,error:message.slice(0,1500),toolErrors:[],skipped:0});report.blocking.push(`Backend (${name}) failed: ${message.slice(0,1200)}`);}
  }
 }
 // 1b. Logic review. Crash, empty-view and tool-error checks cannot tell whether the program
 // used the tool results correctly: a program that misreads a result's shape and then shows a
 // tidy "not connected" message passes them. A reviewer compares the code, the real tool
 // results and the final view with the request. It runs for every backend, including apps on
 // pre-coded renderers, which get no screenshot review.
 if(target.program&&logicRuns.length&&!ctx.signal?.aborted){
  try{
   const code=String((target.program as {code?:unknown}).code||'').slice(0,14000);
   const evidence=logicRuns.map(r=>({test:r.test,input:r.input,toolCalls:r.trace.slice(0,30).map(t=>({id:t.id,tool:t.tool,args:t.args,result:t.result,error:t.error,skipped:t.skipped})),finalView:JSON.stringify(r.view).slice(0,3000)}));
   const response=await api('responses',{model:model('coding'),store:false,instructions:'You are a senior engineer reviewing a backend program that an AI wrote for a small web app. You get the user request, the program source, and for each test run the real tool calls with their actual arguments and results, and the final view the program returned. Decide whether the program works for the user. Report as blocking: the code reads a tool result with the wrong shape or field names (compare the code with the actual results); the final view contradicts the data the tools returned (for example it says a service is not connected or empty while the results show it connected or containing items); it ignores data needed for the request; it shows invented, placeholder or hardcoded data; a requested feature cannot work with the code as written. A setup or error view is correct only when the results actually show that condition. Tool calls marked skipped were intentionally not executed during verification; do not report those. Judge the program only through what it can control: its handling of input (query, values, submitted, message, parent, cursor) and the view it returns. The pre-coded renderer already provides a Refresh button (reruns with the same input), a file browser whose folder clicks rerun the program with input.parent = the folder entry id ("root" for the top), a Next page button for a non-null next (input.cursor), and form submission (input.values, input.submitted=true); never demand UI controls, click handlers or navigation actions from the backend view. When customFrontend is present, interface features live in that code: check that it calls the backend correctly rather than asking the view for them. Report as major: missing error handling for errors that occurred, confusing or misleading text. Return only JSON {"verdict":"works"|"wrong"|"broken","summary":"one or two sentences","issues":[{"severity":"blocking"|"major"|"minor","problem":"what is wrong, citing the code and the result","fix":"concrete code change"}]}.',input:[{role:'user',content:[{type:'input_text',text:JSON.stringify({request:target.request,title:target.title,templateId:target.templateId,program:code,customFrontend:target.frontend?String(target.frontend.frontend.javascript||'').slice(0,8000):undefined,runs:evidence})}]}]});
   const text=output(response),json=text.slice(text.indexOf('{'),text.lastIndexOf('}')+1),review=JSON.parse(json);
   report.logic={verdict:String(review.verdict||'wrong'),summary:String(review.summary||'').slice(0,800),issues:(Array.isArray(review.issues)?review.issues:[]).slice(0,8).map((i:any)=>({severity:String(i.severity||'minor'),problem:String(i.problem||'').slice(0,600),fix:i.fix?String(i.fix).slice(0,600):undefined}))};
   for(const i of report.logic.issues){if(i.severity==='blocking')report.blocking.push(`Logic review: ${i.problem}${i.fix?' Fix: '+i.fix:''}`);else if(i.severity==='major')report.warnings.push(`Logic review: ${i.problem}${i.fix?' Fix: '+i.fix:''}`);}
   if(report.logic.verdict!=='works'&&!report.logic.issues.some(i=>i.severity==='blocking'))report.blocking.push('Logic review judged the program '+report.logic.verdict+': '+report.logic.summary);
  }catch(e){report.warnings.push('The logic review could not run: '+(e instanceof Error?e.message.slice(0,200):'error'));}
 }
 // 2. Frontend
 const shots:{label:string;data:string}[]=[];
 if(target.frontend){
  const executablePath=chromiumPath();
  if(!executablePath)report.warnings.push('The frontend rendering check is unavailable on this server; only a syntax check ran.');
  else{
   await slot();
   let browser:any;
   try{
    const {chromium}=await import('playwright-core');
    browser=await chromium.launch({executablePath,headless:true,args:['--disable-dev-shm-usage','--no-first-run','--disable-gpu']});
    const html=sandboxDocument(target.frontend.frontend);
    const bridge=async(name:string,args:Record<string,unknown>)=>{
     if(name==='run_page'){
      if(!target.program)return {error:'This page has no backend program; pageTools.run is unavailable.'};
      try{const extra=Object.fromEntries(Object.entries({submitted:args.submitted===true?true:undefined,message:typeof args.message==='string'&&args.message?args.message:undefined,parent:typeof args.parent==='string'?args.parent:undefined,cursor:typeof args.cursor==='string'?args.cursor:undefined}).filter(([,v])=>v!==undefined));const r=await runBackend(typeof args.query==='string'?args.query:'',args.values&&typeof args.values==='object'?args.values as Record<string,unknown>:{},extra);return {result:{view:r.view,runtimeError:null,proposals:[]}};}catch(e){return {result:{view:null,runtimeError:'The page program could not finish: '+(e instanceof Error?e.message.slice(0,300):'error'),proposals:[]}};}
     }
     if(!ctx.agent)return {result:{skipped:true,verification:'Workspace tools are not available while verifying a new draft.'}};
     if(name==='call_connector'){const id=String(args.connectorId||''),tool=String(args.tool||'');if(!await connectorCallIsAutomatic(ctx.userId,id,tool))return {result:{skipped:true,verification:'This connector call needs the user’s approval and was not executed during verification.'}};}
     else if(!['list_connectors','browse_resources','list_page_files','read_uploaded_file','search_components'].includes(name))return {result:{skipped:true,verification:'Not executed during verification: '+name+' may change data.'}};
     try{const {applicationToolbox}=await import('@/app/agents/tools');const box=await applicationToolbox(ctx.agent,{pageId:target.pageId,userId:ctx.userId,ownerId:ctx.userId,language:'en',visibility:'private'},ctx.signal);return {result:await box.execute(name,args)};}catch(e){return {error:e instanceof Error?e.message:'Tool failed.'};}
    };
    const render=async(viewport:{label:string;width:number;height:number},test?:VerifyTests[number])=>{
     const page=await browser.newPage({viewport:{width:viewport.width,height:viewport.height},deviceScaleFactor:1});
     const errors:string[]=[],bridgeErrors:string[]=[];let inflight=0,lastActivity=Date.now();
     page.on('pageerror',(e:Error)=>errors.push('Uncaught: '+e.message.slice(0,300)));
     page.on('console',(m:any)=>{if(m.type()==='error')errors.push('console.error: '+m.text().slice(0,300));});
     await page.exposeFunction('__verifyTool',async(name:string,args:Record<string,unknown>)=>{inflight++;lastActivity=Date.now();try{const r=await bridge(String(name),args&&typeof args==='object'?args:{});if('error' in r)bridgeErrors.push(name+': '+r.error);return r;}finally{inflight--;lastActivity=Date.now();}});
     // The generated page talks to its parent; here the page is top-level, so parent is itself.
     await page.addInitScript(()=>{window.addEventListener('message',async e=>{const d=e.data;if(!d||d.type!=='page-tool-call')return;const r=await (window as any).__verifyTool(d.name,d.args);window.postMessage({type:'page-tool-result',id:d.id,...r},'*');});});
     // A real navigation (not setContent) so the init script and bridge are installed; nothing leaves the machine.
     await page.route('**/*',(r:any)=>r.request().url().startsWith('https://app.verify.invalid/')?r.fulfill({status:200,contentType:'text/html; charset=utf-8',body:html}):r.abort());
     await page.goto('https://app.verify.invalid/',{waitUntil:'load',timeout:20000});
     const settle=async()=>{const deadline=Date.now()+75000;while(Date.now()<deadline){await page.waitForTimeout(300);if(inflight===0&&Date.now()-lastActivity>1200)break;}};
     await settle();
     let missingText:string[]|undefined;
     if(test?.steps?.length){
      for(const s of test.steps){
       try{
        if(s.action==='wait')await page.waitForTimeout(s.ms||500);
        else if(!s.selector)throw Error('selector required');
        else if(s.action==='click')await page.locator(s.selector).first().click({timeout:5000});
        else if(s.action==='fill')await page.locator(s.selector).first().fill(s.value||'',{timeout:5000});
        else if(s.action==='select')await page.locator(s.selector).first().selectOption(s.value||'',{timeout:5000});
        else await page.locator(s.selector).first().press(s.value||'Enter',{timeout:5000});
       }catch(e){
        // Tell the agent what IS on the page, so it can fix its own test step or the markup.
        const available=await page.evaluate(()=>{const esc=(v:string)=>(window as any).CSS?.escape?(window as any).CSS.escape(v):v;return Array.from(document.querySelectorAll('button,a[href],input,select,textarea,[role=button],[onclick]')).filter(el=>{const r=(el as HTMLElement).getBoundingClientRect();return r.width>0&&r.height>0;}).slice(0,20).map(el=>{const h=el as HTMLElement,id=h.id?'#'+esc(h.id):'',cls=h.classList.length?'.'+Array.from(h.classList).slice(0,2).map(esc).join('.'):'',name=h.getAttribute('name'),label=(h.innerText||h.getAttribute('aria-label')||h.getAttribute('placeholder')||(h as HTMLInputElement).value||'').trim().replace(/\s+/g,' ').slice(0,40);return h.tagName.toLowerCase()+(id||cls||(name?`[name="${name}"]`:''))+(label?` "${label}"`:'');});}).catch(()=>[] as string[]);
        errors.push(`Step ${s.action} ${s.selector||''} failed: ${(e instanceof Error?e.message:'').split('\n')[0].slice(0,200)}. Visible interactive elements now: ${available.length?available.join(' | '):'none'}. Use a selector that exists (Playwright also accepts text=Label or button:has-text("Label")).`);break;}
       await settle();
      }
     }
     const metrics=await page.evaluate(()=>{
      const d=document.documentElement,text=document.body?.innerText||'';
      const controls=[...document.querySelectorAll('button,a,input,select,textarea')].filter(el=>{const r=(el as HTMLElement).getBoundingClientRect();return r.width>0&&r.height>0;});
      const unlabeled=controls.filter(el=>!(el.getAttribute('aria-label')||(el as HTMLElement).innerText?.trim()||el.getAttribute('title')||(el as HTMLInputElement).placeholder||(el.id&&document.querySelector('label[for="'+el.id+'"]'))||el.closest('label'))).length;
      let tiny=0;for(const el of [...document.querySelectorAll('body *')].slice(0,3000)){const h=el as HTMLElement;if(h.childNodes.length&&[...h.childNodes].some(n=>n.nodeType===3&&n.textContent!.trim())){const size=parseFloat(getComputedStyle(h).fontSize);const r=h.getBoundingClientRect();if(size<11&&r.width>0)tiny++;}}
      return {text,textChars:text.trim().length,visuals:document.querySelectorAll('canvas,svg,img,video').length,horizontalOverflow:d.scrollWidth>window.innerWidth+2,contentHeight:Math.max(d.scrollHeight,document.body?.scrollHeight||0),brokenImages:[...document.images].filter(i=>i.complete&&i.naturalWidth===0).length,unlabeledControls:unlabeled,tinyText:tiny,errorBanner:/This app encountered an error/.test(text)};
     });
     if(test?.expectText?.length)missingText=test.expectText.filter(t=>!metrics.text.includes(t));
     const shot=await page.screenshot({type:'jpeg',quality:62,fullPage:true,clip:{x:0,y:0,width:viewport.width,height:Math.min(Math.max(metrics.contentHeight,200),2400)}}).catch(()=>null);
     if(shot&&shots.length<4)shots.push({label:viewport.label+(test?' after "'+(test.name||'steps')+'"':''),data:Buffer.from(shot).toString('base64')});
     await page.close();
     if(metrics.errorBanner)errors.push('The frontend showed its uncaught-error banner.');
     if(metrics.textChars<20&&!metrics.visuals)errors.push('The frontend rendered almost nothing (under 20 characters of text and no visuals).');
     const check:ViewportCheck={viewport:viewport.label,ok:!errors.length&&!bridgeErrors.length&&!(missingText?.length),errors:errors.slice(0,10),bridgeErrors:bridgeErrors.slice(0,6),textChars:metrics.textChars,horizontalOverflow:metrics.horizontalOverflow,contentHeight:metrics.contentHeight,brokenImages:metrics.brokenImages,unlabeledControls:metrics.unlabeledControls,tinyText:metrics.tinyText,...(test?{test:test.name||'steps'}:{}),...(missingText?.length?{missingText}:{})};
     report.frontend.push(check);
     const where=viewport.label+(test?` / ${test.name||'steps'}`:'');
     for(const e of check.errors)report.blocking.push(`Frontend (${where}): ${e}`);
     for(const e of check.bridgeErrors)report.blocking.push(`Frontend (${where}) bridge call failed: ${e}`);
     if(missingText?.length)report.blocking.push(`Frontend (${where}) did not show expected text: ${missingText.join(', ')}`);
     if(check.horizontalOverflow)report.blocking.push(`Frontend (${where}) is wider than the screen and scrolls sideways; make the layout responsive.`);
     if(check.brokenImages)report.warnings.push(`Frontend (${where}) has ${check.brokenImages} broken image(s).`);
     if(check.unlabeledControls)report.warnings.push(`Frontend (${where}) has ${check.unlabeledControls} control(s) without a visible or accessible label.`);
     if(check.tinyText>3)report.warnings.push(`Frontend (${where}) has text smaller than 11px in ${check.tinyText} place(s).`);
     if(!test&&viewport.width>600&&check.contentHeight>target.frontend!.frontend.height+40)report.warnings.push(`Frontend content is ${check.contentHeight}px tall but the panel height is ${target.frontend!.frontend.height}px, so it scrolls inside the panel; raise height (max 1200) or tighten the layout.`);
    };
    await render({label:'desktop 1280px',width:1280,height:Math.max(700,Math.min(target.frontend.frontend.height,1200))});
    await render({label:'phone 390px',width:390,height:844});
    for(const test of tests.filter(t=>t.steps?.length).slice(0,3))await render({label:'desktop 1280px',width:1280,height:Math.max(700,Math.min(target.frontend.frontend.height,1200))},test);
   }catch(e){report.warnings.push('The frontend rendering check could not run: '+(e instanceof Error?e.message.split('\n')[0].slice(0,300):'error'));}
   finally{await browser?.close().catch(()=>{});release();}
  }
 }
 // 3. Visual review of the screenshots against the request.
 if(shots.length&&!ctx.signal?.aborted){
  try{
   const response=await api('responses',{model:model('coding'),store:false,instructions:'You are a senior product designer and QA engineer reviewing screenshots of a small web app that an AI generated for a user. Judge whether it fulfils the user request and whether the UI is polished and practical: clear hierarchy, sensible spacing and alignment, readable type and contrast, consistent styling, useful loading/empty/error states, controls that look clickable, charts and tables that are legible, content not cut off, overlapping or overflowing, no placeholder or fake data presented as real, and a layout that works on the phone screenshot. Be specific and actionable; reference visible elements. Severity: blocking = broken, unusable, visibly erroneous, misleading, or missing the core requested function; major = clearly unpolished or confusing; minor = small polish. Return only JSON: {"verdict":"pass"|"needs_work"|"broken","summary":string,"issues":[{"severity":"blocking"|"major"|"minor","area":string,"problem":string,"fix":string}]} with at most 8 issues.',input:[{role:'user',content:[{type:'input_text',text:JSON.stringify({request:target.request,app:target.title,screenshots:shots.map(s=>s.label),measurements:report.frontend.map(f=>({viewport:f.viewport,test:f.test,errors:f.errors.length,horizontalOverflow:f.horizontalOverflow}))})},...shots.map(s=>({type:'input_image',image_url:'data:image/jpeg;base64,'+s.data,detail:'high'}))]}],max_output_tokens:2500},ctx.signal);
   const text=output(response),json=text.slice(text.indexOf('{'),text.lastIndexOf('}')+1),review=JSON.parse(json);
   report.review={verdict:String(review.verdict||'needs_work'),summary:String(review.summary||'').slice(0,800),issues:(Array.isArray(review.issues)?review.issues:[]).slice(0,8).map((i:any)=>({severity:String(i.severity||'minor'),area:i.area?String(i.area).slice(0,100):undefined,problem:String(i.problem||'').slice(0,400),fix:i.fix?String(i.fix).slice(0,400):undefined}))};
   for(const i of report.review.issues)if(i.severity==='blocking')report.blocking.push(`Visual review: ${i.problem}${i.fix?' Fix: '+i.fix:''}`);
   if(report.review.verdict==='broken'&&!report.review.issues.some(i=>i.severity==='blocking'))report.blocking.push('Visual review judged the app broken: '+report.review.summary);
  }catch(e){report.warnings.push('The visual review could not run: '+(e instanceof Error?e.message.slice(0,200):'error'));}
 }
 report.passed=!report.blocking.length;report.durationMs=Date.now()-started;return report;
}

// Compact text for the agent: what failed, what to polish, and what the app showed.
export function verificationText(r:VerifyReport){
 return JSON.stringify({passed:r.passed,blocking:r.blocking,shouldFix:[...(r.review?.issues||[]).filter(i=>i.severity==='major').map(i=>i.problem+(i.fix?' Fix: '+i.fix:'')),...r.warnings],polish:[...(r.review?.issues||[]),...(r.logic?.issues||[])].filter(i=>i.severity==='minor').map(i=>i.problem+(i.fix?' Fix: '+i.fix:'')),logicVerdict:r.logic?.verdict,logicSummary:r.logic?.summary,visualSummary:r.review?.summary,verdict:r.review?.verdict,backend:r.backend,frontend:r.frontend.map(f=>({viewport:f.viewport,test:f.test,ok:f.ok,textChars:f.textChars,contentHeight:f.contentHeight})),seconds:Math.round(r.durationMs/1000)});
}
