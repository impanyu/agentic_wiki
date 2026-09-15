import {canWritePage} from '@/app/page-permissions';
import {parametersSchema} from '@/app/components-registry/contracts';
import {executeConversion} from '@/app/dynamic/execute';
import {z} from 'zod';
import {getActor} from '@/app/actor';
import {database,getPage,reply,sameOrigin} from '@/db/store';
import {articleNodes} from '@/app/internal-links';
const input=z.object({parameters:parametersSchema.optional(),sourceId:z.string().uuid(),targetId:z.string().uuid(),quote:z.string().trim().min(1).max(4000),segments:z.array(z.object({node:z.string().max(80),start:z.number().int().min(0),end:z.number().int().positive()})).min(1).max(1000)});
export async function POST(request:Request){
 const actor=await getActor(request);const respond=(data:unknown,status=200)=>actor.finish(reply(data,status));
 if(!sameOrigin(request))return respond({error:'This request must come from the site.'},403);
 try{
  const parsed=input.safeParse(await request.json());if(!parsed.success)return respond({error:'Invalid selected text.'},400);
  const data=parsed.data,uid=actor.userId;
  const source=await getPage(data.sourceId,uid),target=await getPage(data.targetId,uid);
  if(!source||!target)return respond({error:'This page is private or does not exist.'},404);
  if(!canWritePage(source))return respond({error:'This page is read-only.'},403);
  const nodes=articleNodes(source),seen=new Set<string>();
  for(const segment of data.segments){const value=nodes.get(segment.node);if(value===undefined||segment.start>=segment.end||segment.end>value.length||seen.has(segment.node))return respond({error:'The selected text has changed. Select it again.'},400);seen.add(segment.node);}
  const selectedText=data.segments.map(s=>nodes.get(s.node)!.slice(s.start,s.end)).join('');
  if(selectedText.replace(/\s/g,'')!==data.quote.replace(/\s/g,''))return respond({error:'The selected text has changed. Select it again.'},400);
  const parameters=JSON.stringify(target.kind==='dynamic'&&data.parameters?(target.dynamic?.template==='component-form-v1'?parametersSchema.parse(data.parameters):executeConversion(data.parameters).input):{});
  const segments=JSON.stringify(data.segments),bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([source.id,target.id,segments,parameters])));
  const id=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
  // Recheck both permissions in the write itself, including privacy changes during navigation.
  const result=await database().prepare(`INSERT OR IGNORE INTO internal_links(id,source_id,target_id,quote,segments,created_at,parameters) SELECT ?,s.id,t.id,?,?,?,? FROM pages s,pages t WHERE s.id=? AND t.id=? AND ((s.visibility='public' AND s.public_write=1) OR s.owner_id=?) AND (t.visibility='public' OR t.owner_id=?)`).bind(id,data.quote,segments,new Date().toISOString(),parameters,source.id,target.id,uid,uid).run();
  if(!result.meta.changes&&!await database().prepare('SELECT id FROM internal_links WHERE id=?').bind(id).first())return respond({error:'This page is no longer accessible.'},404);
  await database().prepare(`DELETE FROM internal_links WHERE EXISTS(SELECT 1 FROM pages WHERE id=source_id AND (owner_id=? OR (visibility='public' AND public_write=1))) AND source_id=? AND segments=? AND quote=? AND id<>? AND target_id IN (SELECT id FROM pages WHERE visibility='public' OR owner_id=?)`).bind(uid,source.id,segments,data.quote,id,uid).run();
  return respond({saved:true});
 }catch(e){console.error('Internal link save failed',e instanceof Error?e.message:'unknown');return respond({error:'The page opened, but its underline could not be saved. Please try again.'},503);}
}
