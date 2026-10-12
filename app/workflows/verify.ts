import {z} from 'zod';
import {api,output} from '@/app/api/ask/ai';
import {model} from '@/db/store';
import {validateWorkflow} from './validate';
import {runAction} from './executor';
import {evaluate,resolve} from './expressions';
import {renderScreens,chromiumPath,type Shot} from './render';
import type {Workflow,WorkflowNode,RunTrace} from './schema';
// Verifies a workflow app before it is saved: structure, real runs of its
// actions (changes skipped), the agent's expectations, and a rendered review
// of the actual components at desktop and phone width.
export const workflowTestsSchema=z.array(z.object({name:z.string().max(100).optional(),files:z.array(z.object({name:z.string().min(1).max(200),content:z.string().max(200000)}).strict()).max(3).optional(),values:z.record(z.unknown()).optional(),actions:z.array(z.string().max(48)).max(6).optional(),expect:z.array(z.string().max(500)).max(8).optional()}).strict()).max(6);
export type WorkflowTests=z.infer<typeof workflowTestsSchema>;
type TestRun={test:string;ok:boolean;actions:{action:string;error?:string;trace:RunTrace[]}[];failed:string[];state:string};
export type WorkflowReport={passed:boolean;blocking:string[];warnings:string[];tests:TestRun[];review?:{verdict:string;summary:string;issues:{severity:string;area?:string;problem:string;fix?:string}[];coverage?:{requirement:string;status:string;note?:string}[]};screens:{viewport:string;errors:string[];overflow:boolean;textChars:number}[];seconds:number};
const short=(v:unknown,n=1200)=>{let s:string;try{s=JSON.stringify(v)??'';}catch{s=String(v);}return s.length>n?s.slice(0,n)+'… ('+s.length+' chars)':s;};
export async function verifyWorkflow(raw:unknown,target:{request:string;title:string;pageId:string;language:string;requirements?:string[];goal?:string;gaps?:string[]},ctx:{userId:string;signal?:AbortSignal;fixtures?:Record<string,{name:string;content:string}>},tests:WorkflowTests=[]):Promise<WorkflowReport>{
 const started=Date.now(),report:WorkflowReport={passed:false,blocking:[],warnings:[],tests:[],screens:[],seconds:0};
 let workflow:Workflow;
 try{const v=validateWorkflow(raw);workflow=v.workflow;report.blocking.push(...v.errors);report.warnings.push(...v.warnings);}catch(e){report.blocking.push(e instanceof Error?e.message:'Invalid workflow.');report.seconds=0;return report;}
 // code.run is a last resort: the spec must say why tools and expressions cannot do the job.
 const codeSteps=Object.values(workflow.actions).flatMap(a=>a.steps).filter(s=>s.tool==='code.run').length;
 if(codeSteps&&!(target.gaps||[]).some(g=>g.trim().length>20))report.blocking.push('The app uses code.run but its spec records no reason in gaps. Arithmetic, schedules, loops over ranges, aggregation, sorting and formatting are done with JSONata ($power, $map([1..n], …), $reduce, $sum, $round); use code.run only for what no tool or expression can do, and record why in wf_spec gaps.');
 if(codeSteps&&!report.blocking.length&&!ctx.signal?.aborted)for(const problem of await reviewCodeNecessity(workflow,target.request,ctx.signal))report.blocking.push(problem);
 if(report.blocking.length){report.seconds=Math.round((Date.now()-started)/1000);return report;}
 const plan=tests.length?tests:[{name:'first load',actions:workflow.actions.load?['load']:[]}];
 let shown:{state:Record<string,unknown>;values:Record<string,unknown>}|null=null;
 for(const test of plan){
  const run:TestRun={test:test.name||'test',ok:true,actions:[],failed:[],state:''};let state={...workflow.state};const values=test.values||{};
  const fixtures={...(ctx.fixtures||{}),...Object.fromEntries((test.files||[]).map(f=>[f.name,f]))};
  for(const action of test.actions??(workflow.actions.load?['load']:[])){
   if(!workflow.actions[action]){run.failed.push('Unknown action '+action);continue;}
   const r=await runAction(workflow,action,{state,values,event:{type:action==='load'?'load':'click',source:'verification'}},{userId:ctx.userId,pageId:target.pageId,language:target.language,explicit:action!=='load',verification:true,signal:ctx.signal,fixtures});
   state=r.state;run.actions.push({action,...(r.error?{error:r.error}:{}),trace:r.trace.map(t=>({...t,preview:t.preview?.slice(0,400)}))});
   if(r.error)run.failed.push(action+': '+r.error);
  }
  for(const e of test.expect||[]){try{if(!await evaluate(e,{state,values}))run.failed.push('Expected '+e+' to be true; state is '+short(state,600));}catch(err){run.failed.push('Expectation '+e+' failed: '+(err instanceof Error?err.message:'error'));}}
  // Every display binding must evaluate against the state this test produced.
  for(const problem of await bindingProblems(workflow,{state,values,running:{},errors:{},page:{id:target.pageId,title:target.title}}))run.failed.push('Display binding '+problem);
  run.ok=!run.failed.length;run.state=short(state);report.tests.push(run);
  for(const f of run.failed)report.blocking.push('Test "'+run.test+'": '+f);
  shown??={state,values};
 }
 // Render the real components with the state the first test produced.
 let shots:Shot[]=[];
 if(!chromiumPath())report.warnings.push('Rendering check unavailable on this server.');
 else if(shown&&!ctx.signal?.aborted){
  try{shots=await renderScreens(workflow,{state:shown.state,values:shown.values,title:target.title,pageId:target.pageId},['desktop','phone'],ctx.signal);
   for(const s of shots){report.screens.push({viewport:s.label,errors:s.errors,overflow:s.overflow,textChars:s.textChars});const uncaught=s.errors.find(e=>e.startsWith('Uncaught'));if(uncaught)report.blocking.push(s.label+': '+uncaught);if(s.overflow)report.warnings.push(s.label+': the page scrolls horizontally.');}}
  catch(e){report.warnings.push('Rendering check failed: '+(e instanceof Error?e.message.split('\n')[0].slice(0,200):'error'));}
 }
 if(shots.length&&!ctx.signal?.aborted){
  try{
   const response=await api('responses',{model:model('coding'),store:false,instructions:'You are a senior product designer and QA engineer reviewing screenshots of a web app an AI assembled from a fixed library of UI components (tables, charts, stat cards, forms, maps, tabs, cards…) for a user. Judge whether it fulfils the request with real data and whether it is clear and polished: hierarchy, spacing, sensible component choices (charts where trends matter, tables with formatted columns, stat cards for key numbers), readable labels and units, useful empty/error states, nothing cut off or overflowing, and a phone layout that works. Data shown comes from real runs; flag placeholder or obviously wrong numbers. The screenshots show the page as its owner sees it after the tests ran; file pickers and buttons are drawn but not clicked (uploads cannot happen in a screenshot), so judge them by whether they are present and clearly labelled, never as missing functionality. Severity: blocking = broken, empty where data was expected, misleading, or missing the core requested function; major = clearly unpolished or confusing; minor = polish. Return only JSON: {"verdict":"pass"|"needs_work"|"broken","summary":string,"issues":[{"severity":"blocking"|"major"|"minor","area":string,"problem":string,"fix":string}]} with at most 8 issues; express fixes in terms of components, props, bindings and actions. When requirements are given, also return "coverage":[{"requirement","status":"met"|"unmet"|"unclear","note"}] for each one, judged from the screenshots and the test results; a requirement about an action the screenshots cannot show (an upload, a publish) is met when the control is present and its test passed.',input:[{role:'user',content:[{type:'input_text',text:JSON.stringify({request:target.request,goal:target.goal,requirements:target.requirements||[],app:target.title,tests:report.tests.map(t=>({test:t.test,ok:t.ok,failed:t.failed}))})},...shots.map(s=>({type:'input_image',image_url:'data:image/jpeg;base64,'+s.data,detail:'high'}))]}],max_output_tokens:2500},ctx.signal);
   const text=output(response),review=JSON.parse(text.slice(text.indexOf('{'),text.lastIndexOf('}')+1));
   report.review={verdict:String(review.verdict||'needs_work'),summary:String(review.summary||'').slice(0,800),issues:(Array.isArray(review.issues)?review.issues:[]).slice(0,8).map((i:any)=>({severity:String(i.severity||'minor'),area:i.area?String(i.area).slice(0,100):undefined,problem:String(i.problem||'').slice(0,400),fix:i.fix?String(i.fix).slice(0,400):undefined}))};
   report.review.coverage=(Array.isArray(review.coverage)?review.coverage:[]).slice(0,20).map((c:any)=>({requirement:String(c.requirement||'').slice(0,300),status:String(c.status||'unclear'),note:c.note?String(c.note).slice(0,300):undefined}));
   for(const c of report.review.coverage??[])if(c.status==='unmet')report.blocking.push('Requirement not met: '+c.requirement+(c.note?' ('+c.note+')':''));
   for(const i of report.review.issues)if(i.severity==='blocking')report.blocking.push('Visual review: '+i.problem+(i.fix?' Fix: '+i.fix:''));
   if(report.review.verdict==='broken'&&!report.review.issues.some(i=>i.severity==='blocking'))report.blocking.push('Visual review judged the app broken: '+report.review.summary);
  }catch(e){report.warnings.push('Visual review could not run: '+(e instanceof Error?e.message.slice(0,200):'error'));}
 }
 report.passed=!report.blocking.length;report.seconds=Math.round((Date.now()-started)/1000);return report;
}
// An independent reviewer decides whether each code.run step is really needed:
// work that JSONata, json/csv tools or platform tools can do must not run as code.
async function reviewCodeNecessity(workflow:Workflow,request:string,signal?:AbortSignal){
 const steps=Object.entries(workflow.actions).flatMap(([name,a])=>a.steps.filter(s=>s.tool==='code.run').map(s=>({action:name,step:s.id,language:String(s.args?.language),code:String(s.args?.code||'').slice(0,6000)})));
 if(!steps.length)return [];
 try{
  const response=await api('responses',{model:model(),store:false,instructions:'You review code steps in a workflow app. The platform offers JSONata expressions (arithmetic, $power, $sqrt, $round, $sum, $average, $max, $min, $count, $map/$filter/$reduce/$sort, grouping with object constructors, string functions, dates, ranges [1..n]) and tools (compute, csv.parse, json.parse, files.read, connectors.call, resources.browse, data.describe). For each code step decide whether it is NECESSARY: necessary only if no combination of those can reasonably do it (e.g. matrix algebra, regression or model fitting, iterative numerical methods, simulations, complex parsing of an unusual binary/text format). Grouping, counting, totals, averages, percentages, sorting, filtering, formatting, unit conversion, loan or interest formulas, and reshaping data are NOT necessary. Return only JSON: {"steps":[{"step":string,"necessary":boolean,"reason":string,"alternative":string}]}',input:JSON.stringify({request,steps}),max_output_tokens:2000},signal);
  const text=output(response),r=JSON.parse(text.slice(text.indexOf('{'),text.lastIndexOf('}')+1)) as {steps?:{step:string;necessary:boolean;reason:string;alternative?:string}[]};
  return (r.steps||[]).filter(s=>s.necessary===false).map(s=>'code.run step '+s.step+' is not necessary: '+String(s.reason).slice(0,300)+(s.alternative?' Use instead: '+String(s.alternative).slice(0,400):''));
 }catch{return [];}
}
async function bindingProblems(workflow:Workflow,scope:Record<string,unknown>){
 const problems:string[]=[];
 const visit=async(nodes:WorkflowNode[],path:string)=>{for(let i=0;i<nodes.length;i++){const n=nodes[i],at=path+'['+i+'] ('+n.type+(n.id?' #'+n.id:'')+')';for(const [key,value] of Object.entries(n.props||{}))try{await resolve(value,scope);}catch(e){problems.push(at+'.props.'+key+': '+(e instanceof Error?e.message:'error'));}if(n.visible!==undefined)try{await resolve(n.visible,scope);}catch(e){problems.push(at+'.visible: '+(e instanceof Error?e.message:'error'));}if(n.children)await visit(n.children,at+'.children');}};
 await visit(workflow.ui,'ui');return problems.slice(0,10);
}
export function workflowReportText(r:WorkflowReport){return JSON.stringify({passed:r.passed,blocking:r.blocking,shouldFix:[...(r.review?.issues||[]).filter(i=>i.severity==='major').map(i=>i.problem+(i.fix?' Fix: '+i.fix:'')),...r.warnings],polish:(r.review?.issues||[]).filter(i=>i.severity==='minor').map(i=>i.problem+(i.fix?' Fix: '+i.fix:'')),visualSummary:r.review?.summary,coverage:r.review?.coverage,tests:r.tests,screens:r.screens,seconds:r.seconds});}
