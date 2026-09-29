import {getActor} from '@/app/actor';
import {reply} from '@/db/store';
import {mentionablePages} from '@/app/resources/service';
// Pages and web apps the visitor can open, for the chat @ picker.
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 const actor=await getActor(request),u=new URL(request.url);
 try{return actor.finish(reply(await mentionablePages((await params).id,actor.userId,u.searchParams.get('q')||'',Math.max(0,Math.min(5000,Number(u.searchParams.get('offset'))||0)))));}
 catch(e){return actor.finish(reply({error:e instanceof Error?e.message:'Pages are unavailable.'},404));}
}
