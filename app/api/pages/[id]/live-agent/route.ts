import {z} from 'zod';
import {getActor} from '@/app/actor';
import {reply,sameOrigin} from '@/db/store';
import {liveAgentStatus,setLiveAgent,runLiveAgent,revertLiveAgentChange,LIVE_INTERVALS} from '@/app/live-agent/service';
// Status of this page's live maintenance agent (visible to readers) and its controls (editors).
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 const actor=await getActor(request);
 try{const s=await liveAgentStatus((await params).id,actor.userId);return actor.finish(s?reply({liveAgent:s}):reply({error:'This page is private or does not exist.'},404));}
 catch{return actor.finish(reply({error:'Live agent status is unavailable.'},503));}
}
export async function PUT(request:Request,{params}:{params:Promise<{id:string}>}){
 const actor=await getActor(request);
 if(!sameOrigin(request))return actor.finish(reply({error:'This request must come from the site.'},403));
 try{
  const body=z.object({enabled:z.boolean().optional(),intervalHours:z.number().int().refine(n=>(LIVE_INTERVALS as readonly number[]).includes(n)).optional(),focus:z.string().max(600).optional()}).strict().parse(await request.json());
  return actor.finish(reply({liveAgent:await setLiveAgent((await params).id,actor.userId,body)}));
 }catch(e){return actor.finish(reply({error:e instanceof Error?e.message:'Could not update the live agent.'},400));}
}
// run: start a maintenance run now (in the background); revert: undo the last saved live agent change.
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 const actor=await getActor(request);
 if(!sameOrigin(request))return actor.finish(reply({error:'This request must come from the site.'},403));
 try{
  const id=(await params).id,{action}=z.object({action:z.enum(['run','revert'])}).strict().parse(await request.json());
  const current=await liveAgentStatus(id,actor.userId);if(!current?.canEdit)return actor.finish(reply({error:'Only people who can edit this page can manage its live agent.'},403));
  if(action==='revert')return actor.finish(reply({liveAgent:await revertLiveAgentChange(id,actor.userId)}));
  if(current.running)return actor.finish(reply({liveAgent:current}));
  if(!current.enabled&&!current.runs&&!current.lastRunAt)await setLiveAgent(id,actor.userId,{enabled:false});
  void runLiveAgent(id,{force:true}).catch(()=>{});
  await new Promise(r=>setTimeout(r,300));
  return actor.finish(reply({liveAgent:await liveAgentStatus(id,actor.userId)}));
 }catch(e){return actor.finish(reply({error:e instanceof Error?e.message:'Live agent action failed.'},400));}
}
