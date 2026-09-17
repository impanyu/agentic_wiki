import {getActor} from '@/app/actor';
import {canWritePage} from '@/app/page-permissions';
import {validateDocument,documentMarkdown} from '@/app/page-editor/document';
import {database,getPage,reply,sameOrigin,lock,unlock} from '@/db/store';
export async function PUT(request:Request,{params}:{params:Promise<{id:string}>}){
 const actor=await getActor(request),respond=(data:unknown,status=200)=>actor.finish(reply(data,status));let lease:string|null=null;
 try{
  if(!sameOrigin(request))return respond({error:'Invalid origin.'},403);
  const page=await getPage((await params).id,actor.userId);if(!page||page.kind==='resource'||!canWritePage(page))return respond({error:'You do not have permission to edit this page.'},403);
  const raw=await request.text();if(raw.length>600000)return respond({error:'The page content is too large.'},413);
  const data=JSON.parse(raw);if(typeof data.title!=='string'||!data.title.trim()||data.title.length>200||typeof data.summary!=='string'||data.summary.length>4000)return respond({error:'Enter a title and a summary within the length limits.'},400);
  const document=data.metadataOnly===true?null:validateDocument(data.document),body=document?documentMarkdown(document):page.body;
  lease=await lock('refresh:'+page.id,90000);if(!lease)return respond({error:'This page is being updated. Please retry.'},409);
  const now=new Date().toISOString(),labels={...page.labels};if(document){labels.richContent=document;labels.richBody=body;delete labels.sourceMedia;}
  // Compare-and-swap prevents a second editor from silently overwriting a newer revision.
  const result=await database().prepare("UPDATE pages SET title=?,summary=?,body=?,labels=?,updated_at=?,checked_at=NULL WHERE id=? AND COALESCE(updated_at,created_at)=? AND (owner_id=? OR (visibility='public' AND public_write=1))").bind(data.title.trim(),data.summary,body,JSON.stringify(labels),now,page.id,data.base,actor.userId).run();
  if(!result.meta.changes)return respond({error:'This page changed while you were editing. Your draft is preserved. Reload the latest page before saving.'},409);
  return respond({page:await getPage(page.id,actor.userId)});
 }catch(error){return respond({error:error instanceof Error?error.message:'Could not save changes.'},400);}finally{if(lease)await unlock(lease);}
}
