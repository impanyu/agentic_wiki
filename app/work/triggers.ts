import type {Queryable} from '@/app/entity-db/client';
import {enqueue} from './queue';
// Events that create work (reader reports, issues, readers' queries, the calendar, spending), besides tasks finishing
// and agents asking each other. States that can be seen in the data are checks (./checks), run in the same sweep.
// Run every 15 minutes.
type Row=Record<string,unknown>;
// Fields that describe an entity (when it began, how old it is) and do not compare it.
export const DESCRIPTIVE=/(^|_)(year|years|date|founded|established|opened|launch|launched|release|released|since|inception|start|end|age)($|_)/;
const recently=async(db:Queryable,kind:string,target:string,days:number)=>(await db.query(`select 1 from work_tasks where kind=$1 and target=$2 and created_at > now() - make_interval(days => $3::int) limit 1`,[kind,target,days])).rows.length>0;

// The page (topic slug) a site path belongs to.
export async function pageOfPath(db:Queryable,path:string):Promise<string>{
 if(!path)return '';const {pathMaps}=await import('@/app/entity-db/pages');const n=(await pathMaps(db)).nodes.get(path.split('?')[0]);
 if(!n)return '';if(n.kind!=='ranking')return n.slug;
 return (await db.query<{slug:string}>('select t.slug from rankings r join topics t on t.id=r.topic_id where r.slug=$1::text',[n.slug])).rows[0]?.slug||'';
}
export async function runTriggers(db:Queryable,log:(e:Row)=>void=e=>console.log('[work:triggers]',JSON.stringify(e))):Promise<Row>{
 const made:Record<string,number>={};const add=(k:string)=>{made[k]=(made[k]||0)+1;};
 // 1. Broken links and site-review findings (open issues) → the page's editor.
 {const rows=(await db.query<{id:string;topic:string|null;title:string;detail:string;source:string}>(`select id, topic, title, detail, source from issues
   where status='open' and source in ('link-check','site-review') order by created_at limit 30`).catch(()=>({rows:[]}))).rows;
  for(const r of rows){const target=r.topic||await pageOfPath(db,/On (\/[^\s]+)/.exec(r.detail)?.[1]?.replace(/[.,]$/,'')||'');if(!target)continue;
   if((await enqueue(db,{kind:'page_fix',pool:'editor',target,priority:65,payload:{issue:r.title,detail:r.detail.slice(0,800),source:r.source}})).created)add('page_fix');
   await db.query(`update issues set status='resolved', resolution='handed to the work queue', resolved_by='work', resolved_at=now() where id=$1`,[r.id]).catch(()=>{});}}
 // 2. Readers' unserved queries → a page for what they asked.
 {const rows=(await db.query<{slug:string;queries:string[]}>(`select t.slug, (array_agg(i.query order by i.created_at desc))[1:20] queries from inbox i
   join editors e on e.id=i.editor_id join topics t on t.id=e.topic_id where i.triaged_at is null group by t.slug having count(*) >= 3 limit 10`).catch(()=>({rows:[]}))).rows;
  for(const r of rows)if((await enqueue(db,{kind:'page_build',pool:'editor',target:'inbox:'+r.slug,priority:55,payload:{queries:r.queries}})).created)add('page_build');}
 // 3. Data anomalies the quality sweep found (open qa issues) → the class's collector.
 {const rows=(await db.query<{id:string;title:string;detail:string;topic:string|null}>(`select id, title, detail, topic from issues where status='open' and source='qa' limit 20`).catch(()=>({rows:[]}))).rows;
  for(const r of rows){const cls=(await db.query<{type:string}>(`select et.type from entity_types et join topics t on t.id=et.topic_id where t.slug=$1 limit 1`,[r.topic||''])).rows[0]?.type;if(!cls)continue;
   if((await enqueue(db,{kind:'data_verify',pool:'collector',target:cls,priority:55,payload:{issue:r.title,detail:r.detail.slice(0,800)}})).created)add('data_verify');
   await db.query(`update issues set status='resolved', resolution='handed to the work queue', resolved_by='work', resolved_at=now() where id=$1`,[r.id]).catch(()=>{});}}
 // 4. Reader reports (errors, takedown requests) → the owner; takedowns also go to the operators.
 {const rows=(await db.query<{id:string;path:string;kind:string;text:string;class:string|null;page:string|null}>(`select id, path, kind, text, class, page from reader_reports where status='new' limit 30`).catch(()=>({rows:[]}))).rows;
  for(const r of rows){
   if(r.kind==='takedown'){const {raiseIssue}=await import('@/app/ops/issues');await raiseIssue(db,{source:'reader',severity:'blocker',title:'Takedown request: '+r.path,detail:r.text.slice(0,2000),fingerprint:'takedown:'+r.id}).catch(()=>{});}
   else if(r.class)await enqueue(db,{kind:'data_verify',pool:'collector',target:r.class,priority:70,payload:{report:r.text.slice(0,1500),path:r.path}});
   else if(r.page)await enqueue(db,{kind:'page_fix',pool:'editor',target:r.page,priority:70,payload:{report:r.text.slice(0,1500),path:r.path}});
   await db.query(`update reader_reports set status='queued' where id=$1`,[r.id]);add('reader_report');}}
 // 5. Dated events in the calendar (platform_state "calendar": [{date, page, what}]) two weeks ahead.
 {const cal=(await db.query<{value:Row}>(`select value from platform_state where key='calendar'`)).rows[0]?.value;
  for(const e of Array.isArray(cal?.items)?cal!.items as Row[]:[]){const d=Date.parse(String(e.date||''));if(!d||d-Date.now()>14*86400_000||d<Date.now())continue;
   const target=String(e.page||'');if(!target||await recently(db,'calendar_event',target,20))continue;
   if((await enqueue(db,{kind:'calendar_event',pool:'editor',target,priority:60,payload:e})).created)add('calendar_event');}}
 // 6. Spending: near the month's cap → the operators and the manager decide what waits.
 {const {llmSpend}=await import('@/app/llm');const s=await llmSpend().catch(()=>null);const cap=Number(process.env.TEAM_MONTHLY_BUDGET_USD||200);
  if(s&&s.spentUsd>=cap*0.9&&!await recently(db,'arbitrate','budget',7)){await enqueue(db,{kind:'arbitrate',pool:'manager',target:'budget',priority:80,payload:{why:`model spending ${s.spentUsd.toFixed(0)} of ${cap} USD this month: decide what waits`}});add('budget');}}
 if(Object.keys(made).length)log({event:'triggered',...made});
 const {runChecks}=await import('./checks');const checked=await runChecks(db).catch(e=>{log({event:'checks_failed',error:String((e as Error).message).slice(0,300)});return {};});
 return {...made,...checked};
}
