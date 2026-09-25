import {database,getPage,lock,unlock} from '@/db/store';
import {canWritePage} from '@/app/page-permissions';
import type {AnswerPage} from '@/app/page-types';

// A page's long-running live agent: on a schedule it runs the page's own in-page agent with a
// maintenance brief, as the user who switched it on, and saves the change that agent stages
// (wiki edits pass the wiki validators, app changes pass verify_app). Each saved change is
// preceded by a snapshot of the page so the owner can undo it.

export const LIVE_INTERVALS=[1,6,12,24,72,168] as const;
const RUN_BUDGET=15*60*1000;
type Row={page_id:string;owner_id:string;enabled:number;interval_hours:number;focus:string;next_run_at:number|null;last_run_at:number|null;last_status:string;last_summary:string;last_revision_id:string|null;running_until:number;runs:number};
export type LiveAgentStatus={enabled:boolean;intervalHours:number;focus:string;running:boolean;lastRunAt:number|null;nextRunAt:number|null;lastStatus:string;lastSummary:string;canRevert:boolean;canEdit:boolean;runs:number};

const row=(pageId:string)=>database().prepare('SELECT * FROM page_live_agents WHERE page_id=?').bind(pageId).first<Row>();
function status(r:Row|null,canEdit:boolean):LiveAgentStatus{
 return {enabled:!!r?.enabled,intervalHours:r?.interval_hours||24,focus:canEdit?r?.focus||'':'',running:!!r&&r.running_until>Date.now(),lastRunAt:r?.last_run_at??null,nextRunAt:r?.enabled?r.next_run_at:null,lastStatus:r?.last_status||'',lastSummary:canEdit?r?.last_summary||'':'',canRevert:canEdit&&!!r?.last_revision_id,canEdit,runs:r?.runs||0};
}
export async function liveAgentStatus(pageId:string,userId:string){
 const page=await getPage(pageId,userId);if(!page||page.kind==='resource')return null;
 return status(await row(pageId),canWritePage(page));
}
export async function setLiveAgent(pageId:string,userId:string,input:{enabled?:boolean;intervalHours?:number;focus?:string}){
 const page=await getPage(pageId,userId);if(!page||!canWritePage(page))throw Error('Only people who can edit this page can manage its live agent.');
 const current=await row(pageId),now=Date.now();
 const interval=input.intervalHours??current?.interval_hours??24;if(!(LIVE_INTERVALS as readonly number[]).includes(interval))throw Error('Choose a supported frequency.');
 const enabled=input.enabled??!!current?.enabled,focus=(input.focus??current?.focus??'').slice(0,600);
 // Switching on starts the first run within a minute; changing the frequency reschedules from the last run.
 const next=!enabled?null:!current?.enabled?now+30000:Math.max(now+30000,(current.last_run_at||now)+interval*3600000);
 await database().prepare(`INSERT INTO page_live_agents(page_id,owner_id,enabled,interval_hours,focus,next_run_at,updated_at) VALUES(?,?,?,?,?,?,?)
  ON CONFLICT(page_id) DO UPDATE SET owner_id=excluded.owner_id,enabled=excluded.enabled,interval_hours=excluded.interval_hours,focus=excluded.focus,next_run_at=excluded.next_run_at,updated_at=excluded.updated_at`).bind(pageId,userId,enabled?1:0,interval,focus,next,new Date().toISOString()).run();
 return status(await row(pageId),true);
}
export async function dueLiveAgents(limit=2){
 const now=Date.now();
 return (await database().prepare('SELECT page_id FROM page_live_agents WHERE enabled=1 AND next_run_at<=? AND running_until<? ORDER BY next_run_at LIMIT ?').bind(now,now,limit).all<{page_id:string}>()).results.map(r=>r.page_id);
}
export async function runningLiveAgents(){return Number((await database().prepare('SELECT count(*) n FROM page_live_agents WHERE running_until>?').bind(Date.now()).first<{n:number}>())?.n||0);}

export function maintenanceBrief(page:AnswerPage,focus:string){
 const app=page.kind==='dynamic';
 const brief=app
  ?'Live agent — scheduled maintenance of this web app. You maintain it on the owner’s behalf as a senior engineer. Now: read_app_definition, run the app, and verify_app with realistic tests of the first load, the main user flow and an edge case; review recent chat turns for problems the owner reported. Fix real bugs, failing tool calls, broken or confusing UI, misleading states and outdated logic. Keep the app’s purpose and existing features and do not add unrequested features. Propose a revision only if it passes verification and clearly improves the app; it will be saved automatically. If everything works, propose nothing and say so.'
  :'Live agent — scheduled maintenance of this wiki page. You maintain it on the owner’s behalf. Check it now: verify key facts and look for recent developments with web search, correct errors or outdated statements, repair broken images or links, make sure claims carry inline [n] citations to the listed sources, and fill clear gaps within the page’s current scope, language and style. Do not rewrite sound content or change the topic. If an improvement is warranted, stage the edit; it will be saved automatically after validation. If nothing needs changing, stage nothing and say so.';
 return (brief+(focus.trim()?' Owner’s maintenance focus: '+focus.trim():'')+' Reply with a short changelog of what you checked and what you changed.').slice(0,2000);
}

async function snapshot(pageId:string,ownerId:string,summary:string){
 const current=await database().prepare('SELECT title,summary,body,dynamic_config,labels,kind,sources,category FROM pages WHERE id=?').bind(pageId).first<Record<string,unknown>>();
 if(!current)throw Error('Page not found.');
 const id=crypto.randomUUID();
 await database().prepare('INSERT INTO page_revisions(id,page_id,owner_id,source,snapshot,summary,created_at) VALUES(?,?,?,?,?,?,?)').bind(id,pageId,ownerId,'live-agent',JSON.stringify(current),summary.slice(0,1000),new Date().toISOString()).run();
 return id;
}

// One maintenance run. The page's chat turn runs as the owner who switched the agent on, so it
// appears in the page conversation like any other request and uses the same tools and checks.
export async function runLiveAgent(pageId:string,options:{force?:boolean}={}){
 const lease=await lock('live-agent:'+pageId,RUN_BUDGET);if(!lease)return {skipped:'already running'};
 const started=Date.now();let outcome='',summary='',revisionId:string|null=null,retryAt:number|null=null;
 try{
  const r=await row(pageId);if(!r||(!r.enabled&&!options.force))return {skipped:'disabled'};
  await database().prepare('UPDATE page_live_agents SET running_until=? WHERE page_id=?').bind(started+RUN_BUDGET,pageId).run();
  const page=await getPage(pageId,r.owner_id);
  if(!page||!canWritePage(page)){await database().prepare("UPDATE page_live_agents SET enabled=0,last_status='stopped',last_summary=? WHERE page_id=?").bind('The live agent was switched off: its owner can no longer edit this page.',pageId).run();return {skipped:'no access'};}
  const {handlePost}=await import('@/app/chat/page-turn');
  const origin=process.env.APP_URL?new URL(process.env.APP_URL).origin:'http://127.0.0.1:'+(process.env.PORT||'3000');
  const actor={userId:r.owner_id,userName:'Live agent',signedIn:true,historyKey:'user:'+r.owner_id,cookie:null,finish:(response:Response)=>response} as unknown as Parameters<typeof handlePost>[2];
  const call=async(body:Record<string,unknown>)=>{const response=await handlePost(new Request(origin+'/api/pages/'+pageId+'/chat',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(RUN_BUDGET-60000)}),{params:Promise.resolve({id:pageId})},actor);return {status:response.status,data:await response.json().catch(()=>({})) as {reply?:string;error?:string;editDraft?:{id?:string}|null}};};
  const turn=await call({message:maintenanceBrief(page,r.focus)});
  if(turn.status===409){outcome='postponed';summary='The page agent was busy with another conversation; the live agent will try again shortly.';retryAt=Date.now()+10*60000;return {outcome};}
  if(turn.status>=400){outcome='failed';summary=turn.data.error||'The maintenance run could not finish.';return {outcome};}
  summary=String(turn.data.reply||'');
  const draftId=turn.data.editDraft?.id;
  if(!draftId){outcome='checked';return {outcome};}
  revisionId=await snapshot(pageId,r.owner_id,summary);
  const saved=await call({saveDraftId:draftId});
  if(saved.status>=400){outcome='not saved';summary=(saved.data.error||'The proposed change could not be saved.')+'\n\n'+summary;await database().prepare('DELETE FROM page_revisions WHERE id=?').bind(revisionId).run();revisionId=null;return {outcome};}
  outcome='updated';return {outcome};
 }catch(e){outcome='failed';summary=e instanceof Error?e.message.slice(0,500):'The maintenance run failed.';return {outcome};}
 finally{
  const r=await row(pageId).catch(()=>null);
  if(r&&outcome){const next=retryAt??(r.enabled?Date.now()+r.interval_hours*3600000:null);
   await database().prepare('UPDATE page_live_agents SET running_until=0,last_run_at=?,last_status=?,last_summary=?,next_run_at=?,runs=runs+1'+(revisionId?',last_revision_id=?':'')+' WHERE page_id=?').bind(...[Date.now(),outcome,summary.slice(0,4000),next,...(revisionId?[revisionId]:[]),pageId]).run().catch(()=>{});}
  else await database().prepare('UPDATE page_live_agents SET running_until=0 WHERE page_id=?').bind(pageId).run().catch(()=>{});
  await unlock(lease).catch(()=>{});
 }
}

// Undo the live agent's most recent saved change by restoring the snapshot taken before it.
export async function revertLiveAgentChange(pageId:string,userId:string){
 const page=await getPage(pageId,userId);if(!page||!canWritePage(page))throw Error('Only people who can edit this page can undo live agent changes.');
 const r=await row(pageId);if(!r?.last_revision_id)throw Error('There is no live agent change to undo.');
 const rev=await database().prepare('SELECT snapshot FROM page_revisions WHERE id=? AND page_id=?').bind(r.last_revision_id,pageId).first<{snapshot:string}>();if(!rev)throw Error('The saved snapshot is no longer available.');
 const s=JSON.parse(rev.snapshot) as {title:string;summary:string;body:string;dynamic_config:string|null;labels:string;kind:string;sources:string;category:string};
 const config=s.dynamic_config?JSON.parse(s.dynamic_config) as {components?:Record<string,{id:string;version:number}|undefined>}:null;
 const lease=await lock('refresh:'+pageId,90000);if(!lease)throw Error('This page is being updated. Try again.');
 try{
  await database().batch([
   database().prepare('UPDATE pages SET title=?,summary=?,body=?,dynamic_config=?,labels=?,kind=?,sources=?,category=?,updated_at=? WHERE id=?').bind(s.title,s.summary,s.body,s.dynamic_config,s.labels,s.kind,s.sources,s.category,new Date().toISOString(),pageId),
   ...Object.entries(config?.components||{}).filter(([,ref])=>ref).map(([role,ref])=>database().prepare('INSERT INTO component_dependencies(parent_id,role,component_id,version) VALUES(?,?,?,?) ON CONFLICT(parent_id,role) DO UPDATE SET component_id=excluded.component_id,version=excluded.version').bind(pageId,role,ref!.id,ref!.version)),
   database().prepare("UPDATE page_live_agents SET last_revision_id=NULL,last_status='reverted' WHERE page_id=?").bind(pageId),
  ]);
 }finally{await unlock(lease);}
 return status(await row(pageId),true);
}
