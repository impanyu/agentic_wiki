import {TOOLS,type ToolContext} from './tools';
import {resolve,evaluate,bindingsIn,stepRefs} from './expressions';
import {isBinding,LIMITS,type Workflow,type RunResult,type RunTrace,type WorkflowStep} from './schema';
// The workflow executor is the sandbox: it runs only catalog tools, resolves
// bindings with the bounded expression evaluator, and enforces budgets. Steps
// start as soon as the steps they read have finished.
export type RunInput={state?:Record<string,unknown>;values?:Record<string,unknown>;event?:unknown};
const preview=(v:unknown)=>{let s:string;try{s=JSON.stringify(v)??String(v);}catch{s=String(v);}return s.length>600?s.slice(0,600)+'… ('+s.length+' chars)':s;};
const isProposal=(r:unknown):r is {actionId:string;request:unknown}=>!!r&&typeof r==='object'&&'confirmationRequired' in r&&'actionId' in r&&'request' in r;
const errorOf=(r:unknown)=>r&&typeof r==='object'&&!Array.isArray(r)&&'error' in r&&Object.keys(r).length<=3?String((r as {error:unknown}).error):null;
// keepSteps returns the step outputs of the last action run (for the agents' workbench).
export async function runAction(workflow:Workflow,name:string,input:RunInput,ctx:ToolContext,options:{keepSteps?:boolean}={}):Promise<RunResult>{
 const started=Date.now(),trace:RunTrace[]=[],proposals:RunResult['proposals']=[];
 let state:Record<string,unknown>={...workflow.state,...(input.state||{})},calls=0,current:string|undefined=name,lastOutputs:Record<string,unknown>={};
 const values=input.values||{},page={id:ctx.pageId};
 for(let chain=0;current&&chain<5;chain++){
  const action:Workflow['actions'][string]|undefined=workflow.actions[current];if(!action)return {state,steps:{},proposals,trace,error:'Unknown action "'+current+'".'};
  const outputs:Record<string,unknown>={},done=new Map<string,Promise<void>>();let failure:string|undefined;
  const scope=()=>({state,values,event:input.event??null,page,steps:outputs});
  let active=0;const waiters:(()=>void)[]=[];
  const slot=async()=>{while(active>=6)await new Promise<void>(r=>waiters.push(r));active++;};
  const release=()=>{active--;waiters.shift()?.();};
  const callTool=async(step:WorkflowStep,args:Record<string,unknown>)=>{
   const tool=TOOLS[step.tool];if(!tool)throw Error('Unknown tool '+step.tool);
   if(++calls>LIMITS.callsPerRun)throw Error('This run made more than '+LIMITS.callsPerRun+' tool calls.');
   if(Date.now()-started>LIMITS.runMs)throw Error('This run took longer than '+LIMITS.runMs/1000+' seconds.');
   const local=['files.write','files.zip'].includes(step.tool);
   if(local&&ctx.verification)return {skipped:true,verification:'Not executed during verification: '+step.tool+' writes a Page file.'};
   if(local&&!ctx.explicit)throw Error(step.tool+' needs a user action (a button, form or selection).');
   await slot();try{return await tool.run(args,ctx);}finally{release();}
  };
  const runStep=async(step:WorkflowStep)=>{
   const deps=[...new Set([...bindingsIn(step.args),...bindingsIn(step.when),...bindingsIn(step.each)].flatMap(stepRefs))];
   await Promise.all(deps.map(d=>done.get(d)));
   if(failure)return;
   const t0=Date.now();
   try{
    if(step.when!==undefined&&!(isBinding(step.when)?await evaluate(step.when.$,scope()):step.when)){outputs[step.id]=null;trace.push({step:step.id,tool:step.tool,status:'skipped',ms:0});return;}
    let result:unknown,items:number|undefined;
    if(step.each!==undefined){
     const list=isBinding(step.each)?await evaluate(step.each.$,scope()):step.each;
     const array=list==null?[]:Array.isArray(list)?list:[list];
     if(array.length>LIMITS.eachItems)throw Error('each has '+array.length+' items; the limit is '+LIMITS.eachItems+'.');
     items=array.length;
     result=await Promise.all(array.map(async(item,index)=>{const r=await callTool(step,await resolve(step.args||{},scope(),{item,index}) as Record<string,unknown>);if(isProposal(r))proposals.push({actionId:r.actionId,request:r.request});return r;}));
    }else{result=await callTool(step,await resolve(step.args||{},scope()) as Record<string,unknown>);if(isProposal(result))proposals.push({actionId:result.actionId,request:result.request});}
    const problem=errorOf(result);
    if(problem&&!step.optional)throw Error(problem);
    outputs[step.id]=result;
    trace.push({step:step.id,tool:step.tool,status:problem?'error':isProposal(result)?'proposal':result&&typeof result==='object'&&'skipped' in result?'skipped':'ok',ms:Date.now()-t0,...(problem?{error:problem}:{}),...(items!==undefined?{items}:{}),preview:preview(result)});
   }catch(e){
    const message=e instanceof Error?e.message:'Step failed';
    trace.push({step:step.id,tool:step.tool,status:'error',ms:Date.now()-t0,error:message.slice(0,500)});
    if(step.optional){outputs[step.id]={error:message};return;}
    failure??='Step '+step.id+' ('+step.tool+') failed: '+message.slice(0,500);
   }
  };
  for(const step of action.steps)done.set(step.id,runStep(step));
  await Promise.all(done.values());
  lastOutputs=outputs;
  if(failure)return {state,steps:options.keepSteps?outputs:{},proposals,trace,error:failure};
  if(action.set){
   const next={...state};
   for(const [key,value] of Object.entries(action.set)){try{next[key]=await resolve(value,scope());}catch(e){return {state,steps:{},proposals,trace,error:'Setting state.'+key+' failed: '+(e instanceof Error?e.message:'error')};}}
   if(JSON.stringify(next).length>LIMITS.stateBytes)return {state,steps:{},proposals,trace,error:'The app state is larger than 2 MB; keep only what the page shows.'};
   state=next;
  }
  current=action.then;
 }
 return {state,steps:options.keepSteps?lastOutputs:{},proposals,trace};
}
