import type {Queryable,Row} from './client';
import {getEntity,metricTable,hybridSearch,inScope,RANK_LIMIT} from './repo';
import {ttlCache} from './ttl-cache';
import {snapshot} from './snapshots';
import {packRows,unpackRows,isPacked,type PackedRows} from '@/app/seo/pack-rows';
import {slugify,questionKey} from '@/app/seo/urls';
import {topicPaths,canonicalPath,type PathMaps} from '@/app/seo/paths';
import {formatMetric,entityImage,entityPath,rankingPath,defaultTemplate,mentionKey,type MetricInfo,type MetricFact,type EntityPageData,type Template,type RankingDef,type RankingPageInput,type Point} from '@/app/seo/assemble';
// Reads for the database-driven pages (/rankings/<slug>, /e/<type>/<slug>), the sitemap and link
// resolution. Read-only; everything a page shows comes from here, assembled by app/seo/assemble.ts.
const iso=(d:unknown)=>d instanceof Date?d.toISOString():d==null?null:String(d);
// Readers see published rankings only: a draft or a held ranking (one the quality gate stopped) is not public. An
// agent previewing its own work (the fresh header) sees its drafts too.
const PAGE_STATUSES=['published'],PREVIEW_STATUSES=['published','draft','held'];
const obj=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};

// ───────────── definitions ─────────────
const rankingRow=(r:Row):RankingDef=>({slug:String(r.slug),title:String(r.title||''),scope:obj(r.scope) as RankingDef['scope'],criteria:(r.criteria as string[])||[],
 config:obj(r.config),status:String(r.status||'draft'),updatedAt:iso(r.updated_at)});
export async function getRankingDefinition(db:Queryable,slug:string,preview=false):Promise<RankingDef|null>{
 const r=await db.query('select slug, title, scope, criteria, config, status, updated_at from rankings where slug = $1::text and status = any($2::text[])',[slug,preview?PREVIEW_STATUSES:PAGE_STATUSES]);
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
 const label=String(r?.label||'')||type.replace(/_/g,' ');
 // The page uses the effective template and schema: everything the type inherits from the types above it, plus its own.
 const {effectiveType}=await import('./inherit');const eff=await effectiveType(db,type).catch(()=>({template:obj(r?.template),schema:obj(r?.schema)}));
 const t=obj(eff.template);
 return {type,label,plural:String(r?.plural||'')||label+'s',description:String(r?.description||''),template:Object.keys(t).length?t as Template:null,schema:obj(eff.schema)};
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
// A ranking page's data: precomputed (page_data, kept current by the worker), built and stored on a first view.
// fresh rebuilds it now (an agent checking its own change).
export async function loadRankingPage(db:Queryable,slug:string,{fresh=false}:{fresh?:boolean}={}):Promise<RankingPageInput|null>{
 // A stored copy outlives a change of status: readers get the page only while the ranking is published.
 if(!fresh&&!(await db.query(`select 1 from rankings where slug=$1::text and status = any($2::text[])`,[slug,PAGE_STATUSES])).rows.length)return null;
 const v=await snapshot<StoredRanking>(db,'ranking',slug,async()=>storedRanking(await buildRankingPage(db,slug,fresh)),v=>String(v.def.scope.type||''),fresh);
 return v?{...v,rows:isPacked(v.rows)?unpackRows(v.rows):v.rows}:null;
}
// Stored with its rows packed (an entity's unchanging fields once, not once per period): a country ranking's
// 14 MB of rows is ~1.5 MB, read and parsed in a fraction of the time.
type StoredRanking=Omit<RankingPageInput,'rows'>&{rows:RankingPageInput['rows']|PackedRows};
export function storedRanking(v:RankingPageInput|null):StoredRanking|null{
 return v?{...v,rows:packRows(v.rows as Record<string,unknown>[],'entity_id',{exact:true})}:null;
}
export async function buildRankingPage(db:Queryable,slug:string,preview=false):Promise<RankingPageInput|null>{
 const def=await getRankingDefinition(db,slug,preview);if(!def)return null;
 const criteria=def.criteria.slice(0,12);
 const type=def.scope.type?await getEntityType(db,def.scope.type):{type:'',label:'entity',plural:'entities',description:'',template:null,schema:{}};
 const defs=await metricInfos(db,criteria.map(c=>c.split('@')[0]));
 const period=typeof def.config.period==='string'&&def.config.period?def.config.period:'all';
 const table=criteria.length?await metricTable(db,{type:def.scope.type,filters:def.scope.filters,metrics:criteria,period}):{metrics:[],rows:[],period};
 const ids=[...new Set(table.rows.map(r=>String(r.entity_id)))];
 const group=typeof def.config.group==='string'?def.config.group:'';
 const entities:RankingPageInput['entities']={};
 if(ids.length){
  const r=await db.query(`select id, case when $2::text <> '' then attributes->>$2::text end as g, coalesce(ids->>'iso3', attributes->>'iso3', attributes->>'code', ids->>'iso2') as code, attributes
   from entities where id = any($1::uuid[])`,[ids,group]);
  // Each member's picture (a flag, a logo, a product photo) becomes its thumbnail in the table.
  for(const x of r.rows)entities[String(x.id)]={group:(x.g as string)||null,code:(x.code as string)||null,image:entityImage({attributes:obj(x.attributes)})};
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
type EntityPageLoad={data:EntityPageData;canonical:boolean;updatedAt:string|null;num:string};
type EntityPageBuilt=Omit<EntityPageLoad,'canonical'>;
// By the entity's permanent number (its page address /e/<num>/<slug>).
export async function loadEntityPageByNum(db:Queryable,num:string,{fresh=false}:{fresh?:boolean}={}):Promise<EntityPageLoad|null>{
 if(!/^\d{1,18}$/.test(num))return null;
 const r=(await db.query<{id:string;type:string}>('select id, type from entities where num = $1::bigint and has_page',[num])).rows[0];
 return r?loadEntityData(db,String(r.id),String(r.type),true,fresh):null;
}
// The ranking tables entity pages show (peers over a type, each sub-ranking the entity is in) are the same for every
// member of a type: computed once and shared for a few minutes, so a page of a large type is not 3 s of table scans.
type MetricTableArgs=Parameters<typeof metricTable>[1];
const typeTables=ttlCache<Awaited<ReturnType<typeof metricTable>>>(5*60_000,3000,24*3600_000);
const sharedTable=(db:Queryable,args:MetricTableArgs)=>typeTables.get(JSON.stringify(args),()=>metricTable(db,args));
// By type and name (the older address form, and lookups by name).
export async function loadEntityPage(db:Queryable,type:string,slug:string,{fresh=false}:{fresh?:boolean}={}):Promise<EntityPageLoad|null>{
 const found=await findEntityBySlug(db,type,slug);if(!found)return null;
 return loadEntityData(db,found.id,type,found.canonical,fresh);
}
// An entity page's data: precomputed (page_data, kept current by the worker), built and stored on a first view.
async function loadEntityData(db:Queryable,id:string,type:string,canonical:boolean,fresh=false):Promise<EntityPageLoad|null>{
 const v=await snapshot<EntityPageBuilt>(db,'entity',id,()=>buildEntityPage(db,id,type),x=>x.data.entity.type,fresh);
 return v?{...v,canonical}:null;
}
export async function buildEntityPage(db:Queryable,id:string,type:string):Promise<EntityPageBuilt|null>{
 const found={id};
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
 // The table is over the template's peer metrics (the same for every member, so it is shared), not the ones this entity has.
 const allPeer=templateMetrics(tpl).peer.slice(0,12),peerKeys=allPeer.filter(k=>metrics[k]);
 if(peerKeys.length){
  const t=await sharedTable(db,{type,metrics:allPeer,period:'latest'}).catch(()=>sharedTable(db,{type,metrics:peerKeys,period:'latest'}));
  // Peers link to their pages (by number); one without a page is named only.
  const nums=await withPages(db,t.rows.map(r=>String(r.entity_id)));
  for(const m of t.metrics.filter(m=>metrics[m.key]))data.peers[m.key]=t.rows.filter(r=>typeof r[m.column]==='number'&&Number(r[m.column+'_rank'])<=RANK_LIMIT).map(r=>({name:String(r.name),value:Number(r[m.column]),
   ...(nums.has(String(r.entity_id))?{type:String(r.type),num:nums.get(String(r.entity_id))}:{})}));
 }
 data.rankings=await entityRankings(db,data,metrics);
 // Links: related entities by their id (exact, even when names are shared), attribute values by name or alias.
 data.entityLinks=await resolveEntityIds(db,[...relations.outgoing.map(r=>r.id),...relations.incoming.flatMap(g=>g.sample.map(x=>x.id))],e.id);
 data.links=await resolveMentions(db,Object.values(e.attributes||{}).filter((v):v is string=>typeof v==='string'&&v.length>1&&v.length<=80&&!/^https?:/i.test(v)),e.id);
 const num=String((await db.query<{num:string}>('select num from entities where id = $1::uuid',[e.id])).rows[0]?.num??'');
 return {data,updatedAt:iso(snap?.updated_at),num};
}
// {entity id → page path} for the related entities that have a page (their type has a template).
export async function resolveEntityIds(db:Queryable,ids:string[],selfId?:string):Promise<Record<string,string>>{
 const list=[...new Set(ids.filter(x=>/^[0-9a-f-]{36}$/i.test(x)&&x!==selfId))].slice(0,800);if(!list.length)return {};
 const r=await db.query<{id:string;type:string;name:string;num:string}>(`select e.id,e.type,e.name,e.num from entities e where e.has_page and e.id = any($1::uuid[])`,[list]);
 return Object.fromEntries(r.rows.map(x=>[String(x.id),entityPath(x.type,x.name,x.num)]));
}
// {mentionKey(name) → page path} for the names that have an entity page (a type with a template), the page
// itself excluded; an exact name wins over an alias. Resolved at render time, so links stay two-way: a new page
// is linked from every page that mentions it the next time those pages are rendered.
export async function resolveMentions(db:Queryable,names:string[],selfId?:string):Promise<Record<string,string>>{
 const list=[...new Set(names.map(n=>String(n||'').trim()).filter(n=>n&&n.length<=120))].slice(0,400);if(!list.length)return {};
 const r=await db.query<{k:string;type:string;name:string;num:string}>(`select distinct on (n.k) n.k, e.type, e.name, e.num from unnest($1::text[]) n(k)
  join entities e on e.has_page and e.name_keys && ent_keys(n.k,'{}'::text[])
  where ($2::uuid is null or e.id <> $2::uuid) order by n.k, (ent_norm(e.name)=ent_norm(n.k)) desc, e.created_at`,[list,selfId||null]);
 return Object.fromEntries(r.rows.map(x=>[mentionKey(x.k),entityPath(x.type,x.name,x.num)]));
}
// Every ranking definition whose scope contains the entity, with its rank on each criterion.
async function entityRankings(db:Queryable,d:EntityPageData,metrics:Record<string,MetricFact>){
 // Whole-type rankings first (cards link to them), then sub-rankings.
 const nf=(r:RankingDef)=>Object.keys(r.scope.filters||{}).length?1:0;
 // The rankings of its own type, then those of every type it extends (a gaming laptop also ranks among laptops).
 const {typeChain}=await import('./inherit');const chain=(await typeChain(db,d.entity.type)).map(t=>t.type);
 const own=(await listRankingDefinitions(db,{type:d.entity.type})).sort((a,b)=>nf(a)-nf(b));
 const inherited:RankingDef[]=[];for(const t of chain.slice(1))inherited.push(...(await listRankingDefinitions(db,{type:t})).sort((a,b)=>nf(a)-nf(b)));
 const defs=[...own,...inherited].slice(0,24);const ancestor=new Set(chain.slice(1));
 const labels=await metricInfos(db,defs.flatMap(r=>r.criteria.map(c=>c.split('@')[0])));
 const out:EntityPageData['rankings']=[];
 for(const r of defs){
  const crit=r.criteria.slice(0,12);if(!crit.length)continue;
  const label=(c:string)=>labels[c.split('@')[0]]?.label||c;
  // A ranking of an ancestor type ranks the entity among all its members (computed like a narrower set).
  if(!Object.keys(r.scope.filters||{}).length&&!ancestor.has(String(r.scope.type||''))){
   out.push({slug:r.slug,title:r.title,filters:{},ranks:crit.map(c=>{const f=metrics[c.replace(/@\d+$/,'')];return {key:c.replace('@','_v'),label:label(c),rank:f?.rank??null,of:f?.of??null};})});
   continue;
  }
  try{
   // Only the sub-rankings the entity is in (a membership query, not a table per scope).
   if(!await inScope(db,{type:r.scope.type,filters:r.scope.filters},d.entity.id))continue;
   const t=await sharedTable(db,{type:r.scope.type,filters:r.scope.filters,metrics:crit,period:'latest'});
   const row=t.rows.find(x=>x.entity_id===d.entity.id);
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
 const r=await db.query<{type:string;name:string;num:string;updated_at:unknown}>(`select e.type, e.name, e.num, e.updated_at from entities e where e.has_page and e.type in (${LISTED_TYPES})
  order by e.type, e.created_at, e.id limit $2::int offset $3::int`,[LISTED,size,part*size]);
 return r.rows.map(x=>({path:entityPath(x.type,x.name,x.num),updatedAt:iso(x.updated_at)}));
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
 const en=await db.query<{type:string;name:string;num:string;aliases:string[]}>(`select e.type, e.name, e.num, e.aliases from entities e
  where e.has_page and e.name_keys && ent_keys('', $1::text[]) order by e.created_at limit 5000`,[rest]);
 for(const e of en.rows)for(const n of [e.name,...(e.aliases||[])]){const k=questionKey(n);if(rest.includes(k)&&!out[k])out[k]=entityPath(e.type,e.name,e.num);}
 return out;
}

// The entities among ids that have a page (ranking rows link only to these).
export async function withPages(db:Queryable,ids:string[]):Promise<Map<string,string>>{
 const list=[...new Set(ids.filter(x=>/^[0-9a-f-]{36}$/i.test(x)))];if(!list.length)return new Map();
 return new Map((await db.query<{id:string;num:string}>('select id, num from entities where has_page and id = any($1::uuid[])',[list])).rows.map(r=>[String(r.id),String(r.num)]));
}

// The home page's showcase: published rankings (whole types first, then sub-scopes, newest first), each
// with its leading criterion, its criteria and its top three (linked when they have a page).
export type FeaturedRanking={slug:string;href:string;title:string;criterion:string;criteria:string[];more:number;
 top:{rank:number;name:string;href:string|null;value:string}[]};
export async function featuredRankings(db:Queryable,limit=12,topicIds?:string[]):Promise<FeaturedRanking[]>{
 const defs=(await db.query(`select * from rankings where slug is not null and status='published' and array_length(criteria,1)>0
  and ($2::uuid[] is null or topic_id = any($2::uuid[]))
  order by (coalesce(scope->'filters','{}'::jsonb) = '{}'::jsonb) desc, updated_at desc limit $1::int`,[limit,topicIds??null])).rows.map(rankingRow);
 return rankingCards(db,defs);
}
// A card per ranking: its leading criterion, its criteria and its top three (linked when they have a page).
async function rankingCards(db:Queryable,defs:RankingDef[]):Promise<FeaturedRanking[]>{
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
   top:rows.map(r=>({rank:Number(r.rank),name:String(r.name),href:pages.has(String(r.entity_id))?entityPath(String(r.type),String(r.name),pages.get(String(r.entity_id))):null,
    value:info&&col&&typeof r[col]==='number'?formatMetric(info,r[col] as number):col&&r[col]!=null?String(r[col]):''}))});
 }
 return out;
}

// ───────────── topic navigation ─────────────
// The topic tree as readers browse it: each topic with what it and its descendants publish. Topics with nothing
// published anywhere below them are left out, so every tile leads somewhere.
export type TopicNode={id:string;parentId:string|null;slug:string;name:string;description:string;rankings:number;types:number;pages:number;href:string};
export type TopicNav={topic:TopicNode|null;trail:TopicNode[];children:(TopicNode&{sub:{slug:string;name:string;href:string}[]})[];
 rankings:FeaturedRanking[];types:{type:string;label:string;plural:string;pages:number;href:string|null}[];
 build?:TopicBuild|null};
// Where a topic's team stands while its pages are being built (shown on the topic's page until it has rankings).
export type TopicBuild={status:'queued'|'running'|'done'|'failed'|'none';ahead:number;entities:number;sources:number;startedAt:string|null};
export const topicPath=(slug:string)=>'/topics/'+encodeURIComponent(slug);
let treeCache:{at:number;nodes:Promise<TopicNode[]>;ok?:boolean;refreshing?:boolean}|null=null;
// The whole tree with its counts (the manager, sitemaps): topics joined to topic_stats, kept for five minutes and
// refreshed in the background (the stale tree is served meanwhile). Pages never load it: see loadTopicNav.
export function topicTree(db:Queryable):Promise<TopicNode[]>{
 const age=treeCache?Date.now()-treeCache.at:Infinity;
 if(treeCache&&age<5*60_000)return treeCache.nodes;
 if(treeCache?.ok){const c=treeCache;if(!c.refreshing){c.refreshing=true;const next=topicTreeUncached(db);
  next.then(()=>{treeCache={at:Date.now(),nodes:next,ok:true};},()=>{c.refreshing=false;});}return c.nodes;}
 const nodes=topicTreeUncached(db);const entry={at:Date.now(),nodes,ok:false};treeCache=entry;
 nodes.then(()=>{entry.ok=true;},()=>{if(treeCache===entry)treeCache=null;});return nodes;
}
const NODE_COLS=`t.id, t.parent_id, t.slug, t.name, t.description, coalesce(s.rankings,0)::int rankings, coalesce(s.types,0)::int types, coalesce(s.pages,0)::int pages`;
const nodeOf=(x:Row):TopicNode=>({id:String(x.id),parentId:x.parent_id?String(x.parent_id):null,slug:String(x.slug),name:String(x.name),description:String(x.description||''),
 rankings:Number(x.rankings||0),types:Number(x.types||0),pages:Number(x.pages||0),href:topicPath(String(x.slug))});
async function topicTreeUncached(db:Queryable):Promise<TopicNode[]>{
 if(!(await db.query('select 1 from topic_stats limit 1')).rows.length)await refreshTopicStats(db);
 const r=await db.query(`select ${NODE_COLS} from topics t left join topic_stats s on s.id = t.id where t.status <> 'archived' order by t.name`);
 return r.rows.map(nodeOf);
}
// Counts every topic's published rankings, entity types and entity pages over its whole subtree (one pass over the
// tree) into topic_stats. Run by the worker every few minutes, never on a reader's request.
export async function refreshTopicStats(db:Queryable):Promise<number>{
 const r=await db.query(`with recursive t as (select id, parent_id from topics where status <> 'archived'),
  sub(root, id) as (select id, id from t union all select s.root, t.id from sub s join t on t.parent_id = s.id),
  pages as (select type, count(*)::int n from entities where has_page group by type),
  rk as (select topic_id id, count(*)::int n from rankings where status = 'published' and slug is not null group by topic_id),
  ty as (select et.topic_id id, count(*)::int n, coalesce(sum(p.n),0)::int pg from entity_types et left join pages p on p.type = et.type where et.status = 'published' group by et.topic_id),
  agg as (select sub.root id, coalesce(sum(rk.n),0)::int rankings, coalesce(sum(ty.n),0)::int types, coalesce(sum(ty.pg),0)::int pages
   from sub left join rk on rk.id = sub.id left join ty on ty.id = sub.id group by sub.root)
  insert into topic_stats(id, rankings, types, pages, updated_at) select id, rankings, types, pages, now() from agg
  on conflict (id) do update set rankings = excluded.rankings, types = excluded.types, pages = excluded.pages, updated_at = now() returning 1`);
 await db.query("delete from topic_stats s where not exists (select 1 from topics t where t.id = s.id and t.status <> 'archived')");
 return r.rows.length;
}
// One topic's page: the topic, its ancestors, its children (each with up to six of its own) — only these rows are
// read, never the whole tree.
export async function loadTopicNav(db:Queryable,slug:string|null,{rankings:withRankings=true}:{rankings?:boolean}={}):Promise<TopicNav|null>{
 const topic=slug?(await db.query(`select ${NODE_COLS} from topics t left join topic_stats s on s.id = t.id where t.slug = $1::text and t.status <> 'archived'`,[slug])).rows.map(nodeOf)[0]??null:null;
 if(slug&&!topic)return null;
 const trail=topic?.parentId?(await db.query(`with recursive up(id, depth) as (select $1::uuid, 1 union all select t.parent_id, up.depth + 1 from up join topics t on t.id = up.id where t.parent_id is not null and up.depth < 12)
  select ${NODE_COLS}, up.depth from up join topics t on t.id = up.id left join topic_stats s on s.id = t.id order by up.depth desc`,[topic.parentId])).rows.map(nodeOf):[];
 const kidRows=(await db.query(topic?`select ${NODE_COLS} from topics t left join topic_stats s on s.id = t.id where t.parent_id = $1::uuid and t.status <> 'archived' order by t.name`
  :`select ${NODE_COLS} from topics t left join topic_stats s on s.id = t.id where t.parent_id is null and t.status <> 'archived' order by t.name`,topic?[topic.id]:[])).rows.map(nodeOf);
 const grand=kidRows.length?(await db.query(`select slug, name, parent_id from (select t.slug, t.name, t.parent_id, row_number() over (partition by t.parent_id order by t.name) n
  from topics t where t.parent_id = any($1::uuid[]) and t.status <> 'archived') x where n <= 6`,[kidRows.map(k=>k.id)])).rows:[];
 const children=kidRows.map(c=>({...c,sub:grand.filter(g=>String(g.parent_id)===c.id).map(g=>({slug:String(g.slug),name:String(g.name),href:topicPath(String(g.slug))}))}));
 if(!topic)return {topic:null,trail:[],children,rankings:[],types:[]};
 // A topic lists its own rankings in full; with subtopics, the leading rankings of the whole branch.
 let rankings:FeaturedRanking[]=[];
 if(withRankings){
  const subtree=children.length?(await db.query(`with recursive d(id) as (select $1::uuid union all select t.id from topics t join d on t.parent_id = d.id where t.status <> 'archived') select id from d`,[topic.id])).rows.map(x=>String(x.id)):[topic.id];
  rankings=await featuredRankings(db,children.length?12:120,subtree);
 }
 const tr=await db.query(`select et.type, et.label, et.plural, (select count(*)::int from entities e where e.type = et.type and e.has_page) n,
   (select r.slug from rankings r where r.status = 'published' and r.slug is not null and r.scope->>'type' = et.type order by (coalesce(r.scope->'filters','{}'::jsonb) = '{}'::jsonb) desc, r.updated_at desc limit 1) rk
  from entity_types et where et.topic_id = $1::uuid and et.status = 'published' order by et.label`,[topic.id]);
 const build=topic.rankings===0?await topicBuild(db,topic).catch(()=>null):null;
 return {topic,trail,children,rankings,build,types:tr.rows.map(x=>({type:String(x.type),label:String(x.label||x.type),plural:String(x.plural||x.label||x.type),pages:Number(x.n),href:x.rk?rankingPath(String(x.rk)):null}))};
}

async function topicBuild(db:Queryable,topic:TopicNode):Promise<TopicBuild>{
 const q=(await db.query<{status:string;priority:number;created_at:unknown;started_at:unknown}>('select status, priority, created_at, started_at from team_queue where slug=$1::text',[topic.slug])).rows[0];
 const ahead=q?.status==='queued'?Number((await db.query<{n:number}>(`select count(*)::int n from team_queue where status='queued' and (priority > $1::int or (priority = $1::int and created_at < $2::timestamptz))`,[q.priority,q.created_at])).rows[0]?.n||0):0;
 const entities=Number((await db.query<{n:number}>('select count(*)::int n from entities where topic_id=$1::uuid or type in (select type from entity_types where topic_id=$1::uuid)',[topic.id])).rows[0]?.n||0);
 const sources=Number((await db.query<{n:number}>('select count(*)::int n from sources where topic_id=$1::uuid',[topic.id])).rows[0]?.n||0);
 return {status:(q?.status as TopicBuild['status'])||'none',ahead,entities,sources,startedAt:q?.started_at?new Date(String(q.started_at)).toISOString():null};
}

// ───────────── the address tree ─────────────
// Every topic and every ranking is a node of one tree of sets, addressed top level down (app/seo/paths.ts):
// a topic's main ranking (its entity type, unfiltered) is the topic's own page; a narrower ranking is a node
// under the set it narrows (the ranking whose filters its own include, most specific first), named by the
// values it adds ("/geography/countries/europe-central-asia"); subsets may overlap and may be narrowed again.
// A topic without a main ranking (a broad subject over several kinds of entity) is a directory of its children.
// Read at most once a minute: a node moved in the tree moves its pages within a minute.
type NodeInfo={path:string;kind:'topic'|'ranking';slug:string;name:string;description:string;parent:string|null;live?:boolean};
export type AddressTree=PathMaps&{nodes:Map<string,NodeInfo>;children:Map<string,string[]>;mainOf:Map<string,string>};
let mapsCache:{at:number;maps:AddressTree}|null=null;
const filterEntries=(f:unknown):[string,string][]=>Object.entries(f&&typeof f==='object'?f as Record<string,unknown>:{})
 .map(([k,v])=>[k,typeof v==='string'||typeof v==='number'?String(v):Array.isArray(v)?v.map(String).sort().join(','):JSON.stringify(v)] as [string,string]).sort();
const segmentOf=(extra:[string,string][])=>slugify(extra.map(([k,v])=>/^[{[]/.test(v)?k+' '+v.replace(/[^\p{L}\p{N}.]+/gu,' '):v).join(' ')).replace(/-and-/g,'-');
// The address map is held in memory (every request needs it to resolve its path) and rebuilt in the background
// once a minute: readers are served the current map while the next one is built.
let mapsLoading:Promise<AddressTree>|null=null;
export async function pathMaps(db:Queryable,{fresh=false}:{fresh?:boolean}={}):Promise<AddressTree>{
 if(!fresh&&mapsCache){
  if(Date.now()-mapsCache.at>=60_000&&!mapsLoading){mapsLoading=buildPathMaps(db).catch(e=>{console.warn('[paths] rebuild failed',(e as Error).message);return mapsCache!.maps;}).finally(()=>{mapsLoading=null;});}
  return mapsCache.maps;
 }
 if(!fresh&&mapsLoading)return mapsLoading;
 const p=buildPathMaps(db);if(!fresh){mapsLoading=p;p.finally(()=>{mapsLoading=null;}).catch(()=>{});}
 return p;
}
async function buildPathMaps(db:Queryable):Promise<AddressTree>{
 const topics=(await db.query<{id:string;parent_id:string|null;slug:string;name:string;description:string}>("select id, parent_id, slug, name, description from topics where status <> 'archived'")).rows
  .map(t=>({id:String(t.id),parentId:t.parent_id?String(t.parent_id):null,slug:String(t.slug),name:String(t.name),description:String(t.description||'')}));
 const paths=topicPaths(topics);const topicById=new Map(topics.map(t=>[t.id,t]));
 const nodes=new Map<string,NodeInfo>(),children=new Map<string,string[]>(),rankings=new Map<string,string>(),mainOf=new Map<string,string>();
 const add=(n:NodeInfo)=>{nodes.set(n.path,n);if(n.parent){const c=children.get(n.parent)??[];c.push(n.path);children.set(n.parent,c);}};
 for(const t of topics){const path=paths.get(t.slug)!;const parent=t.parentId&&topicById.has(t.parentId)?paths.get(topicById.get(t.parentId)!.slug)!:null;add({path,kind:'topic',slug:t.slug,name:t.name,description:t.description,parent});}
 const rows=(await db.query<{slug:string;title:string;topic_id:string|null;scope:Row;config:Row}>('select slug, title, topic_id, scope, config from rankings where slug is not null and topic_id is not null and status = any($1::text[]) order by updated_at desc',[PAGE_STATUSES])).rows;
 const byTopic=new Map<string,{slug:string;title:string;type:string;filters:[string,string][];main:boolean}[]>();
 for(const r of rows){const sc=obj(r.scope);const list=byTopic.get(String(r.topic_id))??[];list.push({slug:String(r.slug),title:String(r.title||r.slug),type:String(sc.type||''),filters:filterEntries(sc.filters),main:obj(r.config).main===true});byTopic.set(String(r.topic_id),list);}
 for(const [topicId,list] of byTopic){
  const t=topicById.get(topicId);if(!t)continue;const tp=paths.get(t.slug)!;
  // The topic's main ranking: unfiltered, of the topic's one kind of entity (the newest when there are several).
  // A ranking marked main (config.main) is the topic's page; other unfiltered rankings (by theme) sit under it.
  const whole=list.filter(r=>!r.filters.length).sort((a,b)=>Number(b.main)-Number(a.main));const kinds=new Set(list.map(r=>r.type));
  const main=kinds.size===1?whole[0]:undefined;
  const placed=new Map<string,string>();// slug → path
  if(main){placed.set(main.slug,tp);rankings.set(main.slug,tp);mainOf.set(tp,main.slug);const n=nodes.get(tp)!;nodes.set(tp,{...n,kind:'ranking',slug:main.slug});}
  // Narrower sets after wider ones, each under the most specific set it narrows.
  for(const r of [...list].filter(r=>r!==main).sort((a,b)=>a.filters.length-b.filters.length)){
   const has=(f:[string,string][],x:[string,string])=>f.some(y=>y[0]===x[0]&&y[1]===x[1]);
   const parents=list.filter(q=>q!==r&&placed.has(q.slug)&&q.type===r.type&&q.filters.length<r.filters.length&&q.filters.every(x=>has(r.filters,x)));
   const parent=parents.sort((a,b)=>b.filters.length-a.filters.length)[0];
   const base=parent?placed.get(parent.slug)!:tp;
   const extra=r.filters.filter(x=>!parent||!has(parent.filters,x));
   let seg=extra.length?segmentOf(extra):slugify(r.slug);if(!seg||seg==='page')seg=slugify(r.slug);
   let path=base+'/'+encodeURIComponent(seg);for(let i=2;nodes.has(path);i++)path=base+'/'+encodeURIComponent(seg+'-'+i);
   placed.set(r.slug,path);rankings.set(r.slug,path);add({path,kind:'ranking',slug:r.slug,name:r.title,description:'',parent:base});
  }
 }
 // A node is live when it is a ranking or has one below it; the others (no data yet) are not listed.
 for(const n of nodes.values())if(n.kind==='ranking')for(let p:string|null=n.path;p&&!nodes.get(p)!.live;p=nodes.get(p)!.parent)nodes.get(p)!.live=true;
 const roots=[...nodes.values()].filter(n=>!n.parent).map(n=>n.path);children.set('',roots);
 const maps={topics:paths,rankings,types:new Map<string,string>(),nodes,children,mainOf};mapsCache={at:Date.now(),maps};return maps;
}
export type ResolvedPath={kind:'topic';slug:string}|{kind:'ranking';slug:string}|{kind:'redirect';to:string};
// An address in the tree → its page. An address that no longer matches (a node moved, an older form) redirects
// when its last segment names a topic or a ranking.
export async function resolvePath(db:Queryable,segments:string[]):Promise<ResolvedPath|null>{
 const segs=segments.map(s=>{try{return decodeURIComponent(s);}catch{return s;}}).filter(Boolean);if(!segs.length||segs.length>16)return null;
 const maps=await pathMaps(db);
 const here='/'+segs.map(encodeURIComponent).join('/');
 const node=maps.nodes.get(here);
 if(node)return node.kind==='ranking'?{kind:'ranking',slug:node.slug}:{kind:'topic',slug:node.slug};
 const last=segs[segs.length-1];
 const to=maps.topics.get(last)??maps.rankings.get(last)??null;
 return to&&to!==here?{kind:'redirect',to}:null;
}
// The way to a node (its ancestors, top first) and its children, for breadcrumbs and browsing.
export function nodeTrail(maps:AddressTree,path:string):{name:string;href:string}[]{
 const out:{name:string;href:string}[]=[];
 for(let p=maps.nodes.get(path)?.parent;p&&out.length<16;p=maps.nodes.get(p)?.parent){const n=maps.nodes.get(p);if(!n)break;out.unshift({name:n.name,href:n.path});}
 return out;
}
// A node's direct children that have something published ('' is the root: the top-level nodes).
// Every child is listed (the whole tree is browsable from the start); those with published rankings come first, the
// others are marked as being built.
const INTERNAL_TOPIC='general';
export type NodeCard={name:string;href:string;kind:'topic'|'ranking';description:string;more:number;live:boolean};
export function nodeChildren(maps:AddressTree,path:string):NodeCard[]{
 const live=(p:string)=>!!maps.nodes.get(p)?.live;
 // The manager's catch-all inbox topic ("general") is internal, not a place to browse.
 return (maps.children.get(path)??[]).map(p=>maps.nodes.get(p)!).filter(n=>!(n.kind==='topic'&&n.slug===INTERNAL_TOPIC))
  .map(n=>({name:n.name,href:n.path,kind:n.kind,description:n.description,more:(maps.children.get(n.path)??[]).length,live:live(n.path)}))
  .sort((a,b)=>Number(b.live)-Number(a.live)||b.more-a.more||a.name.localeCompare(b.name));
}

// ───────────── popularity ─────────────
// One reader view of a ranking page (browsers only, once per page per session).
export async function recordRankingView(db:Queryable,slug:string):Promise<boolean>{
 if(!/^[a-z0-9][a-z0-9-]{0,120}$/.test(slug))return false;
 const r=await db.query(`insert into ranking_views(slug, day, n) select slug, current_date, 1 from rankings where slug = $1::text and status = any($2::text[])
  on conflict (slug, day) do update set n = ranking_views.n + 1 returning n`,[slug,PAGE_STATUSES]);
 return r.rows.length>0;
}
// The most viewed rankings in a node's subtree over the last 30 days (newest first while views are few), as cards.
const popularCache=new Map<string,{at:number;cards:FeaturedRanking[]}>();
export async function popularRankings(db:Queryable,maps:AddressTree,path:string,limit=6):Promise<FeaturedRanking[]>{
 const hit=popularCache.get(path);if(hit&&Date.now()-hit.at<5*60_000)return hit.cards;
 const own=maps.nodes.get(path);const slugs:string[]=[];
 const walk=(p:string)=>{for(const c of maps.children.get(p)??[]){const n=maps.nodes.get(c);if(!n?.live)continue;if(n.kind==='ranking')slugs.push(n.slug);walk(c);}};
 walk(path);
 const list=[...new Set(slugs)].filter(x=>x!==(own?.kind==='ranking'?own.slug:''));
 if(!list.length){popularCache.set(path,{at:Date.now(),cards:[]});return [];}
 const defs=(await db.query(`select r.* from rankings r left join (select slug, sum(n) v from ranking_views where day > current_date - 30 group by slug) w on w.slug = r.slug
  where r.slug = any($1::text[]) and r.status = 'published' and array_length(r.criteria,1) > 0 order by coalesce(w.v,0) desc, r.updated_at desc limit $2::int`,[list,limit])).rows.map(rankingRow);
 const cards=await rankingCards(db,defs);
 if(popularCache.size>5000)popularCache.clear();
 popularCache.set(path,{at:Date.now(),cards});return cards;
}

// ───────────── search ─────────────
// Readers find pages by searching, as on any encyclopedia: suggestions while they type (names only: the
// address tree in memory and the entity name index; no model), and on Enter a results page that adds meaning
// (the query's embedding against the vectors already prepared for every ranking view and entity).
export type SearchHit={kind:'topic'|'ranking'|'view'|'entity';title:string;subtitle:string;href:string;score:number};
type IndexEntry=SearchHit&{key:string;words:string[]};
const norm=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/[‘’'"“”`]/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
let indexCache:{at:number;entries:IndexEntry[]}|null=null;
async function searchIndex(db:Queryable):Promise<IndexEntry[]>{
 if(indexCache&&Date.now()-indexCache.at<60_000)return indexCache.entries;
 const maps=await pathMaps(db);const out:IndexEntry[]=[];
 const push=(e:SearchHit)=>{const key=norm(e.title);out.push({...e,key,words:key.split(' ')});};
 for(const n of maps.nodes.values()){
  // A topic still being built is findable too (its page says where its team stands); rankings only once published.
  if(n.kind==='topic'){push({kind:'topic',title:n.name,subtitle:n.live?'Topic':'Topic · being built',href:n.path,score:0});continue;}
  if(!n.live)continue;
  push({kind:'ranking',title:n.name,subtitle:'Ranking',href:n.path,score:0});}
 // A main ranking is also found by its own title ("Country Rankings" as well as "Countries").
 const rk=(await db.query<{slug:string;title:string;criteria:string[];config:Row}>("select slug, title, criteria, config from rankings where slug is not null and status = 'published'")).rows;
 const labels=await metricInfos(db,[...new Set(rk.flatMap(r=>(r.criteria||[]).map(c=>c.split('@')[0])))]);
 for(const r of rk){const path=maps.rankings.get(String(r.slug));if(!path)continue;
  const node=maps.nodes.get(path);if(node&&node.name!==r.title)push({kind:'ranking',title:String(r.title),subtitle:'Ranking',href:path,score:0});
  const def=String(obj(r.config).default||r.criteria?.[0]||'');
  // Every other criterion is a view of its own ("Country Rankings by GDP").
  for(const c of r.criteria||[]){if(c===def)continue;const label=labels[c.split('@')[0]]?.label||c;
   push({kind:'view',title:`${r.title} by ${label}`,subtitle:'Ranking',href:path+'?rank='+encodeURIComponent(c),score:0});}}
 indexCache={at:Date.now(),entries:out};return out;
}
// How well a title matches the typed text: 0 exact, 1 starts with it, 2 every typed word starts a word, 3 contains.
function matchScore(e:IndexEntry,q:string,qw:string[]):number{
 if(e.key===q)return 0;if(e.key.startsWith(q))return 1;
 if(qw.length&&qw.every(w=>e.words.some(x=>x.startsWith(w))))return 2;
 return e.key.includes(q)?3:-1;
}
async function entityMatches(db:Queryable,q:string,limit:number):Promise<SearchHit[]>{
 const w=norm(q).split(' ').filter(Boolean).slice(0,8);if(!w.length)return [];
 const r=await db.query<{type:string;name:string;num:string;label:string}>(`select e.type, e.name, e.num, coalesce(t.label, e.type) as label from entities e
  join entity_types t on t.type = e.type and t.status = 'published'
  where e.has_page and e.tsv @@ to_tsquery('simple', $1::text)
  order by (lower(e.name) = $2::text) desc, (lower(e.name) like $3::text) desc, length(e.name), e.name limit $4::int`,
  [w.map(x=>x.replace(/[^\p{L}\p{N}]/gu,'')+':*AB').filter(x=>x!==':*AB').join(' & '),norm(q),norm(q).replace(/[\\%_]/g,m=>'\\'+m)+'%',limit]);
 const nq=norm(q);
 return r.rows.map(x=>{const n=norm(x.name);return {kind:'entity' as const,title:x.name,subtitle:x.label.charAt(0).toUpperCase()+x.label.slice(1),href:entityPath(x.type,x.name,x.num),score:n===nq?0:n.startsWith(nq)?1:2};});
}
export async function suggest(db:Queryable,query:string,limit=8):Promise<SearchHit[]>{
 const q=norm(query).slice(0,100);if(!q)return [];const qw=q.split(' ');
 const nodes=(await searchIndex(db)).map(e=>({e,s:matchScore(e,q,qw)})).filter(x=>x.s>=0)
  .sort((a,b)=>a.s-b.s||(a.e.kind==='view'?1:0)-(b.e.kind==='view'?1:0)||a.e.title.length-b.e.title.length).slice(0,limit)
  .map(({e,s})=>({kind:e.kind,title:e.title,subtitle:e.subtitle,href:e.href,score:s}));
 const ents=await entityMatches(db,query,limit).catch(()=>[]);
 const seen=new Set<string>();
 return [...nodes,...ents].sort((a,b)=>a.score-b.score).filter(h=>!seen.has(h.href)&&!!seen.add(h.href)).slice(0,limit);
}
// The results page: name matches first, then pages close in meaning (rankings by their prepared view vectors,
// entities by hybrid search), each list without duplicates.
export async function searchPages(db:Queryable,query:string,{embed}:{embed?:((t:string[])=>Promise<number[][]>)|null}={}):Promise<{nodes:SearchHit[];entities:SearchHit[]}>{
 const q=norm(query).slice(0,200);if(!q)return {nodes:[],entities:[]};const qw=q.split(' ');
 const nodes=(await searchIndex(db)).map(e=>({e,s:matchScore(e,q,qw)})).filter(x=>x.s>=0).sort((a,b)=>a.s-b.s||a.e.title.length-b.e.title.length)
  .slice(0,20).map(({e,s})=>({kind:e.kind,title:e.title,subtitle:e.subtitle,href:e.href,score:s}));
 if(embed){try{
  const {storedEmbedDim}=await import('./schema');const dim=await storedEmbedDim(db);const v=(await embed([query]))[0];
  if(v?.length===dim){const maps=await pathMaps(db);
   const near=(await db.query<{slug:string;title:string;criterion:string;d:number}>(`select r.slug, r.title, x.criterion, x.d from (select ranking_id, criterion, embedding <=> $1::vector as d from ranking_vectors order by embedding <=> $1::vector limit 30) x
    join rankings r on r.id = x.ranking_id where r.status = 'published' and x.d < 0.55 order by x.d`,['['+v.join(',')+']'])).rows;
   for(const r of near){const path=maps.rankings.get(String(r.slug));if(!path)continue;
    const href=r.criterion?path+'?rank='+encodeURIComponent(r.criterion):path;
    if(!nodes.some(n=>n.href===href||n.href===path))nodes.push({kind:'ranking',title:String(r.title),subtitle:'Ranking',href:path,score:4+Number(r.d)});}
  }}catch(e){console.warn('search: semantic step skipped',(e as Error).message);}}
 const entities:SearchHit[]=await entityMatches(db,query,20).catch(()=>[]);
 // Meaning adds entities only where words or names also match — or, when nothing matches by name, the closest
 // few (a near vector alone says "same kind of thing", not "what was asked for").
 if(embed&&entities.length<20){
  const hits=(await hybridSearch(db,{query,limit:20}).catch(()=>({results:[]}))).results
   .filter(h=>entities.length?h.matchedBy.some(b=>b!=='vector'):true).slice(0,entities.length?20:5);
  const ids=await withPages(db,hits.map(h=>h.id));
  const types=new Map((await db.query<{type:string;label:string}>('select type, label from entity_types')).rows.map(r=>[String(r.type),String(r.label||r.type)]));
  for(const h of hits){const num=ids.get(h.id);if(!num)continue;const href=entityPath(h.type,h.name,num);const label=types.get(h.type)??h.type.replace(/_/g,' ');
   if(!entities.some(x=>x.href===href))entities.push({kind:'entity',title:h.name,subtitle:label.charAt(0).toUpperCase()+label.slice(1),href,score:5});}
 }
 return {nodes:nodes.slice(0,24),entities:entities.slice(0,24)};
}
// One search from the results page (suggestions are not logged): the query, its language and how many pages
// answered it.
export async function logSearch(db:Queryable,query:string,locale:string,results:number):Promise<void>{
 const q=query.trim().slice(0,300);if(!q)return;
 await db.query('insert into search_log(query, norm, locale, results) values ($1::text, $2::text, $3::text, $4::int)',[q,norm(q),locale.slice(0,8),results]);
}
// One reader view of any page (browsers only, once per page per session), by its address without the language.
const VIEW_KINDS=new Set(['ranking','entity','topic','search','home']);
export async function recordPageView(db:Queryable,kind:string,path:string):Promise<boolean>{
 if(!VIEW_KINDS.has(kind)||!/^\/[^\s]{0,299}$/.test(path))return false;
 await db.query('insert into page_views(kind, key, day, n) values ($1::text, $2::text, current_date, 1) on conflict (kind, key, day) do update set n = page_views.n + 1',[kind,path]);
 return true;
}
