import {existsSync} from 'node:fs';
import {z} from 'zod';
import {api,output} from '@/app/api/ask/ai';
import {model} from '@/db/store';
import {validateWorkflow} from './validate';
import {runAction} from './executor';
import {evaluate} from './expressions';
import {putPreview,dropPreview} from './preview-store';
import type {Workflow,RunTrace} from './schema';
// Verifies a workflow app before it is saved: structure, real runs of its
// actions (changes skipped), the agent's expectations, and a rendered review
// of the actual components at desktop and phone width.
export const workflowTestsSchema=z.array(z.object({name:z.string().max(100).optional(),values:z.record(z.unknown()).optional(),actions:z.array(z.string().max(48)).max(6).optional(),expect:z.array(z.string().max(500)).max(8).optional()}).strict()).max(6);
export type WorkflowTests=z.infer<typeof workflowTestsSchema>;
type TestRun={test:string;ok:boolean;actions:{action:string;error?:string;trace:RunTrace[]}[];failed:string[];state:string};
export type WorkflowReport={passed:boolean;blocking:string[];warnings:string[];tests:TestRun[];review?:{verdict:string;summary:string;issues:{severity:string;area?:string;problem:string;fix?:string}[]};screens:{viewport:string;errors:string[];overflow:boolean;textChars:number}[];seconds:number};
const chromiumPath=()=>[process.env.CHROMIUM_PATH,'/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome'].find(p=>p&&existsSync(p));
const short=(v:unknown,n=1200)=>{let s:string;try{s=JSON.stringify(v)??'';}catch{s=String(v);}return s.length>n?s.slice(0,n)+'… ('+s.length+' chars)':s;};
export async function verifyWorkflow(raw:unknown,target:{request:string;title:string;pageId:string;language:string},ctx:{userId:string;signal?:AbortSignal},tests:WorkflowTests=[]):Promise<WorkflowReport>{
 const started=Date.now(),report:WorkflowReport={passed:false,blocking:[],warnings:[],tests:[],screens:[],seconds:0};
 let workflow:Workflow;
 try{const v=validateWorkflow(raw);workflow=v.workflow;report.blocking.push(...v.errors);report.warnings.push(...v.warnings);}catch(e){report.blocking.push(e instanceof Error?e.message:'Invalid workflow.');report.seconds=0;return report;}
 if(report.blocking.length){report.seconds=Math.round((Date.now()-started)/1000);return report;}
 const plan=tests.length?tests:[{name:'first load',actions:workflow.actions.load?['load']:[]}];
 let shown:{state:Record<string,unknown>;values:Record<string,unknown>}|null=null;
 for(const test of plan){
  const run:TestRun={test:test.name||'test',ok:true,actions:[],failed:[],state:''};let state={...workflow.state};const values=test.values||{};
  for(const action of test.actions??(workflow.actions.load?['load']:[])){
   if(!workflow.actions[action]){run.failed.push('Unknown action '+action);continue;}
   const r=await runAction(workflow,action,{state,values,event:{type:action==='load'?'load':'click',source:'verification'}},{userId:ctx.userId,pageId:target.pageId,language:target.language,explicit:action!=='load',verification:true,signal:ctx.signal});
   state=r.state;run.actions.push({action,...(r.error?{error:r.error}:{}),trace:r.trace.map(t=>({...t,preview:t.preview?.slice(0,400)}))});
   if(r.error)run.failed.push(action+': '+r.error);
  }
  for(const e of test.expect||[]){try{if(!await evaluate(e,{state,values}))run.failed.push('Expected '+e+' to be true; state is '+short(state,600));}catch(err){run.failed.push('Expectation '+e+' failed: '+(err instanceof Error?err.message:'error'));}}
  run.ok=!run.failed.length;run.state=short(state);report.tests.push(run);
  for(const f of run.failed)report.blocking.push('Test "'+run.test+'": '+f);
  shown??={state,values};
 }
 // Render the real components with the state the first test produced.
 const executablePath=chromiumPath(),shots:{label:string;data:string}[]=[];
 if(!executablePath)report.warnings.push('Rendering check unavailable on this server.');
 else if(shown&&!ctx.signal?.aborted){
  const token=putPreview({workflow,state:shown.state,values:shown.values,title:target.title,pageId:target.pageId});let browser:any;
  try{
   const {chromium}=await import('playwright-core');browser=await chromium.launch({executablePath,headless:true,args:['--disable-dev-shm-usage','--no-first-run','--disable-gpu']});
   for(const viewport of [{label:'desktop 1280px',width:1280,height:900},{label:'phone 390px',width:390,height:844}]){
    const page=await browser.newPage({viewport:{width:viewport.width,height:viewport.height}}),errors:string[]=[];
    page.on('pageerror',(e:Error)=>errors.push('Uncaught: '+e.message.slice(0,300)));page.on('console',(m:any)=>{if(m.type()==='error'&&!/favicon|arcgis|tile/i.test(m.text()))errors.push(m.text().slice(0,300));});
    await page.goto('http://127.0.0.1:'+(process.env.PORT||'3000')+'/workflow-preview?token='+token,{waitUntil:'networkidle',timeout:30000}).catch(()=>{});
    await page.waitForTimeout(1500);
    const m=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>window.innerWidth+2,text:document.body.innerText.length,height:document.documentElement.scrollHeight}));
    const data=(await page.screenshot({fullPage:true,type:'jpeg',quality:70,clip:{x:0,y:0,width:viewport.width,height:Math.min(m.height,viewport.width<500?3200:2400)}})).toString('base64');
    shots.push({label:viewport.label,data});report.screens.push({viewport:viewport.label,errors,overflow:m.overflow,textChars:m.text});
    if(errors.some(e=>e.startsWith('Uncaught')))report.blocking.push(viewport.label+': '+errors.find(e=>e.startsWith('Uncaught')));
    if(m.overflow)report.warnings.push(viewport.label+': the page scrolls horizontally.');
    await page.close();
   }
  }catch(e){report.warnings.push('Rendering check failed: '+(e instanceof Error?e.message.split('\n')[0].slice(0,200):'error'));}
  finally{await browser?.close().catch(()=>{});dropPreview(token);}
 }
 if(shots.length&&!ctx.signal?.aborted){
  try{
   const response=await api('responses',{model:model('coding'),store:false,instructions:'You are a senior product designer and QA engineer reviewing screenshots of a web app an AI assembled from a fixed library of UI components (tables, charts, stat cards, forms, maps, tabs, cards…) for a user. Judge whether it fulfils the request with real data and whether it is clear and polished: hierarchy, spacing, sensible component choices (charts where trends matter, tables with formatted columns, stat cards for key numbers), readable labels and units, useful empty/error states, nothing cut off or overflowing, and a phone layout that works. Data shown comes from real runs; flag placeholder or obviously wrong numbers. Severity: blocking = broken, empty where data was expected, misleading, or missing the core requested function; major = clearly unpolished or confusing; minor = polish. Return only JSON: {"verdict":"pass"|"needs_work"|"broken","summary":string,"issues":[{"severity":"blocking"|"major"|"minor","area":string,"problem":string,"fix":string}]} with at most 8 issues; express fixes in terms of components, props, bindings and actions.',input:[{role:'user',content:[{type:'input_text',text:JSON.stringify({request:target.request,app:target.title,tests:report.tests.map(t=>({test:t.test,ok:t.ok,failed:t.failed}))})},...shots.map(s=>({type:'input_image',image_url:'data:image/jpeg;base64,'+s.data,detail:'high'}))]}],max_output_tokens:2500},ctx.signal);
   const text=output(response),review=JSON.parse(text.slice(text.indexOf('{'),text.lastIndexOf('}')+1));
   report.review={verdict:String(review.verdict||'needs_work'),summary:String(review.summary||'').slice(0,800),issues:(Array.isArray(review.issues)?review.issues:[]).slice(0,8).map((i:any)=>({severity:String(i.severity||'minor'),area:i.area?String(i.area).slice(0,100):undefined,problem:String(i.problem||'').slice(0,400),fix:i.fix?String(i.fix).slice(0,400):undefined}))};
   for(const i of report.review.issues)if(i.severity==='blocking')report.blocking.push('Visual review: '+i.problem+(i.fix?' Fix: '+i.fix:''));
   if(report.review.verdict==='broken'&&!report.review.issues.some(i=>i.severity==='blocking'))report.blocking.push('Visual review judged the app broken: '+report.review.summary);
  }catch(e){report.warnings.push('Visual review could not run: '+(e instanceof Error?e.message.slice(0,200):'error'));}
 }
 report.passed=!report.blocking.length;report.seconds=Math.round((Date.now()-started)/1000);return report;
}
export function workflowReportText(r:WorkflowReport){return JSON.stringify({passed:r.passed,blocking:r.blocking,shouldFix:[...(r.review?.issues||[]).filter(i=>i.severity==='major').map(i=>i.problem+(i.fix?' Fix: '+i.fix:'')),...r.warnings],polish:(r.review?.issues||[]).filter(i=>i.severity==='minor').map(i=>i.problem+(i.fix?' Fix: '+i.fix:'')),visualSummary:r.review?.summary,tests:r.tests,screens:r.screens,seconds:r.seconds});}
