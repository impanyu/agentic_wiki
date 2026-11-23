import type {Queryable} from './client';
import {buildRankingPage,buildEntityPage,storedRanking} from './pages';
import {saveSnapshot,dropSnapshot,type SnapshotKind} from './snapshots';
// Keeps precomputed pages (page_data) current, on the worker's heartbeat. Each pass takes the pages due, most
// urgent first, and rebuilds them a few at a time within a time budget:
//  1. rankings whose data changed (observations of their type, the definition, the type) — at most every 10 minutes;
//  2. entities that changed themselves (introduction, picture, links, attributes) — at most every 30 minutes;
//  3. entities of a type whose observations changed (their ranks and peers) — at most every 6 hours;
//  4. pages never built (every ranking and entity page is precomputed before a reader or crawler asks);
//  5. anything older than two days.
// Every lookup uses an index (page_data by kind/type/built_at, entities by updated_at where has_page), never a scan
// of the entities table.
const STATUSES=['published','draft'];
type Job={kind:SnapshotKind;key:string;type:string};
let running=false,missingAt=0;
const missing:Job[]=[];

async function due(db:Queryable):Promise<Job[]>{
 const jobs:Job[]=[];
 const q=async(sql:string,params:unknown[],kind:SnapshotKind)=>{for(const r of (await db.query<{key:string;type:string}>(sql,params)).rows)jobs.push({kind,key:String(r.key),type:String(r.type||'')});};
 // Gone: rankings retired or deleted, entities that lost their page.
 await db.query(`delete from page_data p where p.kind = 'ranking' and not exists (select 1 from rankings r where r.slug = p.key and r.status = any($1::text[]))`,[STATUSES]);
 await q(`with ch as (select type, max(at) at from data_changes where at > now() - interval '3 days' group by type)
   select r.slug as key, coalesce(r.scope->>'type','') as type from rankings r
   join page_data p on p.kind = 'ranking' and p.key = r.slug
   left join ch on ch.type = r.scope->>'type' left join entity_types t on t.type = r.scope->>'type'
   where r.slug is not null and r.status = any($1::text[]) and p.built_at < now() - interval '10 minutes'
    and p.built_at < greatest(r.updated_at, t.updated_at, ch.at) order by p.built_at limit 100`,[STATUSES],'ranking');
 await q(`select e.id::text as key, e.type from entities e join page_data p on p.kind = 'entity' and p.key = e.id::text
   left join entity_types t on t.type = e.type
   where e.has_page and e.updated_at > now() - interval '2 days' and p.built_at < now() - interval '30 minutes'
    and p.built_at < greatest(e.updated_at, t.updated_at) order by e.updated_at limit 300`,[],'entity');
 await q(`with ch as (select type, max(at) at from data_changes where at > now() - interval '3 days' group by type)
   select p.key, p.type from ch join page_data p on p.kind = 'entity' and p.type = ch.type and p.built_at < ch.at
   where p.built_at < now() - interval '6 hours' order by p.built_at limit 300`,[],'entity');
 // Never built: rankings each pass (few), entities from a list refreshed every ten minutes.
 await q(`select r.slug as key, coalesce(r.scope->>'type','') as type from rankings r where r.slug is not null and r.status = any($1::text[])
   and not exists (select 1 from page_data p where p.kind = 'ranking' and p.key = r.slug) limit 200`,[STATUSES],'ranking');
 if(!missing.length&&Date.now()-missingAt>10*60_000){missingAt=Date.now();
  const r=await db.query<{key:string;type:string}>(`select e.id::text as key, e.type from entities e where e.has_page
    and not exists (select 1 from page_data p where p.kind = 'entity' and p.key = e.id::text) limit 5000`);
  missing.push(...r.rows.map(x=>({kind:'entity' as const,key:String(x.key),type:String(x.type)})));}
 jobs.push(...missing.splice(0,400));
 await q(`select key, type from page_data where kind = 'ranking' and built_at < now() - interval '2 days' order by built_at limit 50`,[],'ranking');
 await q(`select key, type from page_data where kind = 'entity' and built_at < now() - interval '2 days' order by built_at limit 200`,[],'entity');
 const seen=new Set<string>();return jobs.filter(j=>{const k=j.kind+':'+j.key;if(seen.has(k))return false;seen.add(k);return true;});
}

async function rebuild(db:Queryable,j:Job){
 if(j.kind==='ranking'){const v=storedRanking(await buildRankingPage(db,j.key));if(v)await saveSnapshot(db,'ranking',j.key,String(v.def.scope.type||''),v);else await dropSnapshot(db,'ranking',j.key);return;}
 const v=await buildEntityPage(db,j.key,j.type);if(v)await saveSnapshot(db,'entity',j.key,v.data.entity.type,v);else await dropSnapshot(db,'entity',j.key);
}

export async function refreshSnapshots(db:Queryable,{budgetMs=50_000,workers=Number(process.env.SNAPSHOT_WORKERS||2)}:{budgetMs?:number;workers?:number}={}):Promise<{built:number;failed:number;due:number}>{
 if(running)return {built:0,failed:0,due:0};running=true;
 try{
  const until=Date.now()+budgetMs;const jobs=await due(db);let built=0,failed=0;
  await Promise.all(Array.from({length:Math.max(1,workers)},async()=>{
   for(let j;Date.now()<until&&(j=jobs.shift());){
    try{await rebuild(db,j);built++;}catch(e){failed++;console.warn('[pages] rebuild failed',j.kind,j.key,(e as Error).message);}
   }
  }));
  // Entities not reached go back to the front of the never-built list.
  missing.unshift(...jobs.filter(j=>j.kind==='entity'));
  await db.query(`delete from data_changes where at < now() - interval '3 days'`).catch(()=>{});
  return {built,failed,due:built+failed+jobs.length};
 }finally{running=false;}
}
