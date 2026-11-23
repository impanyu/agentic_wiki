import {timingSafeEqual} from 'node:crypto';
import {reply} from '@/db/store';
import {dueLiveAgents,runLiveAgent,runningLiveAgents} from '@/app/live-agent/service';
import {PUBLIC_EDITION} from '@/app/edition';
// Called once a minute by scripts/start.mjs with a per-boot secret; starts due live agent runs
// in the background (at most two at a time) and returns immediately.
const MAX_CONCURRENT=2;
export async function POST(request:Request){
 const token=process.env.LIVE_AGENT_TICK_TOKEN||'',given=request.headers.get('x-live-agent-token')||'';
 if(!token||given.length!==token.length||!timingSafeEqual(Buffer.from(given),Buffer.from(token)))return reply({error:'Forbidden.'},403);
 try{
  // Public edition: the crawler runs due recipes on the same heartbeat (one at a time, in the background).
  if(PUBLIC_EDITION)void import('@/app/teams/schedule').then(m=>Promise.all([m.fillVectors(),m.runDueRecipes(),m.manageTeams(),m.translateContent(),m.enrichEntities()])).catch(e=>console.error('crawler tick failed',e instanceof Error?e.message:e));
  const free=MAX_CONCURRENT-await runningLiveAgents();if(free<=0)return reply({started:0});
  const due=await dueLiveAgents(free);for(const id of due)void runLiveAgent(id).catch(e=>console.error('Live agent run failed',id,e instanceof Error?e.message:e));
  return reply({started:due.length});
 }catch(e){console.error('Live agent tick failed',e instanceof Error?e.message:e);return reply({error:'tick failed'},503);}
}
