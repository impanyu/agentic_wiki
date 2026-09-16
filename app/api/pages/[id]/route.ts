import {deferPageExecution} from '@/app/page-programs/deferred';
import {parametersSchema} from '@/app/components-registry/contracts';
import {programNavigationInput} from '@/app/page-programs/inputs';
import {executePage} from '@/app/components-registry/runtime';
import {inputFromUrl} from '@/app/dynamic/execute';
import {getActor} from '@/app/actor';
import {database,getPage,reply,sameOrigin,lock,unlock} from '@/db/store';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){const actor=await getActor(request);const respond=(data:unknown,status=200)=>actor.finish(reply(data,status));try{
 let page=await getPage((await params).id,actor.userId);
 if(!page||page.kind==='resource')return respond({error:'This page is private or does not exist.'},404);
 if(page.dynamic?.template==='context-index-v1'){const parameters=parametersSchema.parse(JSON.parse(new URL(request.url).searchParams.get('inputs')||'{}'));return respond({page:await executePage(page,parameters,actor.userId)});}
 if(page.dynamic?.template==='page-program-v1'){const url=new URL(request.url),parameters=parametersSchema.parse(JSON.parse(url.searchParams.get('inputs')||'{}'));if(url.searchParams.get('defer')==='1')return respond({page:deferPageExecution(page,parameters)});return respond({page:await executePage({...page,parameters},programNavigationInput(parameters),actor.userId)});}
 if(page.dynamic?.template==='file-browser-v1'||page.dynamic?.template==='agent-chat-v1'){const parameters=parametersSchema.parse(JSON.parse(new URL(request.url).searchParams.get('inputs')||'{}'));return respond({page:{...page,parameters}});}
 if(page.kind==='dynamic'&&page.dynamic){try{const url=new URL(request.url),input=page.dynamic.template==='component-form-v1'?(url.searchParams.has('inputs')?JSON.parse(url.searchParams.get('inputs')!):undefined):inputFromUrl(url);if(input){if(page.dynamic.template==='component-form-v1')page.parameters=input;try{page=await executePage(page,input,actor.userId);}catch{if(page.dynamic?.template!=='component-form-v1')throw new Error('INVALID_INPUT');}}}catch{return respond({error:page.dynamic.labels.invalid},400);}}
 return respond({page});
}catch(e){console.error('Page read failed',e instanceof Error?e.message:'unknown');return respond({error:'The answer database is temporarily unavailable.'},503);}}
export async function PATCH(req:Request,{params}:{params:Promise<{id:string}>}){const actor=await getActor(req);const respond=(data:unknown,status=200)=>actor.finish(reply(data,status));let lease:string|null=null;try{
 if(!sameOrigin(req))return respond({error:'This request must come from the site.'},403);
 const data=await req.json() as {access?:unknown;visibility?:unknown};
 const access=data.access??(data.visibility==='public'?'public-read':data.visibility==='private'?'private':null);
 if(!['private','public-read','public-write'].includes(String(access)))return respond({error:'Choose private, public-read or public-write.'},400);
 const visibility=access==='private'?'private':'public',publicWrite=access==='public-write'?1:0;
 const id=(await params).id;
 const destination=await getPage(id,actor.userId);
 if(!destination||destination.kind==='resource'||!destination.owned)return respond({error:'Only the page owner can change its visibility.'},403);
 const table='pages';
 lease=await lock('refresh:'+id,90000);if(!lease)return respond({error:'This page is being updated. Please retry.'},409);

 if(visibility==='public'){
  const owned=await database().prepare('SELECT id FROM '+table+' WHERE id=? AND owner_id=?').bind(id,actor.userId).first();
  if(!owned)return respond({error:'Only the page owner can change its visibility.'},403);
  const deps=await database().prepare(`WITH RECURSIVE deps(id) AS (SELECT component_id FROM component_dependencies WHERE parent_id=? UNION SELECT d.component_id FROM component_dependencies d JOIN deps ON d.parent_id=deps.id) SELECT c.* FROM components c JOIN deps ON deps.id=c.id WHERE c.visibility='private'`).bind(id).all<{id:string;owner_id:string;type:string}>();
  if(deps.results.some(d=>d.owner_id!==actor.userId||d.type==='credential'))return respond({error:'This page depends on private resources that cannot be published.'},409);
  if(deps.results.length)await database().batch(deps.results.flatMap(d=>[
   database().prepare("UPDATE components SET visibility='public' WHERE id=? AND owner_id=?").bind(d.id,actor.userId),
   database().prepare("UPDATE OR REPLACE component_questions SET scope='public' WHERE component_id=?").bind(d.id)
  ]));
 }
 const r=await database().prepare('UPDATE '+table+' SET visibility=?,public_write=? WHERE id=? AND owner_id=?').bind(visibility,publicWrite,id,actor.userId).run();
 if(!r.meta.changes)return respond({error:'Only the page owner can change its visibility.'},403);
 return respond({page:await getPage(id,actor.userId)});
}catch{return respond({error:'Could not update visibility. Please try again.'},503);}finally{if(lease)await unlock(lease);}}
