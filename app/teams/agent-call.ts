import type {AgentContext} from '@/app/components-registry/registry';
import {askAgent,type Agent} from '@/app/agents/runtime';
import {entityDb} from '@/app/entity-db/client';
import {teamToolDefs,runTeamTool,coverage,type Role} from './tools';
import {startTeamRun,logTeamCall,finishTeamRun,listEntityTypes} from './config';
// One agent call of a team member: model choice and escalation, the call budget, the program's acceptance check,
// and the operations log (team_runs: every agent call and tool call). What the call is for lives in charter.ts.
export const OWNER='rankwiki-team';
export type Log=(e:Record<string,unknown>)=>void;
// Models: the builders (editor, collector) work on the strongest open models first, with the commercial model
// as the last link of their chain (the "agent" class); the reviewer judges on open models of another family ("review"),
// the manager on the commercial model.
// A builder step that fails or never passes its checks on the open chain is redone once on the commercial model,
// so an open model can never lower the quality floor.
export type Accept=()=>Promise<string|undefined>;
export async function ask(role:Role,agent:Agent,topicId:string,instructions:string,task:unknown,schema:Record<string,unknown>,log:Log,budget:{rounds:number;calls:number},accept?:Accept,tools?:string[]){
 const builder=role==='editor'||role==='collector';
 // The team's reviewer judges on open models too (a different family from the builders', so it is an independent
 // check), with the commercial model as its fallback; the manager's rulings stay on the commercial model.
 // REVIEWER_CLASS=premium puts reviews back on the commercial model.
 if(role==='reviewer'&&process.env.REVIEWER_CLASS!=='premium'){
  try{return await askOnce(role,agent,topicId,instructions,task,schema,log,budget,'review',accept,tools);}
  catch(e){log({event:'escalated',role,from:'review',to:'premium',reason:(e as Error).message.slice(0,300)});return askOnce(role,agent,topicId,instructions,task,schema,log,budget,'premium',accept,tools);}
 }
 if(!builder)return askOnce(role,agent,topicId,instructions,task,schema,log,budget,'premium',accept,tools);
 try{return await askOnce(role,agent,topicId,instructions,task,schema,log,budget,'agent',accept,tools);}
 catch(e){log({event:'escalated',role,from:'agent',to:'premium',reason:(e as Error).message.slice(0,300)});return askOnce(role,agent,topicId,instructions,task,schema,log,budget,'premium',accept,tools);}
}
async function askOnce(role:Role,agent:Agent,topicId:string,instructions:string,task:unknown,schema:Record<string,unknown>,log:Log,budget:{rounds:number;calls:number},llmClass:'agent'|'premium'|'review',accept?:Accept,tools?:string[]){
 const db=await entityDb();
 const runId=await startTeamRun(db,{topicId,role,task:typeof task==='string'?task:JSON.stringify(task)});
 const ctx={userId:OWNER,ownerId:OWNER,language:'en',visibility:'public',agent:{id:agent.id}} as unknown as AgentContext;
 log({event:'agent_started',role,runId,llmClass});
 let calls=0;
 try{
  const result=await askAgent(agent,instructions,task,schema,undefined,undefined,[],{
   llmClass,...(llmClass==='review'?{avoidModel:'deepseek-v4-flash'}:{}),timeoutMs:40*60_000,maxRounds:budget.rounds,
   // A verdict must rest on evidence gathered in this review.
   ...(role==='reviewer'?{validateFinal:async()=>calls<6?'Check with your tools before deciding (coverage, preview_page of every ranking and several entity pages, spot checks against the source); then return the verdict.':undefined}:{}),
   // A collector's report is accepted only when the data refreshes by itself (no recipe problems for the topic's types).
   // A stage's own acceptance check replaces the role's default.
   ...(accept?{maxValidationRetries:3,validateFinal:async()=>accept()}:role==='collector'?{maxValidationRetries:3,validateFinal:async()=>{
    const problems:string[]=[];for(const t of await listEntityTypes(db,topicId)){const c=await coverage(t.type,'',0);problems.push(...c.recipeProblems,...c.dataProblems);}
    return problems.length?'Your report cannot be accepted yet — the data is your responsibility; fix these first (correct the recipe and run_recipe until it succeeds; fix or remove wrong rows): '+problems.slice(0,8).join(' '):undefined;}}:{}),maxCalls:budget.calls,maxInputChars:400_000,
   // A stage may narrow the tools to what its deliverable needs (focus: no browsing while loading).
   extraTools:tools?teamToolDefs(role).filter(t=>tools.includes(t.name)):teamToolDefs(role),executeExtra:(name,args)=>{if(tools&&!tools.includes(name))throw Error(name+' is not used in this stage; use: '+tools.join(', '));return runTeamTool(role,name,args,ctx,topicId);},
   onEvent:e=>{
    if(e.kind==='tool_started'){calls++;const d=e.data as {tool:string;arguments:string};void logTeamCall(db,runId,{t:Date.now(),tool:d.tool,args:String(d.arguments).slice(0,2000)});log({event:'tool',role,tool:d.tool});}
    else if(e.kind==='tool_finished'){const d=e.data as {tool:string;result:unknown};void logTeamCall(db,runId,{t:Date.now(),tool:d.tool,result:JSON.stringify(d.result).slice(0,3000)});}
   }});
  await finishTeamRun(db,runId,{status:'done',summary:JSON.stringify(result)});
  log({event:'agent_finished',role,runId});
  return result;
 }catch(e){await finishTeamRun(db,runId,{status:'failed',summary:(e as Error).message});log({event:'agent_failed',role,error:(e as Error).message});throw e;}
}

