import type {Queryable,EntityDb} from '@/app/entity-db/client';
import {enqueue,type Pool} from './queue';
// Desired state, checked. Every object of the site (a class of the class tree, a page of the site map) should satisfy
// a set of checks; one loop runs them and turns every object that fails into a task for its owner (classes →
// collectors, pages → editors). A check is a row: a read-only query that returns the failing targets, the kind of
// task that fixes them, a severity and a cooldown. Built-in checks are written here; agents add their own
// (propose_check) when they find a kind of problem that can recur — a new check runs on trial (counted, no tasks)
// until a reviewer confirms its findings are real, and pauses itself if it suddenly flags most of the site.
// Events (reader reports, failed runs, issues, the calendar) still create tasks directly (triggers.ts); a state that
// can be seen in the data is a check.
type Row=Record<string,unknown>;
export type Check={id:string;object:'class'|'page';kind:string;title:string;severity:number;cooldown_days:number;sql:string;status:'trial'|'active'|'paused'|'retired';created_by:string;why?:string};

// Built-in checks. Each query returns rows {target, detail?}; for a class the target is the class key (page_build:
// "class:<key>"), for a page the topic slug.
const LEAF=`not exists (select 1 from entity_types c where c.schema->>'extends'=et.type and c.schema->>'kind'='class')`;
const DESCRIPTIVE_SQL=`(^|_)(year|years|date|founded|established|opened|launch|launched|release|released|since|inception|start|end|age)($|_)`;
export const BUILTIN:Omit<Check,'status'|'created_by'>[]=[
 {id:'class-empty',object:'class',kind:'class_members',title:'A class has no members',severity:40,cooldown_days:30,
  sql:`select et.type target, 'the class has no members' detail from entity_types et where et.schema->>'kind'='class' and ${LEAF}
   and not exists (select 1 from entities e where e.type=et.type) order by (et.topic_id is not null) desc, coalesce((et.schema->'universe'->>'expectedCount')::numeric,0) desc`},
 {id:'class-no-page',object:'class',kind:'page_build',title:'A class has members and no page',severity:45,cooldown_days:30,
  sql:`select 'class:'||et.type target, count(*)||' members, no page' detail from entity_types et join entities e on e.type=et.type
   where et.schema->>'kind'='class' and et.topic_id is null group by et.type having count(*) >= 10 order by count(*) desc`},
 {id:'class-recipe-failing',object:'class',kind:'source_repair',title:'A collection rule fails',severity:65,cooldown_days:3,
  sql:`select type target, name||': '||left(coalesce(last_result->>'error',''),400) detail from recipes where status='active' and coalesce((last_result->>'ok')::boolean,true)=false`},
 {id:'class-sources-unreviewed',object:'class',kind:'source_review',title:'Sources not reviewed for 90 days',severity:15,cooldown_days:90,
  sql:`select distinct r.type target, '90-day source review' detail from recipes r where r.status='active' and r.created_at < now() - interval '90 days'`},
 {id:'class-too-large',object:'class',kind:'class_evolution',title:'A class grew large without a split',severity:15,cooldown_days:30,
  sql:`select e.type target, count(*)||' members and no split' detail from entities e join entity_types et on et.type=e.type
   where et.schema->>'kind'='class' and coalesce(et.schema->>'splitBy','null')='null' group by e.type having count(*) > 20000`},
 {id:'class-unit-jumps',object:'class',kind:'data_verify',title:'A measure changes unit between years',severity:70,cooldown_days:7,sql:'fn:unitJumps'},
 {id:'class-narrow-spec',object:'class',kind:'class_spec',title:'A class declares too few fields',severity:35,cooldown_days:60,
  sql:`with recursive line(type, anc, d) as (select type, type, 0 from entity_types where schema->>'kind'='class'
     union all select l.type, p.schema->>'extends', l.d+1 from line l join entity_types p on p.type=l.anc where coalesce(p.schema->>'extends','')<>'' and l.d<30),
   spec as (select l.type, sum(case when jsonb_typeof(a.schema->'metrics')='array' then jsonb_array_length(a.schema->'metrics') else 0 end) metrics,
     sum(case when jsonb_typeof(a.schema->'attributes')='array' then jsonb_array_length(a.schema->'attributes') else 0 end) attrs from line l join entity_types a on a.type=l.anc group by l.type)
   select s.type target, 'declares '||s.metrics||' measures and '||s.attrs||' attributes (with inherited ones)' detail from spec s join entity_types et on et.type=s.type
   where (s.metrics < 15 or s.metrics+s.attrs < 30) and (et.topic_id is not null or exists (select 1 from entities e where e.type=s.type))`},
 {id:'class-universe-unverified',object:'class',kind:'class_members',title:'A member list not confirmed by two independent lists',severity:35,cooldown_days:30,
  sql:`select et.type target, 'the member list is confirmed by '||coalesce(g.n,0)||' independent list(s) of the 2 needed: compare it with official registries, directories, federations or Wikidata and load what is missing' detail
   from entity_types et left join lateral (select count(*) n from jsonb_array_elements(case when jsonb_typeof(et.schema->'universe'->'checks')='array' then et.schema->'universe'->'checks' else '[]'::jsonb end) c
     where (c->>'at')::timestamptz > now() - interval '180 days' and (c->>'listed')::numeric > 0 and (c->>'matched')::numeric/(c->>'listed')::numeric >= 0.9) g on true
   where et.schema->>'kind'='class' and coalesce(g.n,0) < 2 and exists (select 1 from entities e where e.type=et.type)
   order by (et.topic_id is not null) desc, et.type`},
 {id:'class-thin-measures',object:'class',kind:'class_fields',title:'Fewer than half of the declared measures are collected',severity:45,cooldown_days:7,sql:'fn:classGaps'},
 {id:'ranking-thin',object:'class',kind:'class_fields',title:'A published ranking compares on fewer than 5 measures with data',severity:75,cooldown_days:7,
  sql:`select distinct r.scope->>'type' target, 'the ranking '||r.slug||' has fewer than 5 measures with data: load the class''s declared metrics' detail from rankings r
   where r.status='published' and coalesce(r.scope->'filters','{}'::jsonb)='{}'::jsonb and r.scope->>'type' is not null
    and (select count(*) from unnest(r.criteria) c where c !~ '${DESCRIPTIVE_SQL}'
      and exists (select 1 from observations o join entities e on e.id=o.entity_id where e.type=r.scope->>'type' and o.metric=split_part(c,'@',1) limit 1)) < 5`},
 {id:'page-thin-ranking',object:'page',kind:'page_refresh',title:'A page ranks by too few meaningful measures',severity:55,cooldown_days:7,
  sql:`select distinct t.slug target, r.slug||' ranks by fewer than 5 measures with data: choose criteria readers compare (never a year or date)' detail from rankings r join topics t on t.id=r.topic_id
   where r.status='published' and coalesce(r.scope->'filters','{}'::jsonb)='{}'::jsonb
    and (select count(*) from unnest(r.criteria) c where c !~ '${DESCRIPTIVE_SQL}'
      and exists (select 1 from observations o join entities e on e.id=o.entity_id where e.type=r.scope->>'type' and o.metric=split_part(c,'@',1) limit 1)) < 5`},
 {id:'page-empty',object:'page',kind:'page_retire',title:'A page has had nothing to show for 30 days',severity:20,cooldown_days:60,
  sql:`select t.slug target, 'nothing to show for 30 days' detail from topics t where t.status<>'archived' and exists (select 1 from rankings r where r.topic_id=t.id and r.status<>'archived')
   and not exists (select 1 from rankings r join ranking_members m on m.ranking_id=r.id where r.topic_id=t.id)
   and not exists (select 1 from rankings r where r.topic_id=t.id and (r.members_at is null or r.updated_at > now() - interval '30 days'))`},
 // Patrols: every class and page is looked at by its owner in turn, not only when a check above fails — 30 days for
 // what readers see, 90 otherwise; never patrolled first, then parents before children.
 {id:'class-patrol',object:'class',kind:'class_patrol',title:'Scheduled full check of a class',severity:10,cooldown_days:30,
  sql:`with recursive tree(type, depth) as (select type, 0 from entity_types where schema->>'kind'='class' and coalesce(schema->>'extends','')=''
     union all select c.type, t.depth+1 from entity_types c join tree t on c.schema->>'extends'=t.type where c.schema->>'kind'='class' and t.depth < 30),
   info as (select t.type, t.depth, et.topic_id is not null or exists (select 1 from entities e where e.type=t.type) seen,
     (select max(created_at) from work_tasks w where w.kind='class_patrol' and w.target=t.type) last from tree t join entity_types et on et.type=t.type)
   select type target, 'scheduled patrol' detail from info where coalesce(last,'epoch'::timestamptz) < now() - make_interval(days => case when seen then 30 else 90 end)
    and not exists (select 1 from work_tasks w where w.target=info.type and w.pool='collector' and w.created_at > now() - interval '7 days')
   order by (last is null) desc, seen desc, depth, type`},
 {id:'page-patrol',object:'page',kind:'page_patrol',title:'Scheduled full check of a page',severity:10,cooldown_days:30,
  sql:`with recursive tree(id, depth) as (select id, 0 from topics where parent_id is null and status<>'archived'
     union all select c.id, t.depth+1 from topics c join tree t on c.parent_id=t.id where c.status<>'archived' and t.depth < 30),
   info as (select tp.slug, t.depth, exists (select 1 from rankings r where r.topic_id=tp.id and r.status='published') live,
     (select max(created_at) from work_tasks w where w.kind='page_patrol' and w.target=tp.slug) last from tree t join topics tp on tp.id=t.id)
   select slug target, 'scheduled patrol' detail from info where coalesce(last,'epoch'::timestamptz) < now() - make_interval(days => case when live then 30 else 90 end)
    and not exists (select 1 from work_tasks w where w.target=info.slug and w.pool='editor' and w.created_at > now() - interval '7 days')
   order by (last is null) desc, live desc, depth, slug`},
];

// A query an agent wrote must be one read-only SELECT over the site's tables.
const FORBIDDEN=/;|--|\/\*|\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|call|do|vacuum|analyze|lock|listen|notify|set|reset|prepare|execute|pg_sleep|pg_read|pg_ls|pg_stat_file|lo_\w+|dblink|pg_terminate|pg_cancel|set_config|pg_reload|current_setting)\b/i;
export function checkSqlProblem(sql:string):string|undefined{
 const s=sql.trim();
 if(!/^(select|with)\b/i.test(s))return 'A check is one SELECT (or WITH … SELECT) query.';
 if(FORBIDDEN.test(s))return 'Only a plain read-only SELECT: no semicolons, comments, writes, settings or server functions.';
 if(s.length>6000)return 'The query is too long (6000 characters at most).';
 return undefined;
}
// Run a check's query: read-only, time-limited, at most `limit` rows {target, detail}.
async function runSql(db:Queryable,sql:string,limit:number,timeout='30s'):Promise<{target:string;detail:string}[]>{
 const q=`select * from (${sql}) q limit ${Math.max(1,Math.min(2000,limit))}`;
 const rows=typeof (db as Partial<EntityDb>).tx==='function'?await (db as EntityDb).tx(async t=>{await t.query('set transaction read only');await t.query(`set local statement_timeout = '${timeout}'`);return (await t.query<Row>(q)).rows;})
  :(await db.query<Row>(q)).rows;
 if(rows.length&&!('target' in rows[0]))throw Error('A check query must return a column named target.');
 return rows.map(r=>({target:String(r.target??'').trim(),detail:String(r.detail??'').slice(0,800)})).filter(r=>r.target);
}
async function runFn(db:Queryable,name:string,limit:number):Promise<{target:string;detail:string;payload?:Row}[]>{
 if(name==='classGaps'){
  // Classes with members whose members mostly lack the declared measures (checked 60 at a time, classes with pages
  // and large classes first; a class checked in the last 7 days waits).
  const rows=(await db.query<{type:string}>(`select et.type from entity_types et where et.schema->>'kind'='class' and exists (select 1 from entities e where e.type=et.type)
    and not exists (select 1 from work_tasks w where w.target=et.type and w.kind in ('class_fields','class_members') and w.created_at > now() - interval '7 days')
   order by (et.topic_id is not null) desc, (select count(*) from entities e where e.type=et.type) desc limit $1::int`,[Math.min(limit,60)])).rows;
  const out:{target:string;detail:string;payload?:Row}[]=[];
  for(const r of rows){const g=await classGapsOf(db,r.type);if(!g||g.metricsCovered>=wantCovered(g.metrics))continue;
   out.push({target:r.type,detail:`only ${g.metricsCovered} of ${g.metrics} declared measures are collected for most members: collect every one a source has`,payload:{missingMetrics:g.missingMetrics}});}
  return out;
 }
 if(name==='unitJumps'){
  // The same measure of a class whose typical value jumps 20-fold from one year to the next: a unit or scale changed
  // between sources (a share as 0–1 against a percentage, thousands against units) — rankings mix them.
  const rows=(await db.query<{type:string;metric:string;pp:string;prev:number;period:string;med:number}>(`with m as (select e.type, o.metric, o.period, percentile_cont(0.5) within group (order by o.value) med
    from observations o join entities e on e.id=o.entity_id where o.value<>0 and o.period ~ '^\\d{4}$' and o.source not like 'derived:%' and o.metric !~ '(growth|change|_yoy|inflation|return)' group by 1,2,3 having count(*)>=20),
   r as (select type, metric, period, med, lag(med) over (partition by type, metric order by period) prev, lag(period) over (partition by type, metric order by period) pp from m)
   select type, metric, pp, prev, period, med from r where prev>0 and med>0 and (med/prev>20 or med/prev<0.05) limit $1::int`,[limit])).rows;
  const by=new Map<string,string[]>();for(const r of rows){const l=by.get(r.type)||[];l.push(`${r.metric}: typical value ${Number(r.prev).toPrecision(3)} in ${r.pp} but ${Number(r.med).toPrecision(3)} in ${r.period}`);by.set(r.type,l);}
  return [...by].map(([target,l])=>({target,detail:'A unit or scale changed between sources, so values cannot be compared: '+l.join('; ')+'. Put every value of each measure in one unit (convert or retract the wrong ones) and fix the recipe that loaded them.'}));
 }
 throw Error('Unknown built-in check '+name);
}
// How many of a class's declared measures must be collected for most members: at least half (and at least 5).
export const wantCovered=(declared:number)=>Math.min(declared,Math.max(5,Math.ceil(declared*Number(process.env.CLASS_MIN_COVERAGE||0.5))));
export async function classGapsOf(db:Queryable,type:string){
 const {effectiveType}=await import('@/app/entity-db/inherit');const eff=await effectiveType(db,type).catch(()=>null);
 const metrics=(Array.isArray((eff?.schema as Row|undefined)?.metrics)?(eff!.schema as Row).metrics as Row[]:[]).map(m=>String(m.key));
 const n=Number((await db.query<{n:number}>('select count(*)::int n from entities where type=$1',[type])).rows[0]?.n||0);if(!n)return null;
 const have=new Map((await db.query<{metric:string;n:number}>(`select o.metric, count(distinct o.entity_id)::int n from observations o join entities e on e.id=o.entity_id where e.type=$1 and o.metric=any($2::text[]) group by 1`,[type,metrics])).rows.map(r=>[r.metric,r.n]));
 const covered=metrics.filter(k=>(have.get(k)||0)>=0.5*n);
 return {metrics:metrics.length,metricsCovered:covered.length,missingMetrics:metrics.filter(k=>!covered.includes(k)).slice(0,40)};
}

// How much readers would gain: a class or page readers see, and how much it is read.
async function impact(db:Queryable,object:'class'|'page',targets:string[]):Promise<Map<string,number>>{
 const keys=targets.map(t=>t.startsWith('class:')?t.slice(6):t);
 const rows=(await db.query<{k:string;seen:boolean;views:number}>(object==='class'
  ?`select et.type k, et.topic_id is not null seen, coalesce((select sum(v.n) from rankings r join ranking_views v on v.slug=r.slug where r.topic_id=et.topic_id and v.day > current_date - 30),0)::int views from entity_types et where et.type = any($1::text[])`
  :`select t.slug k, exists (select 1 from rankings r where r.topic_id=t.id and r.status='published') seen, coalesce((select sum(v.n) from rankings r join ranking_views v on v.slug=r.slug where r.topic_id=t.id and v.day > current_date - 30),0)::int views from topics t where t.slug = any($1::text[])`,[keys])).rows;
 const m=new Map(rows.map(r=>[r.k,(r.seen?10:0)+Math.min(20,Math.round(6*Math.log10(1+Number(r.views||0))))]));
 return new Map(targets.map((t,i)=>[t,m.get(keys[i])||0]));
}

// Keep the built-in checks in the table (their text may change with the code; their status is kept).
export async function syncBuiltins(db:Queryable){
 for(const c of BUILTIN)await db.query(`insert into checks(id, object, kind, title, severity, cooldown_days, sql, status, created_by) values ($1,$2,$3,$4,$5,$6,$7,'active','system')
  on conflict (id) do update set object=excluded.object, kind=excluded.kind, title=excluded.title, severity=excluded.severity, cooldown_days=excluded.cooldown_days, sql=excluded.sql
  where checks.created_by='system'`,[c.id,c.object,c.kind,c.title,c.severity,c.cooldown_days,c.sql]);
}

const poolSizes=():Record<string,number>=>{const out:Record<string,number>={collector:2,editor:1,reviewer:1,manager:1};
 for(const p of String(process.env.WORK_POOLS||'').split(',')){const [k,v]=p.split(':');if(k&&Number(v)>0)out[k.trim()]=Number(v);}return out;};

// The loop: run every active and trial check, rank all failures by severity × what readers gain, and give each pool
// only as much as it can do in the next rounds (the rest are found again next time — checks look at state).
export async function runChecks(db:Queryable,log:(e:Row)=>void=e=>console.log('[work:checks]',JSON.stringify(e))):Promise<Row>{
 const {KINDS}=await import('./kinds');
 await syncBuiltins(db);
 // Heavy checks (fn:unitJumps scans every observation) run once a day.
 const checks=(await db.query<Check>(`select id, object, kind, title, severity, cooldown_days, sql, status, created_by from checks where status in ('active','trial')
  and not (sql in ('fn:unitJumps') and last_run > now() - interval '23 hours') order by id`)).rows;
 const objects={class:Number((await db.query<{n:number}>(`select count(*)::int n from entity_types where schema->>'kind'='class'`)).rows[0]?.n||0),
  page:Number((await db.query<{n:number}>(`select count(*)::int n from topics where status<>'archived'`)).rows[0]?.n||0)};
 type Cand={check:Check;target:string;detail:string;payload?:Row;priority:number};
 const cands:Cand[]=[];const stats:Row={};
 for(const c of checks){
  const def=KINDS[c.kind];if(!def)continue;
  let found:{target:string;detail:string;payload?:Row}[]=[];
  try{found=c.sql.startsWith('fn:')?await runFn(db,c.sql.slice(3),200):await runSql(db,c.sql,c.status==='trial'?2000:400,c.created_by==='system'?'180s':'30s');}
  catch(e){await db.query(`update checks set last_run=now(), last_error=$2 where id=$1`,[c.id,String((e as Error).message).slice(0,500)]);stats[c.id]='error';continue;}
  await db.query(`update checks set last_run=now(), last_error=null, last_count=$2, sample=$3::jsonb where id=$1`,[c.id,found.length,JSON.stringify(found.slice(0,10))]);
  stats[c.id]=found.length;
  // An agent's check that flags most of the site is more likely wrong than the site: pause it, tell the operators.
  if(c.created_by!=='system'&&found.length>100&&found.length>0.5*objects[c.object]){
   await db.query(`update checks set status='paused' where id=$1`,[c.id]);
   const {raiseIssue}=await import('@/app/ops/issues');
   await raiseIssue(db,{source:'checks',severity:'major',title:'Check paused: '+c.title,detail:`The check ${c.id} (by ${c.created_by}) flagged ${found.length} of ${objects[c.object]} ${c.object}es, so it was paused. Query: ${c.sql}`}).catch(()=>{});
   continue;
  }
  if(c.status==='trial')continue;
  const imp=await impact(db,c.object,found.map(f=>f.target));
  for(const f of found)cands.push({check:c,target:f.target,detail:f.detail,payload:f.payload,priority:Math.min(99,c.severity+(imp.get(f.target)||0))});
 }
 // Room per pool: the queue holds about two rounds of its workers' work.
 const sizes=poolSizes();
 const queued=new Map((await db.query<{pool:string;n:number}>(`select pool, count(*)::int n from work_tasks where status='queued' group by pool`)).rows.map(r=>[r.pool,r.n]));
 const room:Record<string,number>={};for(const p of Object.keys(sizes))room[p]=Math.max(0,2*Math.max(2,sizes[p])-(queued.get(p)||0));
 cands.sort((a,b)=>b.priority-a.priority);
 const made:Record<string,number>={};
 for(const c of cands){
  const pool=KINDS[c.check.kind].pool as Pool;if(!(room[pool]>0))continue;
  if((await db.query(`select 1 from work_tasks where kind=$1 and target=$2 and created_at > now() - make_interval(days => $3::int) limit 1`,[c.check.kind,c.target,c.check.cooldown_days])).rows.length)continue;
  const r=await enqueue(db,{kind:c.check.kind,pool,target:c.target,priority:c.priority,requestedBy:'check:'+c.check.id,payload:{why:c.detail||c.check.title,check:c.check.id,...(c.payload||{})}});
  if(r.created){room[pool]--;made[c.check.id]=(made[c.check.id]||0)+1;}
 }
 log({event:'checked',found:stats,made});
 return made;
}

// An agent adds a check: validated, tried on the data, put on trial, and a reviewer asked to confirm its findings.
export async function proposeCheck(db:Queryable,a:{title:string;object:string;kind:string;sql:string;why:string;severity?:number},by:string):Promise<Row>{
 const {KINDS}=await import('./kinds');
 const object=a.object==='page'?'page':a.object==='class'?'class':'';if(!object)throw Error('object must be "class" or "page".');
 const def=KINDS[a.kind];if(!def||def.target!==object)throw Error(`kind must be a task kind on a ${object} (one of: ${Object.entries(KINDS).filter(([,k])=>k.target===object).map(([n])=>n).join(', ')}).`);
 const p=checkSqlProblem(a.sql);if(p)throw Error(p);
 const sample=await runSql(db,a.sql,2000);
 const id='agent-'+String(a.title).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,50);
 const severity=Math.max(0,Math.min(60,Math.round(Number(a.severity)||30)));
 const r=(await db.query<{id:string}>(`insert into checks(id, object, kind, title, severity, cooldown_days, sql, status, created_by, why, last_count, sample) values ($1,$2,$3,$4,$5,14,$6,'trial',$7,$8,$9,$10::jsonb)
  on conflict (id) do nothing returning id`,[id,object,a.kind,String(a.title).slice(0,200),severity,a.sql,by,String(a.why||'').slice(0,1000),sample.length,JSON.stringify(sample.slice(0,10))])).rows[0];
 if(!r)throw Error('A check with this title exists already ('+id+').');
 await enqueue(db,{kind:'check_trial',pool:'reviewer',target:'check:'+id,priority:50,requestedBy:by,payload:{check:{id,title:a.title,object,kind:a.kind,why:a.why,sql:a.sql},flagged:sample.length,sample:sample.slice(0,10)}});
 return {id,status:'trial',flagged:sample.length,sample:sample.slice(0,5)};
}
