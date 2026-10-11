import {z} from 'zod';
import {getActor} from '@/app/actor';
import {getPage,reply,sameOrigin} from '@/db/store';
import {canWritePage} from '@/app/page-permissions';
import {ensurePageSession} from '@/app/chat/session';
import {runAction} from '@/app/workflows/executor';
import {draftWorkflow} from '@/app/page-programs/edit-app';
import type {Workflow} from '@/app/workflows/schema';
// Runs one action of the page's saved workflow (or of the caller's own unsaved
// proposal, with changes skipped). The workflow always comes from the server.
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 const actor=await getActor(request);
 try{
  if(!sameOrigin(request))return actor.finish(reply({error:'Invalid origin.'},403));
  const id=(await params).id,page=await getPage(id,actor.userId);
  if(!page)return actor.finish(reply({error:'This page is unavailable.'},404));
  const text=await request.text();if(text.length>3_000_000)throw Error('Request is too large (over 3 MB).');
  const body=z.object({action:z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,47}$/),state:z.record(z.unknown()).optional(),values:z.record(z.unknown()).optional(),event:z.unknown().optional(),draftId:z.string().uuid().optional()}).strict().parse(JSON.parse(text));
  let workflow:Workflow|undefined,preview=false;
  if(body.draftId){if(!canWritePage(page))throw Error('This preview is unavailable.');workflow=await draftWorkflow(page,await ensurePageSession(id,actor.userId),body.draftId);preview=true;}
  else workflow=page.dynamic?.template==='workflow-app-v1'?page.dynamic.workflow:undefined;
  if(!workflow)return actor.finish(reply({error:'This page has no workflow app.'},404));
  const event=body.event&&typeof body.event==='object'?body.event as {type?:unknown}:{};
  // Only a user action (not opening the page) may change data, and only on pages the user may edit.
  const explicit=event.type!=='load'&&canWritePage(page);
  const result=await runAction(workflow,body.action,{state:body.state,values:body.values,event:body.event},{userId:actor.userId,pageId:id,language:page.language,explicit,verification:preview,signal:request.signal});
  if(result.error)console.warn('Workflow action failed',id,body.action,result.error.slice(0,500));
  return actor.finish(reply(result));
 }catch(error){return actor.finish(reply({error:error instanceof Error?error.message:'The action failed.'},400));}
}
