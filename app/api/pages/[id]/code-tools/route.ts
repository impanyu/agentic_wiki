import {z} from 'zod';
import {getActor} from '@/app/actor';
import {getPage,reply,sameOrigin} from '@/db/store';
import {canWritePage} from '@/app/page-permissions';
import {ensurePageSession} from '@/app/chat/session';
import {applicationToolbox} from '@/app/agents/tools';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 const actor=await getActor(request);
 try{
  if(!sameOrigin(request))return actor.finish(reply({error:'Invalid origin.'},403));
  const id=(await params).id,page=await getPage(id,actor.userId);
  if(!page||!canWritePage(page)||!page.dynamic?.pageCode)return actor.finish(reply({error:'This page does not allow application execution.'},403));
  const text=await request.text();if(text.length>100000)throw Error('Tool request is too large.');
  const {name,args}=z.object({name:z.string().min(1).max(100),args:z.record(z.unknown())}).strict().parse(JSON.parse(text));
  const agent=await ensurePageSession(id,actor.userId),box=await applicationToolbox(agent,{pageId:id,userId:actor.userId,ownerId:actor.userId,language:page.language,visibility:'private'},request.signal);
  return actor.finish(reply(await box.execute(name,args)));
 }catch(error){return actor.finish(reply({error:error instanceof Error?error.message:'Tool failed.'},400));}
}
