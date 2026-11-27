import type {Queryable} from '@/app/entity-db/client';
// How complete each class with a published ranking is, for the operators (admin → Progress): rows (members against
// the expected count), columns (declared measures collected for at least half the members), sources (independent
// sources behind the values; measures that rest on one source), member lists the planner found, open problems the
// Auditor's checks reported. Recomputed hourly by the worker, a few hundred classes per pass.
type Row={type:string;label:string;ranking:string};
export async function refreshClassProgress(db:Queryable,{limit=400}:{limit?:number}={}):Promise<number>{
 const classes=(await db.query<Row>(`select distinct on (r.scope->>'type') r.scope->>'type' as type, coalesce(et.label,'') label, r.slug ranking
   from rankings r join entity_types et on et.type=r.scope->>'type'
   where r.status='published' and r.slug is not null and coalesce(r.scope->'filters','{}'::jsonb)='{}'::jsonb and coalesce(r.config->>'auto','')=''
   order by r.scope->>'type', (r.config ? 'main') desc, r.updated_at desc`)).rows;
 const done=new Map((await db.query<{type:string;at:string}>(`select type, updated_at::text at from class_progress`)).rows.map(r=>[r.type,r.at]));
 // Never computed first, then the oldest.
 classes.sort((a,b)=>String(done.get(a.type)||'').localeCompare(String(done.get(b.type)||'')));
 const {withSubtypes,effectiveType}=await import('@/app/entity-db/inherit');
 let n=0;
 for(const c of classes.slice(0,limit)){
  try{
   const types=await withSubtypes(db,c.type);
   const eff=await effectiveType(db,c.type).catch(()=>null);const schema=(eff?.schema||{}) as Record<string,unknown>;
   const declared=(Array.isArray(schema.metrics)?schema.metrics as Record<string,unknown>[]:[]).filter(m=>!m.deprecated).length;
   const universe=(schema.universe||{}) as Record<string,unknown>;
   const expected=Number(universe.expectedCount||universe.expected)||null;
   const lists=Array.isArray(universe.lists)?universe.lists.length:0;
   const r=(await db.query<{members:number;covered:number;any_data:number;sources:number;single:number}>(`with ents as (select id from entities where type = any($1::text[])),
     n as (select count(*)::int n from ents),
     m as (select o.metric, count(distinct o.entity_id) k, count(distinct o.source) s from observations o join ents on ents.id=o.entity_id where o.source not like 'derived:%' group by 1)
     select (select n from n) members, count(*) filter (where k >= 0.5*(select n from n))::int covered, count(*)::int any_data,
      (select count(distinct o.source)::int from observations o join ents on ents.id=o.entity_id where o.source not like 'derived:%') sources,
      count(*) filter (where s = 1 and k >= 0.5*(select n from n))::int single from m`,[types])).rows[0];
   const probs=(await db.query<{title:string}>(`select distinct c.title from work_tasks w join checks c on w.payload->>'check' = c.id
     where w.target = $1::text and w.status in ('queued','running') limit 20`,[c.type]).catch(()=>({rows:[] as {title:string}[]}))).rows.map(x=>x.title);
   await db.query(`insert into class_progress(type,label,ranking,members,expected,declared,covered,any_data,sources,member_lists,single_source_metrics,open_problems,problems,updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now()) on conflict (type) do update set label=excluded.label, ranking=excluded.ranking, members=excluded.members,
     expected=excluded.expected, declared=excluded.declared, covered=excluded.covered, any_data=excluded.any_data, sources=excluded.sources, member_lists=excluded.member_lists,
     single_source_metrics=excluded.single_source_metrics, open_problems=excluded.open_problems, problems=excluded.problems, updated_at=now()`,
    [c.type,c.label,c.ranking,r?.members||0,expected,declared,r?.covered||0,r?.any_data||0,r?.sources||0,lists,r?.single||0,probs.length,probs]);
   n++;
  }catch(e){console.error('[progress]',c.type,(e as Error).message);}
 }
 return n;
}
// The operators' view: every class, with the summary over all of them.
export async function classProgress(db:Queryable){
 const rows=(await db.query(`select * from class_progress order by (members>0) desc, (covered::float/greatest(declared,1)) asc, members desc`)).rows;
 const tot=(await db.query<{classes:number;members:number;expected:number;declared:number;covered:number;two_sources:number;complete_rows:number}>(`select count(*)::int classes, sum(members)::int members, sum(expected)::int expected,
   sum(declared)::int declared, sum(covered)::int covered, count(*) filter (where sources >= 2 and member_lists >= 2)::int two_sources,
   count(*) filter (where expected is not null and members >= 0.9*expected)::int complete_rows from class_progress`)).rows[0];
 return {rows,tot};
}
