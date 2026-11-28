import type {Queryable} from '@/app/entity-db/client';
import {hostOf} from './health';
// The Sources layer's register: one row per source host, rebuilt hourly from what uses it (collection rules and
// the fields' planned sources, per class) and how it answered over the last 7 days (health.ts). Each source has an
// access route (api, bulk, page, render, archive), a status (ok, degraded, limited, blocked, down, failing, idle) and,
// when it is not open, the backups that already feed the same classes. Stuck sources are worked on automatically:
// the class's collectors are asked to move to a backup or find one (source_review); only a source with no backup
// anywhere reaches the operators, as one concrete request (an official API, a partner feed or a licence).
type Row=Record<string,unknown>;
type Acc={name:string;classes:Set<string>;fields:number;recipes:number;failing:number;access:Map<string,number>};

// Built-in public sources (call_public_source) by the host they call.
const PROVIDER_HOSTS:Record<string,string>={wikidata:'query.wikidata.org',wikipedia:'en.wikipedia.org',worldbank:'api.worldbank.org',countries:'restcountries.com',
 openalex:'api.openalex.org',appstore:'rss.marketingtools.apple.com',steam:'api.steampowered.com',coingecko:'api.coingecko.com',osm:'overpass-api.de',
 stackexchange:'api.stackexchange.com',hackernews:'hacker-news.firebaseio.com',packages:'registry.npmjs.org',gbif:'api.gbif.org',openlibrary:'openlibrary.org',
 musicbrainz:'musicbrainz.org',github:'api.github.com',youtube:'youtube.googleapis.com',arcgis:'arcgis.com',archive:'web.archive.org'};
export function accessOf(tool:string,url:string,render=false):string{
 if(tool==='call_public_source')return 'api';
 if(/web\.archive\.org|commoncrawl/i.test(url))return 'archive';
 if(tool==='browse_page'||render)return 'render';
 if(tool==='fetch_data'||tool==='bulk_import'){
  if(/\.(csv|tsv|zip|gz|xlsx?|parquet|jsonl|ndjson)(\?|$)|\/download|\/bulk|\/dump|s3\.amazonaws|raw\.githubusercontent/i.test(url))return 'bulk';
  if(/\/api\b|\/v\d+\/|\.json(\?|$)|[?&](format|f)=json|sparql|graphql|\/rest\//i.test(url))return 'api';
  return 'page';}
 return 'page';
}
const urlsOf=(args:Row):string[]=>{
 const out:string[]=[];for(const k of ['url','startUrl'])if(typeof args[k]==='string'&&/^https?:/i.test(args[k] as string))out.push(args[k] as string);
 if(typeof args.urls==='string')out.push(...(args.urls as string).split(/[\s,]+/).filter(u=>/^https?:/i.test(u)).slice(0,3));
 return out;
};
export function statusOf(h:{calls7:number;ok7:number;denied7:number;limited7:number;failed7:number},recipes:number,failing:number):string{
 const {calls7:c}=h;
 if(c>=3){
  if(h.denied7/c>=0.5)return 'blocked';if(h.limited7/c>=0.5)return 'limited';if(h.failed7/c>=0.7)return 'down';
  if(recipes&&failing===recipes)return 'failing';
  return h.ok7/c>=0.7?'ok':'degraded';
 }
 if(recipes&&failing===recipes)return 'failing';
 return c?(h.ok7?'ok':h.denied7?'blocked':'down'):'idle';
}
const NEEDS:Record<string,string>={blocked:'Refuses automated access: use its official API or bulk download, a partner/affiliate feed, a licence, or a backup source.',
 limited:'Rate limited: run its rules less often, smaller pages, or an API key.',down:'Not answering: check the address; move to a backup if it stays down.',
 failing:'Its collection rules fail: repair the rule or move to a backup.'};

export async function refreshSourceRegistry(db:Queryable,{escalate=true}:{escalate?:boolean}={}){
 const acc=new Map<string,Acc>();
 const get=(host:string,name='')=>{let a=acc.get(host);if(!a){a={name,classes:new Set(),fields:0,recipes:0,failing:0,access:new Map()};acc.set(host,a);}if(!a.name&&name)a.name=name;return a;};
 // 1. Collection rules: every outside address a rule calls, per class.
 const recipes=(await db.query<{type:string;status:string;steps:Row[];last_result:Row|null}>(`select type, status, steps, last_result from recipes`)).rows;
 for(const r of recipes){
  const seen=new Set<string>();const failing=r.status==='failed'||r.last_result?.ok===false;
  for(const s of Array.isArray(r.steps)?r.steps:[]){
   const tool=String(s.tool||''),args=(s.args&&typeof s.args==='object'?s.args:{}) as Row;
   const hits:[string,string][]=tool==='call_public_source'?[[PROVIDER_HOSTS[String(args.sourceId??args.source??'')]||String(args.sourceId??args.source??''),'api']]:urlsOf(args).map(u=>[hostOf(u),accessOf(tool,u,args.render===true)]);
   for(const [h,access] of hits){if(!h)continue;const a=get(h);a.access.set(access,(a.access.get(access)||0)+1);if(r.type)a.classes.add(r.type);if(!seen.has(h)){seen.add(h);a.recipes++;if(failing)a.failing++;}}
  }
 }
 // 2. Planned sources of each class's fields.
 const planned=(await db.query<{type:string;name:string;url:string;access:string}>(`select et.type, s->>'name' name, s->>'url' url, coalesce(s->>'access','') access
   from entity_types et, lateral jsonb_array_elements(case when jsonb_typeof(et.schema->'metrics')='array' then et.schema->'metrics' else '[]'::jsonb end
     || case when jsonb_typeof(et.schema->'attributes')='array' then et.schema->'attributes' else '[]'::jsonb end) f,
   lateral jsonb_array_elements(case when jsonb_typeof(f->'sources')='array' then f->'sources' else '[]'::jsonb end) s
   where et.schema->>'kind'='class' and coalesce(et.schema->>'retiredInto','')='' and s->>'url' ~ '^https?://'`)).rows;
 for(const p of planned){const h=hostOf(p.url);if(!h)continue;const a=get(h,p.name||'');a.classes.add(p.type);a.fields++;const ac=/api|bulk|page|render|archive|licen|partner|affiliate/i.exec(p.access)?.[0].toLowerCase();if(ac)a.access.set(ac,(a.access.get(ac)||0)+1);}
 // 3. Health over 7 days.
 const health=new Map((await db.query<{host:string;calls7:number;ok7:number;denied7:number;limited7:number;failed7:number;last_ok:string|null;last_error:string}>(`select host, sum(calls)::int calls7, sum(ok)::int ok7, sum(denied)::int denied7,
   sum(limited)::int limited7, sum(failed)::int failed7, max(last_ok_at)::text last_ok, (array_agg(last_error order by day desc) filter (where last_error<>''))[1] last_error
   from source_health where day>current_date-7 group by host`).catch(()=>({rows:[]}))).rows.map(r=>[r.host,r]));
 // Hosts only seen in health that feed nothing we know of are kept only when used often (agents' exploration).
 for(const [h,x] of health)if(!acc.has(h)&&x.calls7>=5)get(h);
 const rows=[...acc.entries()].map(([host,a])=>{
  const h=health.get(host)||{calls7:0,ok7:0,denied7:0,limited7:0,failed7:0,last_ok:null,last_error:''};
  const access=[...a.access.entries()].sort((x,y)=>y[1]-x[1])[0]?.[0]||'page';
  const status=statusOf(h,a.recipes,a.failing);
  return {host,name:a.name,access,status,classes:[...a.classes].sort(),fields:a.fields,recipes:a.recipes,failing:a.failing,...h,needs:NEEDS[status]||''};
 });
 // 4. Backups: other open sources that feed the same classes.
 const openByClass=new Map<string,string[]>();
 for(const r of rows)if(r.status==='ok'||r.status==='degraded'||r.status==='idle'&&r.recipes>r.failing)for(const c of r.classes){const l=openByClass.get(c)||[];l.push(r.host);openByClass.set(c,l);}
 const stuck=new Set(['blocked','down','failing','limited']);
 for(const r of rows){
  const backups=stuck.has(r.status)?r.classes.slice(0,40).map(c=>({class:c,hosts:(openByClass.get(c)||[]).filter(h=>h!==r.host).slice(0,5)})):[];
  await db.query(`insert into source_registry(host,name,access,status,classes,fields,recipes,failing_recipes,calls7,ok7,denied7,limited7,failed7,last_ok_at,last_error,backups,needs,updated_at)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::timestamptz,$15,$16::jsonb,$17,now()) on conflict (host) do update set name=case when excluded.name<>'' then excluded.name else source_registry.name end,
    access=excluded.access, status=excluded.status, classes=excluded.classes, fields=excluded.fields, recipes=excluded.recipes, failing_recipes=excluded.failing_recipes, calls7=excluded.calls7,
    ok7=excluded.ok7, denied7=excluded.denied7, limited7=excluded.limited7, failed7=excluded.failed7, last_ok_at=coalesce(excluded.last_ok_at,source_registry.last_ok_at),
    last_error=excluded.last_error, backups=excluded.backups, needs=excluded.needs, updated_at=now()`,
   [r.host,r.name,r.access,r.status,r.classes,r.fields,r.recipes,r.failing,r.calls7,r.ok7,r.denied7,r.limited7,r.failed7,r.last_ok,r.last_error||'',JSON.stringify(backups),r.needs]);
  (r as Row).backups=backups;
 }
 await db.query(`delete from source_registry where updated_at<now()-interval '1 day'`);
 let escalated=0;
 if(escalate)escalated=await escalateStuck(db,rows.filter(r=>(r.status==='blocked'||r.status==='down')&&r.classes.length).sort((a,b)=>b.classes.length-a.classes.length) as unknown as Stuck[]);
 return {sources:rows.length,stuck:rows.filter(r=>stuck.has(r.status)).length,escalated};
}

type Stuck={host:string;status:string;classes:string[];needs:string;backups:{class:string;hosts:string[]}[];last_error:string};
// A stuck source: each class it feeds gets a source_review naming the source and its open backups (at most once a
// week per class and source); a source no class has a backup for becomes one operator issue.
// Failing rules are already repaired through source_repair (triggers); this handles hosts that refuse or stopped
// answering, a few classes per pass so the collectors' queue is not flooded.
async function escalateStuck(db:Queryable,stuck:Stuck[],max=10){
 const {enqueue}=await import('@/app/work/queue');
 let n=0;
 for(const s of stuck){
  for(const b of s.backups.slice(0,8)){
   if(n>=max)return n;
   const recent=(await db.query(`select 1 from work_tasks where kind='source_review' and target=$1 and payload->>'stuckSource'=$2 and created_at>now()-interval '7 days' limit 1`,[b.class,s.host])).rows.length;
   if(recent)continue;
   await enqueue(db,{kind:'source_review',pool:'collector',target:b.class,priority:58,requestedBy:'source-registry',
    payload:{stuckSource:s.host,status:s.status,error:s.last_error.slice(0,200),backups:b.hosts,
     reason:`Source ${s.host} is ${s.status} (${s.needs}) Move this class's rules and fields off it: to ${b.hosts.length?'the open sources that already feed it ('+b.hosts.join(', ')+') or ':''}its official API or bulk download, another authoritative source, or an archived copy for history. Never try to get around a block.`}});
   n++;
  }
  if(s.backups.every(b=>!b.hosts.length)&&(s.status==='blocked'||s.status==='down')){
   const {raiseIssue}=await import('@/app/ops/issues');
   await raiseIssue(db,{source:'source-registry',severity:'minor',fingerprint:'source-stuck:'+s.host,
    title:`Source ${s.host} is ${s.status} and has no backup`,
    detail:`Feeds ${s.classes.length} class(es): ${s.classes.slice(0,10).join(', ')}. ${s.needs} Collectors have been asked to find an alternative; if none exists, this source needs an official API key, a partner/affiliate feed or a data licence. Last error: ${s.last_error||'–'}`}).catch(()=>{});
  }
 }
 return n;
}

export async function listSources(db:Queryable,{status='',q=''}:{status?:string;q?:string}={}){
 const rows=(await db.query(`select * from source_registry where ($1::text='' or status=$1 or ($1='stuck' and status in ('blocked','down','failing','limited')))
   and ($2::text='' or host ilike '%'||$2||'%' or name ilike '%'||$2||'%' or $2 = any(classes))
   order by case status when 'blocked' then 0 when 'down' then 1 when 'failing' then 2 when 'limited' then 3 when 'degraded' then 4 when 'ok' then 5 else 6 end, array_length(classes,1) desc nulls last, host limit 500`,[status,q.trim().slice(0,80)])).rows;
 const tot=(await db.query<{status:string;n:number}>(`select status, count(*)::int n from source_registry group by 1`)).rows;
 return {rows,totals:Object.fromEntries(tot.map(t=>[t.status,t.n])) as Record<string,number>};
}
// For collectors: the state of a source (by address or host) or of every source of a class.
export async function sourceStatus(db:Queryable,{source='',type=''}:{source?:string;type?:string}){
 const host=source?(hostOf(/^https?:/i.test(source)?source:'https://'+source)||source):'';
 const rows=(await db.query<Row>(`select host, name, access, status, classes, recipes, failing_recipes, calls7, ok7, denied7, limited7, failed7, last_ok_at, last_error, backups, needs
   from source_registry where ($1::text<>'' and host=$1) or ($2::text<>'' and $2 = any(classes)) order by status<>'ok', host limit 40`,[host,type])).rows;
 return {sources:rows.map(r=>({...r,classes:(r.classes as string[]).length>12?[...(r.classes as string[]).slice(0,12),'…']:r.classes})),
  note:rows.length?'status: ok/degraded = usable; blocked = refuses automated access (use its official API or bulk download, a partner feed, or a backup; never get around it); limited = slow down; down/failing = repair or move to a backup. backups: open sources already feeding the same class.':'Not in the register yet (it is rebuilt hourly from collection rules, planned field sources and requests).'};
}
