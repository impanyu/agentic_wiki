import {getActor} from '@/app/actor';import {reply,sameOrigin} from '@/db/store';import {updateConnection,removeConnection} from '@/app/connectors/service';
async function handle(r:Request,p:Promise<{id:string}>,remove=false){const a=await getActor(r);if(!sameOrigin(r))return a.finish(reply({error:'Invalid origin.'},403));try{const {id}=await p;return a.finish(reply(remove?await removeConnection(a.userId,id):await updateConnection(a.userId,id,await r.json())));}catch(e){return a.finish(reply({error:e instanceof Error?e.message:'Could not update connector.'},400));}}
export async function PATCH(r:Request,{params}:{params:Promise<{id:string}>}){return handle(r,params);}
export async function DELETE(r:Request,{params}:{params:Promise<{id:string}>}){return handle(r,params,true);}
