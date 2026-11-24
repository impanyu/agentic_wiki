import {entityDb} from '@/app/entity-db/client';
// The model pool: requests for a pool model wait in llm_jobs until one of our own GPU workers (scripts/llm-pool-worker.mjs
// on a lab machine or an HCC Swan job) claims and answers it. A pool model is offered to the agents only while a
// worker serving it has checked in within the last 90 seconds; the scheduler (core.ts) sends at most as many requests as the
// live workers have slots; a request nobody claims within 2 minutes (a worker died) fails back to the chain.
let live:{at:number;models:Set<string>;slots:Map<string,number>;loading:boolean}={at:0,models:new Set(),slots:new Map(),loading:false};
function refresh(){
 if(live.loading||Date.now()-live.at<15_000)return;live.loading=true;
 entityDb().then(db=>db.query<{models:string[];slots:number|null}>("select models, (info->>'slots')::int slots from llm_workers where last_seen > now() - interval '90 seconds'"))
  .then(r=>{const slots=new Map<string,number>();for(const x of r.rows)for(const m of x.models)slots.set(m,(slots.get(m)||0)+(x.slots||8));
   live={at:Date.now(),models:new Set(r.rows.flatMap(x=>x.models)),slots,loading:false};})
  .catch(()=>{live.loading=false;live.at=Date.now();});
}
export function poolAvailable(model:string){refresh();return live.models.has(model);}
// The requests our live workers serving the model take at once (the scheduler's slots for it).
export function poolSlots(model:string){refresh();return live.models.has(model)?live.slots.get(model):undefined;}
// Whether a worker serving the model checked in within 90 s, read now (for a decision that should not wait a refresh).
export async function poolOnline(model:string){
 const db=await entityDb();
 return (await db.query("select 1 from llm_workers where last_seen > now() - interval '90 seconds' and $1::text = any(models) limit 1",[model])).rows.length>0;
}
export async function poolRun(model:string,body:Record<string,unknown>,timeoutMs:number,signal?:AbortSignal,queueWaitMs=120_000):Promise<any>{
 const db=await entityDb();
 const id=(await db.query<{id:string}>('insert into llm_jobs(model, body) values ($1::text, $2::jsonb) returning id',[model,JSON.stringify(body)])).rows[0].id;
 const t0=Date.now();
 try{
  for(;;){
   if(signal?.aborted)throw Error('aborted');
   await new Promise(r=>setTimeout(r,400));
   const j=(await db.query<{status:string;result:unknown;error:string|null}>('select status, result, error from llm_jobs where id=$1::uuid',[id])).rows[0];
   if(!j)throw Error('pool job vanished');
   if(j.status==='done')return j.result;
   if(j.status==='failed')throw Error('pool worker: '+String(j.error||'failed').slice(0,300));
   if(j.status==='queued'&&Date.now()-t0>queueWaitMs){
    const gone=(await db.query("delete from llm_jobs where id=$1::uuid and status='queued' returning 1",[id])).rows.length;
    if(gone)throw Error(`pool busy: no worker took the request within ${Math.round(queueWaitMs/1000)} s`);
   }
   if(Date.now()-t0>timeoutMs+(j.status==='queued'?queueWaitMs:0))throw Error('pool timeout');
  }
 }finally{
  // Answered or abandoned jobs are kept an hour for inspection, then removed.
  void db.query("delete from llm_jobs where created_at < now() - interval '1 hour'").catch(()=>{});
 }
}
