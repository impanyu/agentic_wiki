import {createHash} from 'node:crypto';
import type {Queryable} from '@/app/entity-db/client';
// Problems the agents and the automation cannot solve themselves. Agents raise them with the report_issue
// tool; the platform raises them on persistent failures (a recipe failing again and again, a team still
// rejected after arbitration, a team run that crashed, the monthly budget reached). One row per distinct
// problem: a repeat raises its count. Operators see them on /admin and are notified (app/ops/notify.ts) of
// new blockers and major problems; resolving one leaves its record.
export type Severity='blocker'|'major'|'minor';
export type Issue={id:number;source:string;topic:string;severity:Severity;title:string;detail:string;status:'open'|'resolved'|'ignored';
 occurrences:number;resolution:string;resolvedBy:string;createdAt:string;lastSeenAt:string;resolvedAt:string|null};
const iso=(d:unknown)=>d instanceof Date?d.toISOString():d==null?null:String(d);
const row=(r:Record<string,unknown>):Issue=>({id:Number(r.id),source:String(r.source),topic:String(r.topic||''),severity:r.severity as Severity,title:String(r.title),detail:String(r.detail||''),
 status:r.status as Issue['status'],occurrences:Number(r.occurrences),resolution:String(r.resolution||''),resolvedBy:String(r.resolved_by||''),
 createdAt:iso(r.created_at)!,lastSeenAt:iso(r.last_seen_at)!,resolvedAt:iso(r.resolved_at)});

export async function raiseIssue(db:Queryable,{source,topic='',severity='major',title,detail='',fingerprint}:{source:string;topic?:string;severity?:Severity;title:string;detail?:string;fingerprint?:string}):Promise<{issue:Issue;isNew:boolean}>{
 const fp=fingerprint||createHash('sha256').update([source,topic,title.toLowerCase().replace(/\d+/g,'#')].join('|')).digest('hex').slice(0,32);
 // A resolved problem that happens again is open again.
 const r=await db.query(`insert into issues(fingerprint,source,topic,severity,title,detail) values ($1::text,$2::text,$3::text,$4::text,$5::text,$6::text)
  on conflict (fingerprint) do update set occurrences = issues.occurrences + 1, last_seen_at = now(), detail = excluded.detail,
   severity = case when excluded.severity = 'blocker' or issues.severity = 'blocker' then 'blocker' when excluded.severity = 'major' or issues.severity = 'major' then 'major' else 'minor' end,
   status = case when issues.status = 'ignored' then 'ignored' else 'open' end, resolved_at = case when issues.status = 'ignored' then issues.resolved_at else null end
  returning *, (xmax = 0) as inserted`,[fp,source.slice(0,80),topic.slice(0,120),severity,title.slice(0,300),detail.slice(0,8000)]);
 const issue=row(r.rows[0]);const isNew=Boolean(r.rows[0].inserted);
 if(issue.status==='open'&&issue.severity!=='minor'&&(isNew||!r.rows[0].notified_at)){
  const {notifyIssue}=await import('./notify');
  if(await notifyIssue(issue).catch(e=>{console.warn('issue notify failed',(e as Error).message);return false;}))await db.query('update issues set notified_at=now() where id=$1::bigint',[issue.id]);
 }
 return {issue,isNew};
}
export async function listIssues(db:Queryable,{status='open',limit=200}:{status?:'open'|'resolved'|'ignored'|'all';limit?:number}={}):Promise<Issue[]>{
 const r=await db.query(`select * from issues where ($1::text = 'all' or status = $1::text) order by case severity when 'blocker' then 0 when 'major' then 1 else 2 end, last_seen_at desc limit $2::int`,[status,limit]);
 return r.rows.map(row);
}
export async function resolveIssue(db:Queryable,id:number,{status,resolution,by}:{status:'resolved'|'ignored'|'open';resolution:string;by:string}):Promise<void>{
 await db.query(`update issues set status=$2::text, resolution=$3::text, resolved_by=$4::text, resolved_at=case when $2::text='open' then null else now() end where id=$1::bigint`,[id,status,resolution.slice(0,4000),by.slice(0,200)]);
}
export async function issueCounts(db:Queryable):Promise<Record<string,number>>{
 const r=await db.query<{severity:string;n:number}>("select severity, count(*)::int n from issues where status='open' group by severity");
 return Object.fromEntries(r.rows.map(x=>[x.severity,x.n]));
}
