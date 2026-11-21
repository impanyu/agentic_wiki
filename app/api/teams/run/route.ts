import {teamAuthorized} from '@/app/teams/auth';
import {runTopicTeam} from '@/app/teams/run';
// Starts one pass of a topic team in the background (operators only: TEAM_ADMIN_TOKEN in the
// x-team-token header). Progress is in /api/teams/runs and the server log.
export const dynamic='force-dynamic';
const running=new Set<string>();
export async function POST(request:Request){
 if(!teamAuthorized(request))return Response.json({error:'Not allowed.'},{status:403});
 const body=await request.json().catch(()=>({})) as {slug?:string;name?:string;brief?:string;maxFixRounds?:number};
 const slug=String(body.slug||'').trim().toLowerCase();if(!/^[a-z0-9][a-z0-9-]{1,60}$/.test(slug)||!body.name||!body.brief)return Response.json({error:'Give slug, name and brief.'},{status:400});
 if(running.has(slug))return Response.json({error:'This topic team is already running.'},{status:409});
 running.add(slug);
 void runTopicTeam({slug,name:String(body.name).slice(0,200),brief:String(body.brief).slice(0,4000),maxFixRounds:Math.min(3,Math.max(0,Number(body.maxFixRounds??2))),
  log:e=>console.log('[team:'+slug+']',JSON.stringify(e))})
  .then(r=>console.log('[team:'+slug+'] finished',JSON.stringify(r.verdict)))
  .catch(e=>console.error('[team:'+slug+'] failed',(e as Error).message))
  .finally(()=>running.delete(slug));
 return Response.json({started:true,slug});
}
