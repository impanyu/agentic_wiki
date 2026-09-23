import {getActor} from '@/app/actor';
import {database,reply} from '@/db/store';

export type HomeCard={id:string;title:string;summary:string;kind:'static'|'dynamic';category:string;templateId:string;image:string|null;at:number|null;owned:boolean};
type PageRow={id:string;title:string;summary:string;kind:'static'|'dynamic';category:string;labels:string;body:string;owner_id:string;at:number|null;created_at:string;updated_at:string|null};

// The first Markdown image in the body serves as the card thumbnail.
const thumbnail=(body:string)=>body.match(/!\[[^\]]*\]\(\s*((?:https:\/\/|\/api\/)[^\s)]+)\s*\)/)?.[1]||null;
const card=(row:PageRow,userId:string):HomeCard=>{let templateId='';try{templateId=String(JSON.parse(row.labels||'{}').templateId||'');}catch{}return {id:row.id,title:row.title,summary:row.summary,kind:row.kind,category:row.category,templateId,image:thumbnail(row.body||''),at:row.at??(Date.parse(row.updated_at||row.created_at)||null),owned:row.owner_id===userId};};

// Home page data: the reader's recently visited pages.
export async function GET(request:Request){
 const actor=await getActor(request);
 try{
  const visited=await database().prepare(`SELECT p.id,p.title,p.summary,p.kind,p.category,p.labels,CASE WHEN instr(p.body,'![')>0 THEN substr(p.body,instr(p.body,'!['),1200) ELSE '' END body,p.owner_id,max(v.visited_at) at,p.created_at,p.updated_at FROM page_visits v JOIN pages p ON p.id=COALESCE((SELECT page_id FROM page_aliases WHERE id=v.page_id),v.page_id) WHERE v.owner_key=? AND v.visited_at IS NOT NULL AND (p.visibility='public' OR p.owner_id=?) AND p.kind IN ('static','dynamic') GROUP BY p.id ORDER BY at DESC LIMIT 64`).bind(actor.historyKey,actor.userId).all<PageRow>();
  return actor.finish(reply({visited:visited.results.map(row=>card(row,actor.userId))}));
 }catch{return actor.finish(reply({error:'Could not load the home page.'},503));}
}
