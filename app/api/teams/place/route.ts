import {teamAuthorized} from '@/app/teams/auth';
import {placeTopic} from '@/app/teams/run';
// Asks the manager to place a published topic in the navigation tree (operators only, as /api/teams/run).
// Teams do this themselves when they publish; this places topics published before that existed.
export const dynamic='force-dynamic';
export async function POST(request:Request){
 if(!teamAuthorized(request))return Response.json({error:'Not allowed.'},{status:403});
 const body=await request.json().catch(()=>({})) as {slug?:string};
 const slug=String(body.slug||'').trim().toLowerCase();if(!/^[a-z0-9][a-z0-9-]{1,60}$/.test(slug))return Response.json({error:'Give a topic slug.'},{status:400});
 try{return Response.json(await placeTopic(slug,e=>console.log('[topic:'+slug+']',JSON.stringify(e))));}
 catch(e){return Response.json({error:(e as Error).message},{status:500});}
}
