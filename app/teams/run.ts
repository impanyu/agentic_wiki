import {spawnAgent} from '@/app/agents/runtime';
import {entityDb} from '@/app/entity-db/client';
import {createTopic,getTopic} from '@/app/entity-db/repo';
import {OWNER,type Log} from './agent-call';
import {WorkflowStopped} from './workflow';
// No model could answer for now (all busy, over their caps, or timing out): the run is retried later, not failed.
export const transientModelError=(e:unknown)=>/AI_UNAVAILABLE|AI_LIMIT|AI_SETUP|timeout|aborted due to timeout|pool busy|ECONNRESET|fetch failed/i.test(String((e as Error)?.message||e));
// Runs one cycle of a topic team: picks the focus subtopic, starts (or resumes) the workflow the charter defines for
// why the team was queued (app/teams/charter.ts), checkpoints after every step and reports the result.
export {askManager,placeTopic,workflowOf,type WorkflowKind} from './charter';
import type {WorkflowKind,Ctx,TeamState} from './charter';

export async function runTopicTeam({slug,name,brief,kind='build',note='',maxFixRounds=2,log=()=>{}}:{slug:string;name:string;brief:string;kind?:WorkflowKind;note?:string;maxFixRounds?:number;log?:Log}){
 const db=await entityDb();
 const {WORKFLOWS}=await import('./charter');const workflow=WORKFLOWS[kind];
 // slug is the team; each cycle works on one focus subtopic the team owns: the one the note names (a repair, a review
 // of that subtopic), else for a build the most important subtopic not covered yet, else the team's own node.
 const team=await getTopic(db,slug)??await createTopic(db,{slug,name,description:brief});
 const {uncovered}=await import('./ownership');
 const named=/\[([a-z0-9-]+)\]/.exec(note)?.[1];
 const next=kind==='build'&&!named?(await uncovered(db,slug))[0]:undefined;
 const topic=(named&&await getTopic(db,named))||(next&&await getTopic(db,next.slug))||team;
 // A branch team with nothing left to cover (its subtopics moved or are all covered) has no build to do.
 if(kind==='build'&&!named&&!next&&(await db.query('select 1 from topics where parent_id=$1::uuid and status <> \'archived\' limit 1',[team.id])).rows.length){
  log({event:'team_finished',kind,approved:true,note:'nothing to cover'});
  return {topic:team.slug,team:slug,kind,stages:{},more:false,verdict:{approved:true,issues:[],summary:'nothing to cover'},rounds:[],ruling:null,platformIssues:[]};
 }
 const focusBrief=String((topic.scope as Record<string,unknown>|undefined)?.brief||topic.description||brief);
 const agents={editor:await spawnAgent('team-editor:'+slug,OWNER),collector:await spawnAgent('team-collector:'+slug,OWNER),reviewer:await spawnAgent('team-review:'+slug,OWNER)};
 // Checkpoints (platform_state "team:<team>:<focus>"): a run cut off by a restart resumes at its next step; a
 // checkpoint of another workflow or older than 12 hours is not reused.
 const {getState,setState}=await import('./manager');const key='team:'+slug+':'+topic.slug;
 const saved=await getState(db,key).catch(()=>null);
 const fresh=saved&&typeof saved.at==='string'&&Date.now()-Date.parse(saved.at)<12*3600_000&&(saved.kind??'build')===kind?saved as TeamState:{};
 const state:TeamState={...fresh,_maxFixRounds:maxFixRounds};
 const c:Ctx={db,topic:{id:topic.id,slug:topic.slug},info:{topic:{slug:topic.slug,name:topic.name,brief:focusBrief},...(topic.slug!==slug?{team:{slug,name,brief}}:{})} as Ctx['info'],r:state,log,agents,maxFixRounds};
 log({event:'focus',topic:topic.slug});
 // Where to start: the checkpoint's next step; an older checkpoint (stage results only) at its first unfinished stage.
 const at=typeof fresh._next==='string'?fresh._next:Object.keys(fresh).some(k=>workflow.nodes.has(k))?workflow.resumePoint(state):undefined;
 log({event:'workflow_started',kind});
 try{
  if(at!=='end')await workflow.run(state,c,{at,log,checkpoint:async(s,nextStep)=>{s.at=new Date().toISOString();s.kind=kind;s._next=nextStep;await setState(db,key,s).catch(()=>{});}});
 }catch(e){
  if(e instanceof WorkflowStopped){
   const {raiseIssue}=await import('@/app/ops/issues');
   await raiseIssue(db,{source:'team',topic:slug,severity:'major',title:'Team stopped at stage '+e.node+' ('+kind+')',detail:e.message,fingerprint:'team-stage:'+slug+':'+e.node}).catch(()=>{});
  }
  // A model outage is not the team's failure: the checkpoint stays, so the retry resumes at the stopped step.
  if(!transientModelError(e))await db.query('delete from platform_state where key=$1::text',[key]).catch(()=>{});
  throw e;
 }
 const verdict=(state.verdict as {approved:boolean;issues:unknown[];summary:string}|undefined)??{approved:true,issues:[],summary:kind+' finished'};
 log({event:'team_finished',kind,approved:verdict.approved});
 await db.query('delete from platform_state where key=$1::text',[key]).catch(()=>{});
 // More subtopics of this team still to cover: the queue runs the team again (status queued, next focus).
 const more=kind==='build'&&(await uncovered(db,slug)).some(u=>u.slug!==topic.slug);
 return {topic:topic.slug,team:slug,kind,stages:state,more,verdict,rounds:(state.rounds as unknown[])||[],ruling:state.ruling??null,platformIssues:(state.platformIssues as unknown[])||[]};
}
