import {resolve,evaluate,bindingsIn,stepRefs} from './expressions';
import {isBinding,type Workflow,type RunTrace} from './schema';
// Runs a client action entirely in the browser: pure calculation steps only
// (validated), no server round trip, no access to data or permissions.
export async function runClientAction(workflow:Workflow,name:string,input:{state:Record<string,unknown>;values:Record<string,unknown>;event:unknown},page:{id:string;title:string}){
 let state={...input.state};const trace:RunTrace[]=[];let current:string|undefined=name;
 for(let chain=0;current&&chain<5;chain++){
  const action:Workflow['actions'][string]|undefined=workflow.actions[current];if(!action?.client)throw Error('Action '+current+' does not run in the browser.');
  const steps:Record<string,unknown>={},scope=()=>({state,values:input.values,event:input.event??null,page,steps});
  for(const step of action.steps){
   const t0=Date.now();
   if(step.when!==undefined&&!(isBinding(step.when)?await evaluate(step.when.$,scope()):step.when)){steps[step.id]=null;trace.push({step:step.id,tool:step.tool,status:'skipped',ms:0});continue;}
   const run=async(bindings:Record<string,unknown>={})=>{const args=await resolve(step.args||{},scope(),bindings) as Record<string,any>;
    if(step.tool==='compute')return args.value;
    if(step.tool==='json.parse'){const text=typeof args.text==='string'?args.text:String(args.text?.text??args.text?.content??'');return args.lines===true?text.split(/\r?\n/).filter(l=>l.trim()).map(l=>JSON.parse(l)):JSON.parse(text);}
    if(step.tool==='json.format')return JSON.stringify(args.value??null,null,args.pretty===false?0:2);
    throw Error('Unknown client tool '+step.tool);};
   try{
    if(step.each!==undefined){const list=isBinding(step.each)?await evaluate(step.each.$,scope()):step.each;const arr=list==null?[]:Array.isArray(list)?list:[list];if(arr.length>1000)throw Error('each has more than 1000 items.');const out=[];for(let i=0;i<arr.length;i++)out.push(await run({item:arr[i],index:i}));steps[step.id]=out;}
    else steps[step.id]=await run();
    trace.push({step:step.id,tool:step.tool,status:'ok',ms:Date.now()-t0});
   }catch(e){const message=e instanceof Error?e.message:'Step failed';trace.push({step:step.id,tool:step.tool,status:'error',ms:Date.now()-t0,error:message});if(!step.optional)return {state,trace,error:'Step '+step.id+' failed: '+message};steps[step.id]={error:message};}
  }
  if(action.set){const next={...state};for(const [k,v] of Object.entries(action.set))next[k]=await resolve(v,scope());state=next;}
  current=action.then;
 }
 return {state,trace};
}
export const usedRefs=(v:unknown)=>bindingsIn(v).flatMap(stepRefs);
