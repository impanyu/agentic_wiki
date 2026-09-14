import {getActor} from '@/app/actor';
import {getPage,reply,sameOrigin} from '@/db/store';
import {executePage} from '@/app/components-registry/runtime';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 const actor=await getActor(request);const respond=(data:unknown,status=200)=>actor.finish(reply(data,status));
 if(!sameOrigin(request))return respond({error:'This request must come from the site.'},403);
 try{
  const page=await getPage((await params).id,actor.userId);
  if(!page)return respond({error:'This page is private or does not exist.'},404);
  if(page.kind!=='dynamic'||!page.dynamic)return respond({error:'This page is not an application.'},400);
  let result;
  try{result=await executePage(page,await request.json(),actor.userId);}catch{return respond({error:page.dynamic.labels.invalid},400);}
  return respond({page:result});
 }catch{return respond({error:'The application is temporarily unavailable.'},503);}
}
