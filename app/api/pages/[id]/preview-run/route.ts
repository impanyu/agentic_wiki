import {z} from 'zod';
import {getActor} from '@/app/actor';
import {getPage,reply,sameOrigin} from '@/db/store';
import {canWritePage} from '@/app/page-permissions';
import {ensurePageSession} from '@/app/chat/session';
import {previewRun} from '@/app/page-programs/edit-app';
// Runs the backend of the caller's own unsaved app proposal for its chat preview.
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 const actor=await getActor(request);
 try{
  if(!sameOrigin(request))return actor.finish(reply({error:'Invalid origin.'},403));
  const id=(await params).id,page=await getPage(id,actor.userId);
  if(!page||!canWritePage(page))return actor.finish(reply({error:'This preview is unavailable.'},403));
  const text=await request.text();if(text.length>1_000_000)throw Error('Request is too large (over 1 MB).');
  const body=z.object({draftId:z.string().uuid(),query:z.string().max(2000).optional(),values:z.record(z.unknown()).optional(),submitted:z.literal(true).optional(),message:z.string().max(12000).optional(),parent:z.string().max(2000).optional(),cursor:z.string().max(4000).optional()}).strict().parse(JSON.parse(text));
  return actor.finish(reply(await previewRun(page,await ensurePageSession(id,actor.userId),body.draftId,body)));
 }catch(error){return actor.finish(reply({error:error instanceof Error?error.message:'Preview failed.'},400));}
}
