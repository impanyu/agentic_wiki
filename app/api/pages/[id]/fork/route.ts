import {getActor} from '@/app/actor';
import {reply,sameOrigin} from '@/db/store';
import {removeFork} from '@/app/chat/fork-context';
export async function DELETE(request:Request,{params}:{params:Promise<{id:string}>}){const actor=await getActor(request);if(!sameOrigin(request))return actor.finish(reply({error:'Invalid request origin.'},403));try{return actor.finish(reply(await removeFork((await params).id,actor.userId)));}catch(e){return actor.finish(reply({error:e instanceof Error?e.message:'Could not remove the fork.'},403));}}
