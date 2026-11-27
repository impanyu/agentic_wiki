import type {Queryable} from '@/app/entity-db/client';
// The work queue. A task is one piece of agent work: a kind (what to do), a target (a class key of the class tree, or a
// page — a topic slug of the site map), a pool (who does it), a priority. One open task per kind and target: asking
// again adds the request to the open task (its payload's requests), never a second task.
export type Pool='collector'|'editor'|'reviewer'|'manager';
export type Task={id:string;kind:string;pool:Pool;target:string;priority:number;status:string;payload:Record<string,unknown>;parent_id:string|null;requested_by:string;attempts:number;result:Record<string,unknown>|null;created_at:string};
export const INSTANCE=process.env.RANKWIKI_INSTANCE||(process.env.RANKWIKI_ROLE||'app')+':'+(process.env.PORT||'');

export async function enqueue(db:Queryable,t:{kind:string;pool:Pool;target:string;priority?:number;payload?:Record<string,unknown>;parentId?:string|null;requestedBy?:string}):Promise<{id:string;created:boolean}>{
 const payload=t.payload||{};
 const r=await db.query<{id:string}>(`insert into work_tasks(kind,pool,target,priority,payload,parent_id,requested_by) values ($1,$2,$3,$4,$5::jsonb,$6::uuid,$7)
  on conflict (kind, target) where status in ('queued','running') do nothing returning id`,[t.kind,t.pool,t.target,t.priority??50,JSON.stringify({...payload,requests:[{by:t.requestedBy||'trigger',at:new Date().toISOString(),...payload}]}),t.parentId||null,t.requestedBy||'trigger']);
 if(r.rows[0])return {id:r.rows[0].id,created:true};
 // Already open: the new request joins it (and may raise its priority).
 const o=await db.query<{id:string}>(`update work_tasks set priority=greatest(priority,$3), payload=jsonb_set(payload,'{requests}',coalesce(payload->'requests','[]'::jsonb)||$4::jsonb)
  where kind=$1 and target=$2 and status in ('queued','running') returning id`,[t.kind,t.target,t.priority??50,JSON.stringify([{by:t.requestedBy||'trigger',at:new Date().toISOString(),...payload}])]);
 return {id:o.rows[0]?.id||'',created:false};
}
// The highest-priority queued task of a pool, leased to this process.
export async function claim(db:Queryable,pool:Pool):Promise<Task|null>{
 return (await db.query<Task>(`update work_tasks set status='running', started_at=now(), worker=$2, lease_until=now()+interval '5 minutes', attempts=attempts+1
  where id=(select id from work_tasks where pool=$1 and status='queued' order by priority desc, created_at limit 1 for update skip locked) returning *`,[pool,INSTANCE])).rows[0]??null;
}
export async function renew(db:Queryable,ids:string[]){if(ids.length)await db.query(`update work_tasks set lease_until=now()+interval '5 minutes' where id=any($1::uuid[]) and status='running'`,[ids]);}
export async function finish(db:Queryable,id:string,status:'done'|'failed'|'returned'|'cancelled'|'queued',result:Record<string,unknown>){
 await db.query(`update work_tasks set status=$2, result=$3::jsonb, finished_at=case when $2='queued' then null else now() end, worker=null, lease_until=null where id=$1::uuid`,[id,status,JSON.stringify(result)]);
}
export async function comment(db:Queryable,id:string,by:string,text:string){
 await db.query(`update work_tasks set comments=comments||jsonb_build_array(jsonb_build_object('by',$2::text,'at',now(),'text',$3::text)) where id=$1::uuid`,[id,by,text.slice(0,2000)]);
}
// What is waiting and running, per pool and kind (the manager's and operators' view).
export async function queueState(db:Queryable){
 return (await db.query(`select pool, kind, status, count(*)::int n from work_tasks where status in ('queued','running') or finished_at > now() - interval '1 day' group by 1,2,3 order by 1,2,3`)).rows;
}
