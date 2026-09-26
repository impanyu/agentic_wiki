import {getActor} from '@/app/actor';
import {database,reply} from '@/db/store';

export type HomeCard={id:string;title:string;summary:string;kind:'static'|'dynamic';category:string;templateId:string;image:string|null;at:number|null;owned:boolean;liveAgent:boolean;agentRunning:boolean};
export type CardStatus={liveAgent:boolean;agentRunning:boolean};
type PageRow={id:string;title:string;summary:string;kind:'static'|'dynamic';category:string;labels:string;body:string;owner_id:string;at:number|null;created_at:string;updated_at:string|null;live_agent:number;agent_running:number};

// The first Markdown image in the body serves as the card thumbnail.
const thumbnail=(body:string)=>body.match(/!\[[^\]]*\]\(\s*((?:https:\/\/|\/api\/)[^\s)]+)\s*\)/)?.[1]||null;
const card=(row:PageRow,userId:string):HomeCard=>{let templateId='';try{templateId=String(JSON.parse(row.labels||'{}').templateId||'');}catch{}return {id:row.id,title:row.title,summary:row.summary,kind:row.kind,category:row.category,templateId,image:thumbnail(row.body||''),at:row.at??(Date.parse(row.updated_at||row.created_at)||null),owned:row.owner_id===userId,liveAgent:!!row.live_agent,agentRunning:!!row.agent_running};};
// Whether the page's live agent is on, and whether an agent is working on it now: the reader's own
// page-agent turn or the live agent's run (other visitors' chats are private).
const statusColumns=`(SELECT enabled FROM page_live_agents l WHERE l.page_id=p.id) live_agent,(EXISTS(SELECT 1 FROM context_jobs j WHERE j.page_id=p.id AND j.owner_id=? AND j.state='running' AND j.expires>? AND j.kind IN ('page-agent','wiki-agent')) OR EXISTS(SELECT 1 FROM page_live_agents l WHERE l.page_id=p.id AND l.running_until>?)) agent_running`;
const PAGE=24;

// Home page data: the reader's recently visited pages, newest visit first, 24 at a time
// (?before=<visit time of the last card> for the next page), or ?ids=a,b for fresh card statuses.
export async function GET(request:Request){
 const actor=await getActor(request),url=new URL(request.url),now=Date.now();
 try{
  const ids=url.searchParams.get('ids');
  if(ids!==null){
   const list=ids.split(',').filter(id=>/^[0-9a-f-]{36}$/i.test(id)).slice(0,200);if(!list.length)return actor.finish(reply({statuses:{}}));
   const rows=await database().prepare(`SELECT p.id,${statusColumns} FROM pages p WHERE p.id IN (${list.map(()=>'?').join(',')}) AND (p.visibility='public' OR p.owner_id=?)`).bind(actor.userId,now,now,...list,actor.userId).all<{id:string;live_agent:number;agent_running:number}>();
   return actor.finish(reply({statuses:Object.fromEntries(rows.results.map(r=>[r.id,{liveAgent:!!r.live_agent,agentRunning:!!r.agent_running}]))}));
  }
  const before=Number(url.searchParams.get('before'))||0;
  const visited=await database().prepare(`SELECT p.id,p.title,p.summary,p.kind,p.category,p.labels,CASE WHEN instr(p.body,'![')>0 THEN substr(p.body,instr(p.body,'!['),1200) ELSE '' END body,p.owner_id,max(v.visited_at) at,p.created_at,p.updated_at,${statusColumns} FROM page_visits v JOIN pages p ON p.id=COALESCE((SELECT page_id FROM page_aliases WHERE id=v.page_id),v.page_id) WHERE v.owner_key=? AND v.visited_at IS NOT NULL AND (p.visibility='public' OR p.owner_id=?) AND p.kind IN ('static','dynamic') GROUP BY p.id HAVING ?=0 OR max(v.visited_at)<? ORDER BY at DESC LIMIT ${PAGE+1}`).bind(actor.userId,now,now,actor.historyKey,actor.userId,before,before).all<PageRow>();
  const rows=visited.results.slice(0,PAGE),more=visited.results.length>PAGE;
  return actor.finish(reply({visited:rows.map(row=>card(row,actor.userId)),next:more&&rows.length?rows[rows.length-1].at:null}));
 }catch{return actor.finish(reply({error:'Could not load the home page.'},503));}
}
