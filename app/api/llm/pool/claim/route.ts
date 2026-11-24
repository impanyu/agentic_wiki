import {entityDb} from '@/app/entity-db/client';
import {poolAuthorized} from '../auth';
// A pool worker asks for up to `max` waiting requests for the models it serves; it is recorded as alive (the model is
// offered to the agents while it checks in). Waits up to 20 s for work (long poll) so idle workers do not hammer us.
export async function POST(request:Request){
 if(!poolAuthorized(request))return Response.json({error:'Forbidden.'},{status:403});
 const b=await request.json().catch(()=>({})) as {worker?:string;models?:string[];max?:number;info?:Record<string,unknown>};
 const worker=String(b.worker||'').slice(0,80),models=(Array.isArray(b.models)?b.models:[]).map(String).filter(m=>/^[\w.:-]{1,60}$/.test(m)).slice(0,8);
 // max 0: a heartbeat from a worker whose slots are all busy.
 const max=Math.max(0,Math.min(32,Math.floor(Number(b.max)||0)));
 if(!worker||!models.length)return Response.json({error:'worker and models are required.'},{status:400});
 const db=await entityDb();
 await db.query(`insert into llm_workers(id, models, info, last_seen) values ($1::text, $2::text[], $3::jsonb, now())
  on conflict (id) do update set models=excluded.models, info=excluded.info, last_seen=now()`,[worker,models,JSON.stringify(b.info||{})]);
 if(max===0)return Response.json({jobs:[]});
 // The context one request may use on this worker: what it reports (ctxPerSlot), else the operators' setting for its
 // name (POOL_WORKER_CONTEXT "swan-v100=16384,…"; a V100 llama.cpp job splits 65,536 over 4 slots), else no limit.
 const limits=String(process.env.POOL_WORKER_CONTEXT||'swan-v100=16384').split(',').map(x=>x.split('=')).filter(x=>x.length===2);
 const reported=Number((b.info as {ctxPerSlot?:unknown}|undefined)?.ctxPerSlot)||0;
 const configured=Number(limits.find(([p])=>worker.startsWith(p.trim()))?.[1])||0;
 const ctx=reported||configured||2_000_000;
 const until=Date.now()+20_000;
 for(;;){
  const jobs=(await db.query<{id:string;model:string;body:unknown}>(`update llm_jobs set status='claimed', claimed_by=$1::text, claimed_at=now()
    where id in (select id from llm_jobs where status='queued' and model = any($2::text[]) and est_tokens <= $4::int order by created_at limit $3::int for update skip locked)
    returning id, model, body`,[worker,models,max,ctx])).rows;
  if(jobs.length||Date.now()>until||request.signal.aborted)return Response.json({jobs});
  await new Promise(r=>setTimeout(r,500));
 }
}
