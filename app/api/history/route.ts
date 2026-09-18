import {parametersSchema} from '@/app/components-registry/contracts';
import {z} from 'zod';
import {getActor} from '@/app/actor';
import {database,getPage,reply,sameOrigin} from '@/db/store';
import {executeConversion} from '@/app/dynamic/execute';
const visitSchema=z.object({id:z.string().uuid(),pageId:z.string().min(1).max(200),question:z.string().max(4000),parameters:parametersSchema.optional(),legacy:z.boolean().optional()});
const removeSchema=z.object({id:z.string().uuid()});
export async function POST(request:Request){
 const actor=await getActor(request);const respond=(data:unknown,status=200)=>actor.finish(reply(data,status));
 if(!sameOrigin(request))return respond({error:'This request must come from the site.'},403);
 try{
  const parsed=visitSchema.safeParse(await request.json());if(!parsed.success)return respond({error:'Invalid history entry.'},400);
  const data=parsed.data,page=await getPage(data.pageId,actor.userId);
  if(!page||page.kind==='resource')return respond({error:'This page is private or does not exist.'},404);
  const now=Date.now();
  const parameters=page.kind==='dynamic'&&data.parameters?(page.dynamic?.template==='component-form-v1'?parametersSchema.parse(data.parameters):executeConversion(data.parameters).input):{};
  await database().prepare('INSERT OR IGNORE INTO page_visits(id,owner_key,page_id,title,question,parameters,visited_at,recorded_at) VALUES(?,?,?,?,?,?,?,?)').bind(data.id,actor.historyKey,page.id,page.title,data.question,JSON.stringify(parameters),data.legacy?null:now,now).run();
  return respond({saved:true});
 }catch{return respond({error:'Could not save this visit.'},503);}
}
export async function GET(request:Request){
 const actor=await getActor(request);const respond=(data:unknown,status=200)=>actor.finish(reply(data,status));
 try{
  const raw=new URL(request.url).searchParams.get('offset')||'0',offset=Number(raw);
  if(!Number.isSafeInteger(offset)||offset<0)return respond({error:'Invalid history offset.'},400);
  const rows=await database().prepare(`SELECT v.id,COALESCE(p.id,v.page_id) pageId,CASE WHEN p.visibility='public' OR p.owner_id=? THEN p.title ELSE v.title END title,v.question,v.parameters,v.visited_at visitedAt,CASE WHEN p.visibility='public' OR p.owner_id=? THEN 1 ELSE 0 END available FROM page_visits v LEFT JOIN pages p ON p.id=COALESCE((SELECT page_id FROM page_aliases WHERE id=v.page_id),v.page_id) WHERE v.owner_key=? AND NOT EXISTS(SELECT 1 FROM components c WHERE c.id=v.page_id AND c.type<>'page') ORDER BY v.visited_at DESC,v.recorded_at DESC,v.id DESC LIMIT 51 OFFSET ?`).bind(actor.userId,actor.userId,actor.historyKey,offset).all<{id:string;pageId:string;title:string;question:string;parameters:string;visitedAt:number|null;available:number}>();
  return respond({entries:rows.results.slice(0,50).map(row=>({...row,parameters:JSON.parse(row.parameters),available:!!row.available})),nextOffset:rows.results.length>50?offset+50:null});
 }catch{return respond({error:'Could not load history. Please try again.'},503);}
}
export async function DELETE(request:Request){
 const actor=await getActor(request);const respond=(data:unknown,status=200)=>actor.finish(reply(data,status));
 if(!sameOrigin(request))return respond({error:'This request must come from the site.'},403);
 try{
  const parsed=removeSchema.safeParse(await request.json());if(!parsed.success)return respond({error:'Invalid history entry.'},400);
  await database().prepare('DELETE FROM page_visits WHERE id=? AND owner_key=?').bind(parsed.data.id,actor.historyKey).run();
  return respond({removed:true});
 }catch{return respond({error:'Could not remove this history item.'},503);}
}
