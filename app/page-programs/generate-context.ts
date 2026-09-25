import {partialJsonString} from '@/app/chat/partial-json';
import {indexGenerationPolicy} from '@/app/disambiguation/graph';
import {spawnAgent,recordAction,askAgent,type Agent} from '@/app/agents/runtime';
import type {AgentContext} from '@/app/components-registry/registry';
import type {TemplateId} from '@/app/templates/catalog';
import {output,type ResearchUpdate} from '@/app/api/ask/ai';
import {codeSchema} from '@/app/sandboxes/contracts';
import {runProgram} from '@/app/sandboxes/service';
import {validateGenerationDraft,materializeGenerationDraft,type GenerationDraft} from './generation-draft';
import {imageLinePattern} from '@/app/internal-links';
import {unreachableImages} from '@/app/chat/image-check';
import {generationInstructions} from './generation-instructions';
import {generationContract} from './generation-contracts';
import {verifyApp,verificationText,verifyTestsSchema,type VerifyTests} from './verify';
export type GenerationBrief={question:string;templateId?:TemplateId;fresh?:boolean;route?:string;service?:string};
const fn=(name:string,description:string,properties:Record<string,unknown>)=>({type:'function',name,description,strict:true,parameters:{type:'object',additionalProperties:false,properties,required:Object.keys(properties)}});
const tools=[fn('read_generation_contract','Read artifact formats. Choose only the format you need.',{kind:{type:'string',enum:['program','frontend','chart','form','converter','custom_style','wiki']}}),fn('validate_page_draft','Validate a draft without saving it. Returns concrete structural errors; does not judge factual accuracy.',{draftJson:{type:'string'}}),fn('test_page_program','Test generated JavaScript or Python in the configured isolated sandbox. No network or server secrets; no page is saved.',{programJson:{type:'string'},inputJson:{type:'string'}}),fn('verify_app','Verify a kind=program app draft end to end before finishing: runs the backend program through the real step loop with each test input (writes and approval-gated calls are skipped), renders the custom frontend in headless Chromium at 1280px and 390px with the real pageTools bridge, performs scripted interactions, measures layout, and has a reviewer judge the screenshots against the request. Returns blocking problems, things to fix and polish notes. A program draft is only accepted after it passes, so fix every blocking item and re-run. testsJson is a JSON array (max 6) of {name?, input?:{query?,values?}, steps?:[{action:click|fill|select|press|wait, selector?, value?, ms?}], expectText?:[strings the page must show]}; use "[]" for the default first-load test.',{draftJson:{type:'string'},testsJson:{type:'string'}})];
export async function generateContext(brief:GenerationBrief,context:AgentContext,router:Agent,emit:((event:ResearchUpdate)=>void)|undefined,signal:AbortSignal){
 const indexPolicy=await indexGenerationPolicy(brief.question,context.userId);
 context={...context,indexLeafRequired:indexPolicy.leafRequired};
 const generator=await spawnAgent('content-generation',context.ownerId,router),ctx={...context,agent:generator};
 let draft:GenerationDraft|undefined,searched=false,dataConsulted=false,imageSearched=false,lastPreview=0;
 const checkedDrafts=new Map<string,GenerationDraft>();
 // Verified app code, keyed by the exact program and frontend, so finishing does not repeat a passing run.
 const verified=new Set<string>();let lastTests:VerifyTests=[];
 const appKey=(d:GenerationDraft)=>JSON.stringify([d.program,d.frontend,d.templateId]);
 const verifyDraft=async(d:GenerationDraft,tests:VerifyTests)=>{emit?.({type:'status',message:context.language.startsWith('zh')?'正在运行并检查应用（后端逻辑与界面）…':'Running and checking the app (backend logic and UI)…'});const report=await verifyApp({request:brief.question,title:d.title,program:d.program,templateId:d.templateId,frontend:d.frontend,tests},{userId:context.userId,agent:generator,signal});if(report.passed)verified.add(appKey(d));return report;};
 emit?.({type:'status',message:context.language.startsWith('zh')?'生成器正在处理请求…':'The generator is working on your request…'});
 // The page is streamed to the reader once: from the validate_page_draft call
 // when the generator validates, otherwise from its final answer. A final answer
 // that merely repeats an already validated draft must not redraw the page.
 let streamedBody='',streamedTitle='',validatedPreview=false;
 const preview=(text:string,source:'validate'|'final')=>{
   if(!emit||Date.now()-lastPreview<100)return;
   if(source==='final'&&validatedPreview)return;
   const json=partialJsonString(text,'draftJson');if(!json||json.startsWith('draft:'))return;
   if(source==='validate')validatedPreview=true;
   const title=partialJsonString(json,'title'),body=partialJsonString(json,'body');
   if(title!==undefined){lastPreview=Date.now();streamedTitle=title;emit({type:'metadata',title,summary:partialJsonString(json,'summary')||'',category:partialJsonString(json,'category')||'',labels:{overview:'',contents:'',sources:''}});}
   if(body!==undefined){lastPreview=Date.now();streamedBody=body;emit({type:'replace',text:body});}
  };
 await askAgent(generator,generationInstructions,{question:brief.question,language:context.language,sourceDocument:context.sourceDocument,visibility:context.visibility,indexLeafRequired:context.indexLeafRequired,asOf:new Date().toISOString()},{type:'object',additionalProperties:false,properties:{draftJson:{type:'string'}},required:['draftJson']},signal,undefined,[],{
  context:ctx,extraTools:tools,maxValidationRetries:7,
  onOutputText:text=>preview(text,'final'),onToolArguments:(name,text)=>{if(name==='validate_page_draft')preview(text,'validate');},
  executeExtra:async(name,args)=>{
   if(name==='read_generation_contract')return {data:generationContract(args.kind)};
   if(name==='test_page_program')return {data:await runProgram(codeSchema.parse(JSON.parse(args.programJson)),JSON.parse(args.inputJson),ctx)};
   if(name==='verify_app'){try{const encoded=String(args.draftJson||'');const raw=encoded.startsWith('draft:')?checkedDrafts.get(encoded):JSON.parse(encoded);if(!raw)throw Error('Unknown draft reference.');const d=validateGenerationDraft(raw,brief.question,ctx,true);if(d.kind!=='program')return {data:{skipped:'verify_app checks kind=program apps; other kinds are validated by validate_page_draft.'}};lastTests=verifyTestsSchema.parse(JSON.parse(String(args.testsJson||'[]')));const report=await verifyDraft(d,lastTests);return {data:JSON.parse(verificationText(report))};}catch(e){return {data:{passed:false,error:e instanceof Error?e.message:'Verification failed.'}};}}
   if(name==='validate_page_draft'){try{const checked=validateGenerationDraft(JSON.parse(args.draftJson),brief.question,ctx,true);if(checked.kind==='disambiguation')indexPolicy.validate(checked.entries!);const draftRef='draft:'+crypto.randomUUID();if(checkedDrafts.size>=16)checkedDrafts.delete(checkedDrafts.keys().next().value!);checkedDrafts.set(draftRef,checked);return {data:{valid:true,draftRef,note:'Structural validation only; factual claims still require consulted evidence.'}};}catch(e){return {data:{valid:false,error:e instanceof Error?e.message:'Invalid draft'}};}}
   throw Error('Unknown generation tool.');
  },
  onEvent:e=>{if(e.kind==='tool_finished'){const d=e.data as {tool:string;result:any};if(['call_connector','storage_execute','read_uploaded_file','execute_api','execute_code'].includes(d.tool)&&d.result&&!d.result.error&&!d.result.confirmationRequired)dataConsulted=true;if(d.tool==='find_images'||d.tool==='search_public_media'||(d.tool==='call_connector'&&/image/i.test(JSON.stringify((e.data as {arguments?:unknown}).arguments||''))))imageSearched=true;}if(e.kind==='tool_started')emit?.({type:'status',message:context.language.startsWith('zh')?'生成器正在使用工具…':'The generator is using a tool…'});if(e.kind==='validation_failed')emit?.({type:'status',message:context.language.startsWith('zh')?'生成器正在修正草稿…':'The generator is correcting its draft…'});},
  validateFinal:async(response,trace)=>{
   searched ||= trace.webSearched;
   try{const encoded=JSON.parse(output(response)).draftJson;const raw=typeof encoded==='string'&&encoded.startsWith('draft:')?checkedDrafts.get(encoded):JSON.parse(encoded);if(!raw)throw Error('Unknown draft reference. Submit the complete draft or a reference returned in this run.');draft=validateGenerationDraft(raw,brief.question,ctx,searched,dataConsulted);if(draft.kind==='disambiguation')indexPolicy.validate(draft.entries!);
    // A wiki article ships with at least one verified illustration unless a real image search came up empty.
    if(draft.kind==='article'&&draft.templateId!=='paper-v1'&&!imageSearched&&!draft.body.split('\n').some(line=>imageLinePattern.test(line))){draft=undefined;return 'The article has no image. Search with find_images (try precise and alternative subject queries) or search_public_media and embed at least one verified, relevant image on its own line as ![caption](url) with a [credit](source) line; add a table, chart or video where the subject supports it.';}
    // A web app ships only after its backend ran and its frontend rendered cleanly.
    if(draft.kind==='program'&&!verified.has(appKey(draft))){const report=await verifyDraft(draft,lastTests);if(!report.passed){draft=undefined;return 'The app failed verification. Fix every blocking item, run verify_app again until it passes, then finish. Report: '+verificationText(report);}}
    if(draft.body){const broken=await unreachableImages(draft.body,signal);if(broken.length){draft=undefined;return 'These image URLs do not serve an image to readers (the host may block direct embedding): '+broken.join(', ')+'. Copy each into Page files with import_image and embed the returned url, or choose another image.';}}}catch(e){return e instanceof Error?e.message:'Invalid page draft';}
  }
 });
 if(!draft)throw Error('INCOMPLETE_ANSWER');
 const result=await materializeGenerationDraft(draft,ctx);
 emit?.({type:'metadata',title:result.answer.title,summary:result.answer.summary,category:result.answer.category,labels:{overview:draft.labels.overview,contents:draft.labels.contents||'',sources:draft.labels.sources||''}});
 if(result.answer.body&&(result.answer.body!==streamedBody||result.answer.title!==streamedTitle))emit?.({type:'replace',text:result.answer.body});
 await recordAction(generator,'Completed page draft',{kind:draft.kind,title:draft.title});
 return {...result,generatorId:generator.id,generationIntent:draft.intent};
}
