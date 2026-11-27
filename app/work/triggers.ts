import type {Queryable} from '@/app/entity-db/client';
import {enqueue} from './queue';
// What creates work, besides tasks finishing and agents asking each other. Run every 15 minutes; each trigger is
// bounded so the queues stay short (a pool's queue holds at most a few rounds of its workers' work).
type Row=Record<string,unknown>;
// Fields that describe an entity (when it began, how old it is) and do not compare it.
export const DESCRIPTIVE=/(^|_)(year|years|date|founded|established|opened|launch|launched|release|released|since|inception|start|end|age)($|_)/;
const room=async(db:Queryable,kind:string,max:number)=>Math.max(0,max-Number((await db.query<{n:number}>(`select count(*)::int n from work_tasks where kind=$1 and status='queued'`,[kind])).rows[0]?.n||0));
const recently=async(db:Queryable,kind:string,target:string,days:number)=>(await db.query(`select 1 from work_tasks where kind=$1 and target=$2 and created_at > now() - make_interval(days => $3::int) limit 1`,[kind,target,days])).rows.length>0;

// The page (topic slug) a site path belongs to.
export async function pageOfPath(db:Queryable,path:string):Promise<string>{
 if(!path)return '';const {pathMaps}=await import('@/app/entity-db/pages');const n=(await pathMaps(db)).nodes.get(path.split('?')[0]);
 if(!n)return '';if(n.kind!=='ranking')return n.slug;
 return (await db.query<{slug:string}>('select t.slug from rankings r join topics t on t.id=r.topic_id where r.slug=$1::text',[n.slug])).rows[0]?.slug||'';
}
export async function runTriggers(db:Queryable,log:(e:Row)=>void=e=>console.log('[work:triggers]',JSON.stringify(e))):Promise<Row>{
 const made:Record<string,number>={};const add=(k:string)=>{made[k]=(made[k]||0)+1;};
 // 1. Classes without members: collect them — classes the site already shows first (their pages wait), then by the
 //    size of their universe.
 {let n=await room(db,'class_members',12);
  const rows=n?(await db.query<{type:string;shown:boolean}>(`select et.type, (et.topic_id is not null) shown from entity_types et
   where et.schema->>'kind'='class' and not exists (select 1 from entities e where e.type=et.type)
    and not exists (select 1 from entity_types c where c.schema->>'extends'=et.type and c.schema->>'kind'='class')
    and not exists (select 1 from work_tasks w where w.kind in ('class_members','class_fields') and w.target=et.type and w.created_at > now() - interval '30 days')
   order by (et.topic_id is not null) desc, coalesce((et.schema->'universe'->>'expectedCount')::numeric,0) desc limit $1::int`,[n])).rows:[];
  for(const r of rows){if((await enqueue(db,{kind:'class_members',pool:'collector',target:r.type,priority:r.shown?60:40,payload:{why:'the class has no members'}})).created){add('class_members');n--;}}}
 // 2. Classes with members and no page: build one.
 {const n=await room(db,'page_build',6);
  const rows=n?(await db.query<{type:string}>(`select et.type from entity_types et where et.schema->>'kind'='class' and et.topic_id is null
   and (select count(*) from entities e where e.type=et.type) >= 10
   and not exists (select 1 from work_tasks w where w.kind='page_build' and w.target='class:'||et.type and w.created_at > now() - interval '30 days') limit $1::int`,[n])).rows:[];
  for(const r of rows)if((await enqueue(db,{kind:'page_build',pool:'editor',target:'class:'+r.type,priority:50,payload:{why:'the class has members and no page'}})).created)add('page_build');}
 // 3. Collection rules that failed: repair.
 {const rows=(await db.query<{type:string;name:string;error:string}>(`select type, name, coalesce(last_result->>'error','') error from recipes
   where status='active' and coalesce((last_result->>'ok')::boolean,true)=false limit 20`).catch(()=>({rows:[]}))).rows;
  for(const r of rows)if((await enqueue(db,{kind:'source_repair',pool:'collector',target:r.type,priority:70,payload:{recipe:r.name,error:r.error.slice(0,500)}})).created)add('source_repair');}
 // 4. Sources not reviewed for 90 days (classes with members).
 {const n=await room(db,'source_review',3);
  const rows=n?(await db.query<{type:string}>(`select distinct r.type from recipes r where r.status='active'
   and not exists (select 1 from work_tasks w where w.kind='source_review' and w.target=r.type and w.created_at > now() - interval '90 days')
   and r.created_at < now() - interval '90 days' limit $1::int`,[n]).catch(()=>({rows:[]}))).rows:[];
  for(const r of rows)if((await enqueue(db,{kind:'source_review',pool:'collector',target:r.type,priority:20,payload:{why:'90-day source review'}})).created)add('source_review');}
 // 5. Broken links and site-review findings (open issues) → the page's editor.
 {const rows=(await db.query<{id:string;topic:string|null;title:string;detail:string;source:string}>(`select id, topic, title, detail, source from issues
   where status='open' and source in ('link-check','site-review') order by created_at limit 30`).catch(()=>({rows:[]}))).rows;
  for(const r of rows){const target=r.topic||await pageOfPath(db,/On (\/[^\s]+)/.exec(r.detail)?.[1]?.replace(/[.,]$/,'')||'');if(!target)continue;
   if((await enqueue(db,{kind:'page_fix',pool:'editor',target,priority:65,payload:{issue:r.title,detail:r.detail.slice(0,800),source:r.source}})).created)add('page_fix');
   await db.query(`update issues set status='resolved', resolution='handed to the work queue', resolved_by='work', resolved_at=now() where id=$1`,[r.id]).catch(()=>{});}}
 // 6. Readers' unserved queries → a page for what they asked.
 {const rows=(await db.query<{slug:string;queries:string[]}>(`select t.slug, (array_agg(i.query order by i.created_at desc))[1:20] queries from inbox i
   join editors e on e.id=i.editor_id join topics t on t.id=e.topic_id where i.triaged_at is null group by t.slug having count(*) >= 3 limit 10`).catch(()=>({rows:[]}))).rows;
  for(const r of rows)if((await enqueue(db,{kind:'page_build',pool:'editor',target:'inbox:'+r.slug,priority:55,payload:{queries:r.queries}})).created)add('page_build');}
 // 7. Data anomalies the quality sweep found (open qa issues) → the class's collector.
 {const rows=(await db.query<{id:string;title:string;detail:string;topic:string|null}>(`select id, title, detail, topic from issues where status='open' and source='qa' limit 20`).catch(()=>({rows:[]}))).rows;
  for(const r of rows){const cls=(await db.query<{type:string}>(`select et.type from entity_types et join topics t on t.id=et.topic_id where t.slug=$1 limit 1`,[r.topic||''])).rows[0]?.type;if(!cls)continue;
   if((await enqueue(db,{kind:'data_verify',pool:'collector',target:cls,priority:55,payload:{issue:r.title,detail:r.detail.slice(0,800)}})).created)add('data_verify');
   await db.query(`update issues set status='resolved', resolution='handed to the work queue', resolved_by='work', resolved_at=now() where id=$1`,[r.id]).catch(()=>{});}}
 // 8. Reader reports (errors, takedown requests) → the owner; takedowns also go to the operators.
 {const rows=(await db.query<{id:string;path:string;kind:string;text:string;class:string|null;page:string|null}>(`select id, path, kind, text, class, page from reader_reports where status='new' limit 30`).catch(()=>({rows:[]}))).rows;
  for(const r of rows){
   if(r.kind==='takedown'){const {raiseIssue}=await import('@/app/ops/issues');await raiseIssue(db,{source:'reader',severity:'blocker',title:'Takedown request: '+r.path,detail:r.text.slice(0,2000),fingerprint:'takedown:'+r.id}).catch(()=>{});}
   else if(r.class)await enqueue(db,{kind:'data_verify',pool:'collector',target:r.class,priority:70,payload:{report:r.text.slice(0,1500),path:r.path}});
   else if(r.page)await enqueue(db,{kind:'page_fix',pool:'editor',target:r.page,priority:70,payload:{report:r.text.slice(0,1500),path:r.path}});
   await db.query(`update reader_reports set status='queued' where id=$1`,[r.id]);add('reader_report');}}
 // 9. Dated events in the calendar (platform_state "calendar": [{date, page, what}]) two weeks ahead.
 {const cal=(await db.query<{value:Row}>(`select value from platform_state where key='calendar'`)).rows[0]?.value;
  for(const e of Array.isArray(cal?.items)?cal!.items as Row[]:[]){const d=Date.parse(String(e.date||''));if(!d||d-Date.now()>14*86400_000||d<Date.now())continue;
   const target=String(e.page||'');if(!target||await recently(db,'calendar_event',target,20))continue;
   if((await enqueue(db,{kind:'calendar_event',pool:'editor',target,priority:60,payload:e})).created)add('calendar_event');}}
 // 10. Classes that grew large without a split: propose how they should change (at most 2 a day).
 {const rows=(await db.query<{type:string;n:number}>(`select e.type, count(*)::int n from entities e join entity_types et on et.type=e.type
   where et.schema->>'kind'='class' and coalesce(et.schema->>'splitBy','null')='null' group by e.type having count(*) > 20000 limit 5`)).rows;
  for(const r of rows.slice(0,2))if(!await recently(db,'class_evolution',r.type,30)&&(await enqueue(db,{kind:'class_evolution',pool:'collector',target:r.type,priority:15,payload:{why:`${r.n} members and no split`}})).created)add('class_evolution');}
 // 11. Pages whose rankings have nothing to show for 30 days → retire or merge.
 {const rows=(await db.query<{slug:string}>(`select t.slug from topics t where t.status<>'archived' and exists (select 1 from rankings r where r.topic_id=t.id and r.status<>'archived')
   and not exists (select 1 from rankings r join ranking_members m on m.ranking_id=r.id where r.topic_id=t.id)
   and not exists (select 1 from rankings r where r.topic_id=t.id and (r.members_at is null or r.updated_at > now() - interval '30 days')) limit 5`).catch(()=>({rows:[]}))).rows;
  for(const r of rows)if(!await recently(db,'page_retire',r.slug,60)&&(await enqueue(db,{kind:'page_retire',pool:'editor',target:r.slug,priority:20,payload:{why:'nothing to show for 30 days'}})).created)add('page_retire');}
 // 12. Spending: near the month's cap → the operators and the manager decide what waits.
 {const {llmSpend}=await import('@/app/llm');const s=await llmSpend().catch(()=>null);const cap=Number(process.env.TEAM_MONTHLY_BUDGET_USD||200);
  if(s&&s.spentUsd>=cap*0.9&&!await recently(db,'arbitrate','budget',7)){await enqueue(db,{kind:'arbitrate',pool:'manager',target:'budget',priority:80,payload:{why:`model spending ${s.spentUsd.toFixed(0)} of ${cap} USD this month: decide what waits`}});add('budget');}}
 // 13. Rankings readers cannot use: fewer than 5 measures with data that compare the entities (years and dates
 //     describe, they do not rank) → the collectors load the class's declared measures first, then the editor
 //     re-chooses the criteria.
 {const rows=(await db.query<{slug:string;page:string;type:string}>(`select r.slug, t.slug page, r.scope->>'type' type from rankings r join topics t on t.id=r.topic_id
   where r.status='published' and coalesce(r.scope->'filters','{}'::jsonb)='{}'::jsonb
    and (select count(*) from unnest(r.criteria) c where c !~ '${DESCRIPTIVE.source}'
      and exists (select 1 from entity_types et, observations o, entities e where et.type=r.scope->>'type' and e.type=et.type and o.entity_id=e.id and o.metric=split_part(c,'@',1) limit 1)) < 5
   limit 20`).catch(()=>({rows:[]}))).rows;
  for(const r of rows){
   if(r.type&&!await recently(db,'class_fields',r.type,7)&&(await enqueue(db,{kind:'class_fields',pool:'collector',target:r.type,priority:80,payload:{why:`the ranking ${r.slug} has fewer than 5 measures with data: load the class's declared metrics (what readers compare), not descriptive fields`}})).created)add('thin_ranking_data');
   if(!await recently(db,'page_refresh',r.page,7)&&(await enqueue(db,{kind:'page_refresh',pool:'editor',target:r.page,priority:60,payload:{why:`${r.slug} ranks by too few meaningful measures; once the collectors load them, choose criteria readers compare (never a year or date as a criterion)`}})).created)add('thin_ranking_page');
  }}
 if(Object.keys(made).length)log({event:'triggered',...made});
 return made;
}
