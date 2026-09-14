import {env} from '@/server/runtime';
import {getActor} from '@/app/actor';
import {getComponent} from '@/app/components-registry/registry';
import {dataReferenceSchema} from '@/app/components-registry/contracts';
import {reply} from '@/db/store';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 const actor=await getActor(request);
 try{
  const component=await getComponent({id:(await params).id,version:1},{userId:actor.userId},'data'),data=dataReferenceSchema.parse(JSON.parse(component.payload));
  if(!data.location.startsWith('r2://FILES/uploads/'))return actor.finish(reply({error:'This file is stored outside this application.'},404));
  const files=(env as unknown as {FILES?:R2Bucket}).FILES;if(!files)return actor.finish(reply({error:'File storage is unavailable.'},503));
  const object=await files.get(data.location.slice('r2://FILES/'.length));if(!object)return actor.finish(reply({error:'File not found.'},404));
  return actor.finish(new Response(object.body,{headers:{'Content-Type':'application/octet-stream','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(data.fileName||'data-file'),'Content-Length':String(object.size),'Cache-Control':'no-store, private','Vary':'Cookie','X-Content-Type-Options':'nosniff'}}));
 }catch{return actor.finish(reply({error:'This file is private or does not exist.'},404));}
}
