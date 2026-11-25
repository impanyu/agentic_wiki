import {loadavg,cpus} from 'node:os';
import type {Queryable} from './client';
import {buildRankingPage,buildEntityPage,storedRanking} from './pages';
import {saveSnapshot,dropSnapshot,type SnapshotKind} from './snapshots';
// Keeps precomputed pages (page_data) current, on the worker's heartbeat. Each pass takes the pages due, most
// urgent first, and rebuilds them a few at a time within a time budget:
//  1. rankings whose data changed (observations of their type, the definition, the type) — at most every 10 minutes;
//  2. entities that changed themselves (introduction, picture, links, attributes) — at most every 30 minutes;
//  3. entities with a relation added or removed (dirty_entities), and entities of a type whose page template changed
//     — at most every 30 minutes;
//  3b. entities of a type whose rankings changed (one added, retired or merged) — at most every 30 minutes;
//  4. entities of a type whose observations or metric definitions changed (their ranks and peers) — at most every 6 hours;
//  5. pages never built (every ranking and entity page is precomputed before a reader or crawler asks);
//  6. when the server is idle, pages older than a week (what no tracked change covers: a related entity renamed).
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
 await q(`select d.id::text as key, e.type from (select id, max(at) at from dirty_entities group by id) d
   join entities e on e.id = d.id and e.has_page join page_data p on p.kind = 'entity' and p.key = d.id::text
   where p.built_at < d.at and p.built_at < now() - interval '30 minutes' limit 300`,[],'entity');
 await q(`select p.key, p.type from entity_types t join page_data p on p.kind = 'entity' and p.type = t.type and p.built_at < t.updated_at
   where t.updated_at > now() - interval '7 days' and p.built_at < now() - interval '30 minutes' order by p.built_at limit 300`,[],'entity');
 // A ranking of the type added, retired, merged or renamed: its members' pages list their rankings.
 await q(`with rc as (select scope->>'type' type, max(updated_at) at from rankings where updated_at > now() - interval '3 days' group by 1)
   select p.key, p.type from rc join page_data p on p.kind = 'entity' and p.type = rc.type and p.built_at < rc.at
   where p.built_at < now() - interval '30 minutes' order by p.built_at limit 300`,[],'entity');
 await q(`with ch as (select type, max(at) at from data_changes where at > now() - interval '3 days' group by type)
   select p.key, p.type from ch join page_data p on p.kind = 'entity' and p.type = ch.type and p.built_at < ch.at
   where p.built_at < now() - interval '6 hours' order by p.built_at limit 300`,[],'entity');
 // Never built: rankings each pass (few), entities from a list refreshed every ten minutes, grouped by type (members
 // of a type share their peer and sub-ranking tables, computed once).
 await q(`select r.slug as key, coalesce(r.scope->>'type','') as type from rankings r where r.slug is not null and r.status = any($1::text[])
   and not exists (select 1 from page_data p where p.kind = 'ranking' and p.key = r.slug) limit 200`,[STATUSES],'ranking');
 if(!missing.length&&Date.now()-missingAt>10*60_000){missingAt=Date.now();
  const r=await db.query<{key:string;type:string}>(`select e.id::text as key, e.type from entities e where e.has_page
    and not exists (select 1 from page_data p where p.kind = 'entity' and p.key = e.id::text) order by e.type limit 5000`);
  missing.push(...r.rows.map(x=>({kind:'entity' as const,key:String(x.key),type:String(x.type)})));}
 jobs.push(...missing.splice(0,400));
 // The weekly safety refresh only when nothing else is waiting and the machine is idle (it never competes with readers).
 if(jobs.length<20&&loadavg()[0]<cpus().length*0.7){
  await q(`select key, type from page_data where kind = 'ranking' and built_at < now() - interval '7 days' order by built_at limit 20`,[],'ranking');
  await q(`select key, type from page_data where kind = 'entity' and built_at < now() - interval '7 days' order by built_at limit 100`,[],'entity');
 }
 // And whatever the load, a few pages a pass once older than 30 days.
 await q(`select key, type from page_data where kind = 'ranking' and built_at < now() - interval '30 days' order by built_at limit 5`,[],'ranking');
 await q(`select key, type from page_data where kind = 'entity' and built_at < now() - interval '30 days' order by built_at limit 10`,[],'entity');
 const seen=new Set<string>();return jobs.filter(j=>{const k=j.kind+':'+j.key;if(seen.has(k))return false;seen.add(k);return true;});
}

// The page's words are queued for translation into the main languages as soon as it is built (lowest priority:
// readers' requests go first), so a reader in those languages finds the page already translated.
const PRE_LOCALES=(process.env.PRETRANSLATE_LOCALES??'zh').split(',').map(s=>s.trim()).filter(Boolean);
async function pretranslate(db:Queryable,model:unknown){
 if(!PRE_LOCALES.length)return;
 const {queueTexts}=await import('@/app/i18n/content');
 await queueTexts(db,model,PRE_LOCALES,0).catch(e=>console.warn('[pages] translation queue failed',(e as Error).message));
}
async function rebuild(db:Queryable,j:Job){
 const {assembleEntityPage,assembleRankingPage}=await import('@/app/seo/assemble');
 if(j.kind==='ranking'){const built=await buildRankingPage(db,j.key);const v=storedRanking(built);
  if(!v||!built){await dropSnapshot(db,'ranking',j.key);return;}
  await saveSnapshot(db,'ranking',j.key,String(v.def.scope.type||''),v);
  const m=assembleRankingPage(built,'en');
  await pretranslate(db,{name:m.title,baseTitle:m.title,lead:m.lead,related:m.related,about:m.about,titles:m.criteria.map(c=>({title:c.label})),props:{rows:m.rows}});return;}
 const v=await buildEntityPage(db,j.key,j.type);if(!v){await dropSnapshot(db,'entity',j.key);return;}
 await saveSnapshot(db,'entity',j.key,v.data.entity.type,v);
 await pretranslate(db,{model:assembleEntityPage(v.data,'en'),kicker:v.data.type.label,intro:{text:v.data.entity.description||''}});
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
  await db.query(`delete from dirty_entities d where d.at < now() - interval '3 days'
   or exists (select 1 from page_data p where p.kind = 'entity' and p.key = d.id::text and p.built_at > d.at)`).catch(()=>{});
  return {built,failed,due:built+failed+jobs.length};
 }finally{running=false;}
}
