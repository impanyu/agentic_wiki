import type {Queryable,Row} from './client';
import {getEntity,metricTable,hybridSearch,RANK_LIMIT} from './repo';
import {slugify,questionKey} from '@/app/seo/urls';
import {formatMetric,entityPath,rankingPath,defaultTemplate,mentionKey,type MetricInfo,type MetricFact,type EntityPageData,type Template,type RankingDef,type RankingPageInput,type Point} from '@/app/seo/assemble';
// Reads for the database-driven pages (/rankings/<slug>, /e/<type>/<slug>), the sitemap and link
// resolution. Read-only; everything a page shows comes from here, assembled by app/seo/assemble.ts.
const iso=(d:unknown)=>d instanceof Date?d.toISOString():d==null?null:String(d);
const PAGE_STATUSES=['published','draft'];// drafts are shown too for now
const obj=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};

// ───────────── definitions ─────────────
const rankingRow=(r:Row):RankingDef=>({slug:String(r.slug),title:String(r.title||''),scope:obj(r.scope) as RankingDef['scope'],criteria:(r.criteria as string[])||[],
 config:obj(r.config),status:String(r.status||'draft'),updatedAt:iso(r.updated_at)});
export async function getRankingDefinition(db:Queryable,slug:string):Promise<RankingDef|null>{
 const r=await db.query('select slug, title, scope, criteria, config, status, updated_at from rankings where slug = $1::text and status = any($2::text[])',[slug,PAGE_STATUSES]);
 return r.rows[0]?rankingRow(r.rows[0]):null;
}
export async function listRankingDefinitions(db:Queryable,{type}:{type?:string}={}):Promise<RankingDef[]>{
 const r=await db.query(`select slug, title, scope, criteria, config, status, updated_at from rankings where slug is not null and status = any($1::text[])
  and ($2::text is null or scope->>'type' = $2::text) order by updated_at desc, slug limit 2000`,[PAGE_STATUSES,type||null]);
 return r.rows.map(rankingRow);
}
export type EntityTypeInfo={type:string;label:string;plural:string;description:string;template:Template|null;schema:Record<string,unknown>};
export async function getEntityType(db:Queryable,type:string):Promise<EntityTypeInfo>{
 const r=(await db.query('select type, label, plural, description, template, schema from entity_types where type = $1::text',[type])).rows[0];
 const t=obj(r?.template);const label=String(r?.label||'')||type.replace(/_/g,' ');
 return {type,label,plural:String(r?.plural||'')||label+'s',description:String(r?.description||''),template:Object.keys(t).length?t as Template:null,schema:obj(r?.schema)};
}
// Metric definitions by key: the published version, else the latest.
export async function metricInfos(db:Queryable,keys:string[]):Promise<Record<string,MetricInfo>>{
 if(!keys.length)return {};
 const r=await db.query(`select distinct on (key) key, label, unit, sort_order, format, description, methodology from metrics where key = any($1::text[])
  order by key, (status = 'published') desc, version desc`,[[...new Set(keys)]]);
 return Object.fromEntries(r.rows.map(x=>[String(x.key),{key:String(x.key),label:String(x.label||x.key),unit:String(x.unit||''),order:x.sort_order==='asc'?'asc':'desc',format:String(x.format||''),
  description:String(x.description||''),methodology:String(x.methodology||'')} satisfies MetricInfo]));
}

// ───────────── entity lookup by address ─────────────
// /e/<type>/<slug>: the slug is slugify(name). Candidates come from the indexed name keys and full text
// (prefix match on the slug's words), then the slug is compared exactly. An alias's slug finds the entity
// too (the page redirects to the name's slug). Same slug for two entities of a type: the oldest wins.
export async function findEntityBySlug(db:Queryable,type:string,slug:string):Promise<{id:string;name:string;canonical:boolean}|null>{
 const s=slugify(slug);const words=s.split('-').filter(w=>/^[\p{L}\p{N}]+$/u.test(w));if(!words.length)return null;
 const query=words.filter(w=>w.length>=2||words.length===1).map(w=>w+':*').join(' | ')||words[0]+':*';
 const r=await db.query<{id:string;name:string;aliases:string[]}>(`select e.id, e.name, e.aliases from entities e
  where e.type = $1::text and e.has_page and (e.name_keys && ent_keys($2::text, '{}'::text[]) or e.tsv @@ to_tsquery('simple', $3::text))
  order by (e.name_keys && ent_keys($2::text, '{}'::text[])) desc, ts_rank_cd(e.tsv, to_tsquery('simple', $3::text)) desc, e.created_at limit 500`,[type,words.join(' '),query]);
 const exact=r.rows.find(x=>slugify(x.name)===s);if(exact)return {id:exact.id,name:exact.name,canonical:true};
 const alias=r.rows.find(x=>(x.aliases||[]).some(a=>slugify(a)===s));
 return alias?{id:alias.id,name:alias.name,canonical:false}:null;
}

// ───────────── ranking page ─────────────
export async function loadRankingPage(db:Queryable,slug:string):Promise<RankingPageInput|null>{
 const def=await getRankingDefinition(db,slug);if(!def)return null;
 const criteria=def.criteria.slice(0,12);
 const type=def.scope.type?await getEntityType(db,def.scope.type):{type:'',label:'entity',plural:'entities',description:'',template:null,schema:{}};
 const defs=await metricInfos(db,criteria.map(c=>c.split('@')[0]));
 const period=typeof def.config.period==='string'&&def.config.period?def.config.period:'all';
 const table=criteria.length?await metricTable(db,{type:def.scope.type,filters:def.scope.filters,metrics:criteria,period}):{metrics:[],rows:[],period};
 const ids=[...new Set(table.rows.map(r=>String(r.entity_id)))];
 const group=typeof def.config.group==='string'?def.config.group:'';
 const entities:RankingPageInput['entities']={};
 if(ids.length){
  const r=await db.query(`select id, case when $2::text <> '' then attributes->>$2::text end as g, coalesce(ids->>'iso3', attributes->>'iso3', attributes->>'code', ids->>'iso2') as code
   from entities where id = any($1::uuid[])`,[ids,group]);
  for(const x of r.rows)entities[String(x.id)]={group:(x.g as string)||null,code:(x.code as string)||null};
 }
 const relatedSlugs=Array.isArray(def.config.related)?def.config.related.filter((x):x is string=>typeof x==='string').slice(0,20):[];
 const others=(await db.query<{slug:string;title:string}>(`select slug, title from rankings where slug is not null and status = any($1::text[]) and slug <> $2::text
  and (slug = any($3::text[]) or ($4::text <> '' and scope->>'type' = $4::text)) order by (slug = any($3::text[])) desc, title limit 12`,[PAGE_STATUSES,def.slug,relatedSlugs,def.scope.type||''])).rows;
 const expected=Number(obj(type.schema.universe).expected)||null;
 return {def,defs,columns:table.metrics.map(m=>({column:m.column,key:m.key,count:m.count})),rows:table.rows,
  type:{label:type.label,plural:type.plural,expected},entities,related:others};
}

// ───────────── entity page ─────────────
type Fact={metric:string;version?:number;value:number;period:string;source:string;retrievedAt:string|null;rank?:number;of?:number};
// Metric keys a template names (card, sections, sentences), so the peers loaded are the ones shown.
function templateMetrics(t:Template):{peer:string[];all:string[]}{
 const peer=new Set<string>(),all=new Set<string>();
 for(const c of t.card||[])if(!c.startsWith('attr.')&&!c.startsWith('rel.'))all.add(c.replace(/^metric\./,''));
 for(const s of t.sections||[]){const keys=[...(s.metrics||[]),...(s.metric?[s.metric]:[])];keys.forEach(k=>all.add(k));if(['position','peer_compare','radar_profile'].includes(s.kind))keys.forEach(k=>peer.add(k));}
 return {peer:[...peer],all:[...all]};
}
export async function loadEntityPage(db:Queryable,type:string,slug:string):Promise<{data:EntityPageData;canonical:boolean;updatedAt:string|null}|null>{
 const found=await findEntityBySlug(db,type,slug);if(!found)return null;
 const e=await getEntity(db,found.id);if(!e)return null;
 const typeInfo=await getEntityType(db,type);
 const snap=(await db.query<{latest:Row;updated_at:unknown}>('select latest, updated_at from entities where id = $1::uuid',[e.id])).rows[0];
 const snapMetrics=obj(obj(snap?.latest).metrics);
 // Latest value of each metric (a derived metric's newest version), with its rank over the whole type from the snapshot.
 const facts=new Map<string,Fact&{version:number}>();
 for(const f of e.facts as Fact[]){const v=f.version||0,prev=facts.get(f.metric);if(!prev||v>prev.version)facts.set(f.metric,{...f,version:v});}
 const hist=await db.query<{metric:string;metric_version:number;period:string;value:number}>(`select distinct on (metric, metric_version, period) metric, metric_version, period, value from observations
  where entity_id = $1::uuid and period <> '' order by metric, metric_version, period, retrieved_at desc limit 5000`,[e.id]);
 const metrics:Record<string,MetricFact>={};
 for(const [k,f] of facts){
  const s=obj(snapMetrics[f.version?k+'@'+f.version:k]);
  const rank=Number(s.rank)||f.rank||null,of=Number(s.of)||f.of||null;
  const history:Point[]=hist.rows.filter(h=>h.metric===k&&Number(h.metric_version)===f.version).map(h=>({period:String(h.period),value:Number(h.value)}));
  metrics[k]={value:f.value,period:String(f.period||''),source:f.source||undefined,retrievedAt:f.retrievedAt,rank,of,history};
 }
 const defs=await metricInfos(db,Object.keys(metrics));
 const relations={outgoing:e.relations.outgoing.map((r:Row)=>({id:String(obj(r.object).id),predicate:String(r.predicate),name:String(obj(r.object).name),type:String(obj(r.object).type),source:String(r.source||'')})),
  incoming:e.relations.incoming.map((r:Row)=>({predicate:String(r.predicate),type:String(r.type),count:Number(r.count),sample:(Array.isArray(r.sample)?r.sample:[]).map((x:Row)=>({id:String(x.id),name:String(x.name)}))}))};
 const data:EntityPageData={entity:{id:e.id,name:e.name,type:e.type,description:e.description,aliases:e.aliases,ids:e.ids,attributes:e.attributes,image:e.image},
  type:{label:typeInfo.label,plural:typeInfo.plural,template:typeInfo.template},defs,metrics,relations,peers:{},rankings:[]};
 // Peers: every entity of the type ranked in the top 1,000 on the metrics the position, peer and radar sections show.
 const tpl=typeInfo.template||defaultTemplate(data);
 const peerKeys=templateMetrics(tpl).peer.filter(k=>metrics[k]).slice(0,12);
 if(peerKeys.length){
  const t=await metricTable(db,{type,metrics:peerKeys,period:'latest'});
  for(const m of t.metrics)data.peers[m.key]=t.rows.filter(r=>typeof r[m.column]==='number'&&Number(r[m.column+'_rank'])<=RANK_LIMIT).map(r=>({name:String(r.name),type:String(r.type),value:Number(r[m.column])}));
 }
 data.rankings=await entityRankings(db,data,metrics);
 // Links: related entities by their id (exact, even when names are shared), attribute values by name or alias.
 data.entityLinks=await resolveEntityIds(db,[...relations.outgoing.map(r=>r.id),...relations.incoming.flatMap(g=>g.sample.map(x=>x.id))],e.id);
 data.links=await resolveMentions(db,Object.values(e.attributes||{}).filter((v):v is string=>typeof v==='string'&&v.length>1&&v.length<=80&&!/^https?:/i.test(v)),e.id);
 return {data,canonical:found.canonical,updatedAt:iso(snap?.updated_at)};
}
// {entity id → page path} for the related entities that have a page (their type has a template).
export async function resolveEntityIds(db:Queryable,ids:string[],selfId?:string):Promise<Record<string,string>>{
 const list=[...new Set(ids.filter(x=>/^[0-9a-f-]{36}$/i.test(x)&&x!==selfId))].slice(0,800);if(!list.length)return {};
 const r=await db.query<{id:string;type:string;name:string}>(`select e.id,e.type,e.name from entities e where e.has_page and e.id = any($1::uuid[])`,[list]);
 return Object.fromEntries(r.rows.map(x=>[String(x.id),entityPath(x.type,x.name)]));
}
// {mentionKey(name) → page path} for the names that have an entity page (a type with a template), the page
// itself excluded; an exact name wins over an alias. Resolved at render time, so links stay two-way: a new page
// is linked from every page that mentions it the next time those pages are rendered.
export async function resolveMentions(db:Queryable,names:string[],selfId?:string):Promise<Record<string,string>>{
 const list=[...new Set(names.map(n=>String(n||'').trim()).filter(n=>n&&n.length<=120))].slice(0,400);if(!list.length)return {};
 const r=await db.query<{k:string;type:string;name:string}>(`select distinct on (n.k) n.k, e.type, e.name from unnest($1::text[]) n(k)
  join entities e on e.has_page and e.name_keys && ent_keys(n.k,'{}'::text[])
  where ($2::uuid is null or e.id <> $2::uuid) order by n.k, (ent_norm(e.name)=ent_norm(n.k)) desc, e.created_at`,[list,selfId||null]);
 return Object.fromEntries(r.rows.map(x=>[mentionKey(x.k),entityPath(x.type,x.name)]));
}
// Every ranking definition whose scope contains the entity, with its rank on each criterion.
async function entityRankings(db:Queryable,d:EntityPageData,metrics:Record<string,MetricFact>){
 // Whole-type rankings first (cards link to them), then sub-rankings.
 const nf=(r:RankingDef)=>Object.keys(r.scope.filters||{}).length?1:0;
 const defs=(await listRankingDefinitions(db,{type:d.entity.type})).sort((a,b)=>nf(a)-nf(b)).slice(0,20);
 const labels=await metricInfos(db,defs.flatMap(r=>r.criteria.map(c=>c.split('@')[0])));
 const out:EntityPageData['rankings']=[];
 for(const r of defs){
  const crit=r.criteria.slice(0,12);if(!crit.length)continue;
  const label=(c:string)=>labels[c.split('@')[0]]?.label||c;
  if(!Object.keys(r.scope.filters||{}).length){
   out.push({slug:r.slug,title:r.title,filters:{},ranks:crit.map(c=>{const f=metrics[c.replace(/@\d+$/,'')];return {key:c.replace('@','_v'),label:label(c),rank:f?.rank??null,of:f?.of??null};})});
   continue;
  }
  try{
   const t=await metricTable(db,{type:r.scope.type,filters:r.scope.filters,metrics:crit,period:'latest'});
   const row=t.rows.find(x=>x.entity_id===d.entity.id);
   if(!row){const s=await hybridSearch(db,{query:d.entity.name,type:r.scope.type,filters:r.scope.filters,limit:10});if(!s.results.some(x=>x.id===d.entity.id))continue;}
   out.push({slug:r.slug,title:r.title,filters:r.scope.filters||{},ranks:t.metrics.map(m=>({key:m.column,label:m.label,rank:row&&typeof row[m.column+'_rank']==='number'?Number(row[m.column+'_rank']):!row&&metrics[m.key]?RANK_LIMIT+1:null,of:m.count||null}))});
  }catch(e){console.warn('entity page: ranking scope failed',r.slug,(e as Error).message);}
 }
 return out;
}

// ───────────── sitemap ─────────────
// Entity pages are listed for types that have a template or at least one ranking, ENTITY_SITEMAP_SIZE per file.
export const ENTITY_SITEMAP_SIZE=40_000;
// Only work the reviewer approved is listed: published types and published rankings (drafts render but are not in the sitemap).
const LISTED=['published'];
// Entities with a page (has_page) of published types.
const LISTED_TYPES=`select type from entity_types where template <> '{}'::jsonb and status = any($1::text[])`;
export async function countSitemapEntities(db:Queryable):Promise<number>{
 return Number((await db.query<{n:number}>(`select count(*)::int as n from entities e where e.has_page and e.type in (${LISTED_TYPES})`,[LISTED])).rows[0]?.n||0);
}
export async function sitemapEntities(db:Queryable,part:number,size:number):Promise<{path:string;updatedAt:string|null}[]>{
 const r=await db.query<{type:string;name:string;updated_at:unknown}>(`select e.type, e.name, e.updated_at from entities e where e.has_page and e.type in (${LISTED_TYPES})
  order by e.type, e.created_at, e.id limit $2::int offset $3::int`,[LISTED,size,part*size]);
 return r.rows.map(x=>({path:entityPath(x.type,x.name),updatedAt:iso(x.updated_at)}));
}
export async function sitemapRankings(db:Queryable):Promise<{path:string;updatedAt:string|null}[]>{
 return (await listRankingDefinitions(db)).filter(r=>r.status==='published').flatMap(r=>{
  const keys=r.criteria.map(c=>c.replace('@','_v'));const def=typeof r.config.default==='string'&&keys.includes(r.config.default)?r.config.default:keys[0];
  const base=rankingPath(r.slug);
  return [base,...keys.filter(k=>k!==def).slice(0,12).map(k=>base+'?rank='+encodeURIComponent(k))].map(path=>({path,updatedAt:r.updatedAt||null}));
 });
}

// ───────────── /?ask= links → database pages ─────────────
// {questionKey → path} for questions that name a ranking (its title or slug) or an entity (name or alias).
// Only entities that have a page; a name shared by several of them resolves to the oldest.
export async function resolveNamedTargets(db:Queryable,questions:string[]):Promise<Record<string,string>>{
 const keys=[...new Set(questions.map(questionKey).filter(Boolean))].slice(0,3000);const out:Record<string,string>={};if(!keys.length)return out;
 const rk=await db.query<{slug:string;title:string}>(`select slug, title from rankings where slug is not null and status = any($1::text[]) and (lower(title) = any($2::text[]) or slug = any($2::text[]))`,[PAGE_STATUSES,keys]);
 for(const r of rk.rows)for(const k of [questionKey(r.title),r.slug])if(keys.includes(k)&&!out[k])out[k]=rankingPath(r.slug);
 const rest=keys.filter(k=>!out[k]);if(!rest.length)return out;
 const en=await db.query<{type:string;name:string;aliases:string[]}>(`select e.type, e.name, e.aliases from entities e
  where e.has_page and e.name_keys && ent_keys('', $1::text[]) order by e.created_at limit 5000`,[rest]);
 for(const e of en.rows)for(const n of [e.name,...(e.aliases||[])]){const k=questionKey(n);if(rest.includes(k)&&!out[k])out[k]=entityPath(e.type,e.name);}
 return out;
}

// The entities among ids that have a page (ranking rows link only to these).
export async function withPages(db:Queryable,ids:string[]):Promise<Set<string>>{
 const list=[...new Set(ids.filter(x=>/^[0-9a-f-]{36}$/i.test(x)))];if(!list.length)return new Set();
 return new Set((await db.query<{id:string}>('select id from entities where has_page and id = any($1::uuid[])',[list])).rows.map(r=>String(r.id)));
}

// The home page's showcase: published rankings (whole types first, then sub-scopes, newest first), each
// with its leading criterion, its criteria and its top three (linked when they have a page).
export type FeaturedRanking={slug:string;href:string;title:string;criterion:string;criteria:string[];more:number;
 top:{rank:number;name:string;href:string|null;value:string}[]};
export async function featuredRankings(db:Queryable,limit=12):Promise<FeaturedRanking[]>{
 const defs=(await db.query(`select * from rankings where slug is not null and status='published' and array_length(criteria,1)>0
  order by (coalesce(scope->'filters','{}'::jsonb) = '{}'::jsonb) desc, updated_at desc limit $1::int`,[limit])).rows.map(rankingRow);
 const out:FeaturedRanking[]=[];
 for(const def of defs){
  const lead=String(def.config?.default||def.criteria[0]);const infos=await metricInfos(db,def.criteria.map(c=>c.split('@')[0]));
  const info=infos[lead.split('@')[0]];
  const t=await metricTable(db,{type:def.scope.type,filters:def.scope.filters,metrics:[lead],limit:3}).catch(()=>null);
  const col=t?.metrics[0]?.column;
  const rows=(t?.rows||[]).filter(r=>typeof r.rank==='number').slice(0,3);
  const pages=await withPages(db,rows.map(r=>String(r.entity_id)));
  out.push({slug:def.slug,href:rankingPath(def.slug),title:def.title,criterion:info?.label||lead,
   criteria:def.criteria.slice(0,4).map(c=>infos[c.split('@')[0]]?.label||c),more:Math.max(0,def.criteria.length-4),
   top:rows.map(r=>({rank:Number(r.rank),name:String(r.name),href:pages.has(String(r.entity_id))?entityPath(String(r.type),String(r.name)):null,
    value:info&&col&&typeof r[col]==='number'?formatMetric(info,r[col] as number):col&&r[col]!=null?String(r[col]):''}))});
 }
 return out;
}
