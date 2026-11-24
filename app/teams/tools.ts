import type {AgentContext} from '@/app/components-registry/registry';
import {entityDb} from '@/app/entity-db/client';
import {entityTools,entityToolNames,runEntityTool} from '@/app/entity-db/tools';
import {listMetrics,normalizeType,retractObservations,createEditor,addRoadmapItem,listRoadmap,updateRoadmapItem,listInbox,triageInbox,type RoadmapKind} from '@/app/entity-db/repo';
import type {Queryable} from '@/app/entity-db/client';
import {dataTools,runDataTool} from '@/app/data-tools';
import {publicSourceTools,listPublicSources,callPublicSource} from '@/app/public-data/service';
import {siteUrl} from '@/app/site';
import {saveEntityType,getEntityType,listEntityTypes,saveRankingDef,listRankingDefs,saveRecipe,getRecipe,listRecipes,topicBrief,recordDecision,setTopicBrief} from './config';
import {runRecipe,parseSteps,checkRecipe,RECIPE_TOOLS} from './recipes';
import {embedRankings} from './config';
import {getEmbedder,setEmbedder} from '@/app/entity-db/embeddings';
import {storedEmbedDim} from '@/app/entity-db/schema';
import {embedder as llmEmbedder} from '@/app/llm';
async function embedNow(rankingId:string){const db=await entityDb();if(!getEmbedder())setEmbedder(t=>llmEmbedder()(t));const e=getEmbedder();if(e)await embedRankings(db,e,await storedEmbedDim(db),1,rankingId);}
// Tools of a topic team. Everyone explores with the public sources, data tools and entity database;
// the collector writes schemas and recipes and runs them, the editor writes templates and ranking
// definitions, the reviewer reads everything and opens rendered pages. Strict schemas: every property
// is required; JSON values are passed as JSON strings; "" means not given.
export type Role='editor'|'collector'|'reviewer'|'manager';
const tool=(name:string,description:string,properties:Record<string,unknown>)=>({type:'function' as const,name,description,strict:true,parameters:{type:'object',additionalProperties:false,properties,required:Object.keys(properties)}});
const string={type:'string'},integer={type:'integer'};
const FORMAT='Format: docs/rankwiki-templates.md (also returned by team_state as "formats").';

const teamTools={
 team_state:tool('team_state','The topic\'s current state: entity types (schema, template, status, entity count), ranking definitions, recipes with their last run, metrics (key, label, unit, entities with a value, periods covered) and the formats of templates, schemas, rankings and recipes. Call it first. type: "" for all types of the topic.',{type:string}),
 coverage:tool('coverage','Check the data of one entity type: entity count against expected (the universe), and for each metric how many entities have a value, the latest period, the range of periods, and sample entities that lack it; possible duplicates (same normalized name); and whether the data refreshes by itself — metrics no recipe loads, recipes that never ran or failed (recipeProblems must be empty). metrics: comma list ("" = every metric with data for the type). expected: the size of the universe (0 unknown).',{type:string,metrics:string,expected:integer}),
 set_entity_schema:tool('set_entity_schema','Collector: record the schema of an entity type — identity rules, metrics (key, label, unit in base units, order, format, source, history), attributes, relations, the universe (authoritative membership list and expected count). '+FORMAT+' schemaJson: JSON object string.',{type:string,label:string,plural:string,description:string,schemaJson:string}),
 save_recipe:tool('save_recipe','Collector: save a recipe — the ordered tool calls that fetch, clean and load one source into the entity database; the crawler runs it on its schedule with no model. stepsJson: JSON array string of {id, tool, args}; tools: '+RECIPE_TOOLS.join(', ')+'; args are the same as when you call the tool (object values allowed); "$<step id>" passes that step\'s dataset id. Build and test the calls yourself first, then save the working sequence. schedule: daily | weekly | monthly | yearly.',{type:string,name:string,description:string,stepsJson:string,schedule:string}),
 run_recipe:tool('run_recipe','Collector: run a saved recipe now (as the crawler does) and return each step\'s result (row counts, entities inserted/merged, observations, errors).',{type:string,name:string}),
 set_entity_template:tool('set_entity_template','Editor: save the page template of an entity type — lead sentence patterns, card items, sections. Every page of the type is rendered from it by the platform. Optional page:{minMetrics:N} sets which entities get a page at all (at least N metrics with data; default 1) — raise it for types full of stubs. '+FORMAT+' templateJson: JSON object string.',{type:string,label:string,plural:string,templateJson:string}),
 save_ranking:tool('save_ranking','Editor: save a ranking definition (create or update by slug). Rendered at /rankings/<slug> from the entity database. title: "<scope as a singular noun> Rankings" (never "Top…", no criterion). scopeJson: {"type": "...", "filters": {...}} (filters as for entity_search, e.g. {"region":"Europe & Central Asia"}). criteria: comma list of metric keys (1–12, must have data). configJson: {"default": key, "views": "auto", "period": "all", "group": attribute, "lead": pattern, "about": [patterns], "related": [slugs]}. '+FORMAT,{slug:string,title:string,scopeJson:string,criteria:string,configJson:string}),
 save_plan:tool('save_plan','Editor: add items to the topic plan (roadmap) — what the team does next. kind: "ranking" (a ranking to create or extend), "entity_pages" (a set of entities that must have pages, e.g. every country, or the cities over 1 million), "ingest" (entities or data the collector must collect next — the collector works from these), "refresh" (data to update on a cadence). Decide from the topic\'s scope, coverage gaps and readers\' queries (read_inbox). itemsJson: JSON array string of {kind, title, spec: object with the details (type, filters, metrics, sources, why), priority 0–100, cadence: "" | daily | weekly | monthly | yearly}.',{itemsJson:string}),
 close_plan_items:tool('close_plan_items','Mark plan items done or cancelled (editor: any item; collector: ingest/refresh items it has completed). idsJson: JSON array string of item ids. status: done | cancelled. note: what was done or why not.',{idsJson:string,status:string,note:string}),
 missing_pages:tool('missing_pages','Editor: entities that other pages mention (as related entities: capital, brand, located in…) but that have no page yet, because their type has no published template or has not been collected — grouped by type with how often they are mentioned and the most-mentioned names. Each new page here is linked from every page that mentions it at once. Plan them (save_plan: "ingest" for the collector, then a template) by how much they connect. type: "" for all types.',{type:string}),
 read_inbox:tool('read_inbox','Editor: readers\' queries the router could not serve and sent to this topic (no page and no data yet), newest first, with how often each was asked. Turn the worthwhile ones into plan items (save_plan), then mark them read with triage_queries.',{limit:integer}),
 triage_queries:tool('triage_queries','Editor: mark inbox queries as read. idsJson: JSON array string of inbox ids. note: the decision (e.g. "planned: ingest every perfume of Chanel" or "out of scope").',{idsJson:string,note:string}),
 record_decision:tool('record_decision','Record how a conflict was resolved — between the brief and the platform rules, between the brief and what the data allows, or between team members — so the reviewer judges the work against it. conflict: what clashed. decision: what was done. why: the reason readers are served best this way.',{conflict:string,decision:string,why:string}),
 set_topic_brief:tool('set_topic_brief','Manager: rewrite the topic brief (what the topic covers and what its pages must offer). The team works from it from the next step on.',{brief:string}),
 retract_observations:tool('retract_observations','Collector: withdraw observations the team has ruled out, e.g. a metric loaded from a less authoritative or superseded source. Removes every observation of one metric for one entity type whose source starts with source, or (keepSource) every one whose source does NOT start with keepSource; period limits it to one period. Snapshots, ranks and pages update at once. Read the source names with entity_get first, and fix the recipe that loaded them or they return on its next run. Use empty strings for unused fields.',{type:string,metric:string,source:string,keepSource:string,period:string}),
 propose_subtopics:tool('propose_subtopics','Editor: propose how this topic\'s field divides further into subtopics, each with its own team (e.g. Farm tractors → Compact tractors, Utility tractors, Row-crop tractors). The manager approves, rejects or asks for a revision in its daily review; the decision appears in team_state → topic.decisions. Propose only splits that follow an established classification (industry segments, a standard taxonomy, official divisions) and that have enough data and reader demand; ordinary sub-rankings within this topic (by region, price band, year) need no proposal — make them yourself with save_ranking. itemsJson: JSON array string of {slug, name, basis (the classification and its source), brief (what it ranks, its universe, criteria and likely sources), why (data and demand)}.',{itemsJson:string}),
 set_interfaces:tool('set_interfaces','Editor: declare the interfaces an entity type has besides its parent (mixins): sets of attributes, metrics, indices, sections and sources it also needs — e.g. a military drone (under military equipment) also has the aircraft interface; a smartwatch (under wearables) also the watch interface. Interfaces are inherited by every subtype. Only existing interfaces (list_interfaces); the type keeps its parent. interfacesJson: JSON array string of interface type names (the full list for this type).',{type:string,interfacesJson:string,why:string}),
 list_interfaces:tool('list_interfaces','List the interfaces (mixins) a type can declare with set_interfaces: their names, what they cover.',{}),
 request_access:tool('request_access','Ask the operators for access you need to collect data well: an API key or token (free registration), an account, a paid plan, a data licence, or a raised quota (web search, a rate-limited API). One request per service; requests from different teams for the same service are merged, so the operators see how many topics need it. service: the provider name ("YouTube Data API", "Kakaku.com"). url: its sign-up or API docs page. need: key | account | paid_plan | licence | quota. why: what data it gives this topic and for which markets. alternatives: what you tried instead and why it falls short. Keep working with what is available meanwhile. When a key is granted it appears in team_state → keys as SOURCE_KEY_<SERVICE> (e.g. SOURCE_KEY_KAKAKU): use it as {{secret:SOURCE_KEY_KAKAKU}} in fetch_data urls/headers and bulk_import urls; you never see the value.',{service:string,url:string,need:string,why:string,alternatives:string}),
 report_issue:tool('report_issue','Report a problem you cannot solve yourself to the human operators (it appears on the admin page and they are notified): a source that needs a login, payment or a key; a site that blocks automated reading; a platform feature or tool that is missing or broken; rules that contradict each other. Say what you tried. Do not report what you can fix yourself; keep working on the rest. severity: blocker (the topic cannot progress), major, minor.',{title:string,detail:string,severity:string}),
 web_search:tool('web_search','Search the web (any language) to discover data sources: statistics offices, regulators, industry associations, registries, official catalogs, retailers and spec sites, open data dumps. Search in English AND in the local languages of the main markets (e.g. "拖拉机 销量 数据", "ट्रैक्टर बिक्री आंकड़े", "トラクター 出荷 統計"). Returns titles, URLs and snippets; open promising ones with fetch_data / browse_page. count: 1–10.',{query:string,count:integer}),
 find_sources:tool('find_sources','Search the world directory of public data sources (international bodies, the statistics office of every large country, regulators, registries, stock exchanges, local retailers and spec sites, bulk dumps) by subject words and country. query: e.g. "tractors sales", "drug approvals", "company registry". country: ISO code or name ("IN", "Japan") or "" for all. Entries are leads: open them before relying on them.',{query:string,country:string}),
 record_sources:tool('record_sources','Collector: record your source survey in the topic\'s source register — every candidate source you examined, chosen or not, so later runs and reviews build on it. itemsJson: JSON array string of {url, name, kind (statistics|regulator|registry|association|catalog|retail|spec_site|dataset|api|other), countries (e.g. "CN, IN" or "world"), covers (what entities and fields, how many, which years), format (api|bulk|csv|html), decision (chosen|rejected|candidate), reason}.',{itemsJson:string}),
 preview_page:tool('preview_page','Open a page of this site as a reader or crawler sees it (server-rendered HTML, no scripts): returns status, title, the visible text (first 8,000 characters), the number of table rows, charts and links. path: e.g. "/rankings/country-rankings", "/rankings/country-rankings?year=2005", "/e/country/france".',{path:string}),
};
const ROLE_TOOLS:Record<Role,string[]>={
 collector:['team_state','coverage','list_interfaces','web_search','find_sources','record_sources','set_entity_schema','save_recipe','run_recipe','retract_observations','close_plan_items','request_access','report_issue'],
 editor:['team_state','coverage','web_search','find_sources','set_entity_template','save_ranking','save_plan','close_plan_items','missing_pages','read_inbox','triage_queries','record_decision','preview_page','propose_subtopics','set_interfaces','list_interfaces','request_access','report_issue'],
 reviewer:['team_state','coverage','web_search','find_sources','preview_page','report_issue'],
 manager:['team_state','coverage','preview_page','record_decision','set_topic_brief','report_issue'],
};
// Data tools without save_data (that writes Page files); the reviewer reads, never writes.
const EXPLORE=[...publicSourceTools,...dataTools.filter(t=>t.name!=='save_data')];
const ENTITY_READ=['entity_search','entity_get','metric_table','metric_sensitivity'];
// Metrics and indices are the collector's (the data); the editor reads them and presents them.
export function teamToolDefs(role:Role){
 const entity=entityTools.filter(t=>role==='reviewer'||role==='manager'?ENTITY_READ.includes(t.name):role==='editor'?ENTITY_READ.includes(t.name):true);
 return [...EXPLORE,...entity,...ROLE_TOOLS[role].map(n=>teamTools[n as keyof typeof teamTools])];
}

const json=(v:unknown,what:string)=>{try{const o=JSON.parse(String(v||''));return o;}catch{throw Error(what+' must be valid JSON.');}};
// The topic's editor record (owner of the plan and the inbox), created on first use.
export async function topicEditorId(db:Queryable,topicId:string|null):Promise<string|null>{
 if(!topicId)return null;
 const r=await db.query<{id:string}>('select id from editors where topic_id=$1::uuid order by created_at limit 1',[topicId]);
 return r.rows[0]?.id??(await createEditor(db,{topicId})).id;
}
async function teamState(type:string,topicId:string|null){
 const db=await entityDb();
 const editorId=await topicEditorId(db,topicId);
 const types=(await listEntityTypes(db,topicId)).filter(t=>!type||t.type===normalizeType(type));
 const counts=await typeCounts(db);
 const metrics=(await db.query(`select o.metric, count(distinct o.entity_id)::int entities, min(o.period) first, max(o.period) last, m.label, m.unit, m.kind
  from observations o join entities e on e.id=o.entity_id left join metrics m on m.key=o.metric and m.version=1
  where $1::text is null or e.type=$1::text group by o.metric, m.label, m.unit, m.kind order by o.metric limit 200`,[type?normalizeType(type):null])).rows;
 return {
  topic:topicId?await topicBrief(db,topicId):null,
  // Each type with what it inherits (extends: its ancestors) and its effective schema (inherited + own).
  types:await Promise.all(types.map(async t=>{const {effectiveType}=await import('@/app/entity-db/inherit');const e=await effectiveType(db,t.type).catch(()=>null);return {...t,entities:counts.get(t.type)??0,...(e?{extends:e.extends,effectiveSchema:e.schema}:{})};})),
  untypedEntities:[...counts].filter(([t])=>!types.some(x=>x.type===t)).map(([t,n])=>({type:t,entities:n})),
  rankings:await listRankingDefs(db,{type:type||undefined,topicId:type?undefined:topicId}),
  recipes:(await listRecipes(db,type||undefined)).map(r=>({type:r.type,name:r.name,description:r.description,schedule:r.schedule,status:r.status,steps:r.steps.length,lastRunAt:r.lastRunAt,lastResult:r.lastResult})),
  metrics,
  sources:topicId?await (await import('./sources')).listSources(db,topicId):[],
  // Keys the operators configured for sources that need one (names only; use {{secret:NAME}} in fetch_data / bulk_import).
  keys:(await import('@/app/data-tools/secrets')).secretNames(),
  plan:editorId?(await listRoadmap(db,editorId)).filter(i=>i.status==='pending'||i.status==='running'||i.status==='failed').map(i=>({id:i.id,kind:i.kind,title:i.title,spec:i.spec,priority:i.priority,cadence:i.cadence,status:i.status,origin:i.origin})):[],
  inboxWaiting:editorId?(await listInbox(db,editorId,{limit:200})).length:0,
  formats:'See docs/rankwiki-templates.md: template {lead:[patterns], card:[keys], sections:[{kind, …}]} with values metric.<key> period.<key> rank.<key> of.<key> change.<key> attr.<name> rel.<predicate> name type.label; schema {identity, metrics:[{key,label,unit,order,format,source,history}], attributes, relations, universe:{source, expected}}; ranking {slug,title,scope:{type,filters},criteria,config:{default,views,period,group,lead,about,related}}; recipe steps [{id, tool, args}] with "$<step id>".',
 };
}
// Observation checks of a type, cached until its data changes: kept while computed more than a minute after the
// type's last noted change (data_changes notes at most one change per minute) and the entity count is the same.
type ObsChecks={rows:Record<string,unknown>[];latest:{metric:string;period:string;n:number}[];lacking:{metric:string;names:string[]}[];
 zeroMetrics:{metric:string;zeros:number;n:number}[];allZero:string[];extremes:{metric:string;name:string;value:number;med:number}[]};
const obsCache=new Map<string,{at:number;value:Promise<ObsChecks>}>();
async function observationChecks(db:Awaited<ReturnType<typeof entityDb>>,type:string,keys:string[],total:number):Promise<ObsChecks>{
 const changed=(await db.query<{at:unknown}>('select max(at) at from data_changes where type = $1::text',[type]).catch(()=>({rows:[]as {at:unknown}[]}))).rows[0]?.at;
 const changedAt=changed?new Date(String(changed)).getTime():0;
 const key=type+'|'+keys.join(',')+'|'+total;const hit=obsCache.get(key);
 if(hit&&hit.at>changedAt+60_000&&Date.now()-hit.at<6*3600_000)return hit.value;
 const value=(async():Promise<ObsChecks>=>{
  const zeroMetrics=(await db.query<{metric:string;zeros:number;n:number}>(`select o.metric, count(*) filter (where o.value=0)::int zeros, count(*)::int n from observations o join entities e on e.id=o.entity_id
   where e.type=$1::text group by o.metric having count(*) filter (where o.value=0) >= greatest(5, count(*)/2)`,[type])).rows;
  const allZero=(await db.query<{name:string}>(`select e.name from entities e where e.type=$1::text and exists (select 1 from observations o where o.entity_id=e.id)
   and not exists (select 1 from observations o where o.entity_id=e.id and o.value<>0) order by e.name limit 10`,[type])).rows.map(r=>r.name);
  const extremes=(await db.query<{metric:string;name:string;value:number;med:number}>(`with v as (select o.metric, e.name, o.value, row_number() over (partition by o.metric order by o.value desc) rn
   from (select distinct on (o.entity_id, o.metric) o.entity_id, o.metric, o.value from observations o join entities t on t.id=o.entity_id where t.type=$1::text order by o.entity_id, o.metric, o.period desc) o join entities e on e.id=o.entity_id where o.value>0),
  m as (select metric, percentile_cont(0.5) within group (order by value) med from v where rn<=20 group by metric having count(*)>=10)
  select v.metric, v.name, v.value, m.med from v join m using (metric) where v.rn<=5 and v.value > 20*m.med order by v.metric, v.value desc limit 15`,[type])).rows;
  const rows=(await db.query(`select o.metric, count(distinct o.entity_id)::int entities, min(o.period) first, max(o.period) last, count(distinct o.period)::int periods, count(*)::int observations,
   bool_and(o.source like 'derived:%') derived
   from observations o join entities e on e.id=o.entity_id where e.type=$1::text and (cardinality($2::text[])=0 or o.metric=any($2::text[])) group by o.metric order by o.metric`,[type,keys])).rows;
  const ms=rows.map(r=>String(r.metric)),partial=rows.filter(r=>Number(r.entities)<total).map(r=>String(r.metric));
  const latest=ms.length?(await db.query<{metric:string;period:string;n:number}>(`select metric, period, count(*)::int n from (select distinct on (o.entity_id, o.metric) o.metric, o.period
   from observations o join entities e on e.id=o.entity_id where e.type=$1::text and o.metric=any($2::text[]) order by o.entity_id, o.metric, o.period desc) x group by metric, period`,[type,ms])).rows:[];
  const lacking=partial.length?(await db.query<{metric:string;names:string[]}>(`select m.metric, coalesce(l.names,'{}') names from unnest($2::text[]) m(metric) cross join lateral
   (select array_agg(name order by name) names from (select e.name from entities e where e.type=$1::text and not exists (select 1 from observations o where o.entity_id=e.id and o.metric=m.metric) order by e.name limit 12) z) l`,[type,partial])).rows:[];
  return {rows,latest,lacking,zeroMetrics,allZero,extremes};
 })();
 obsCache.set(key,{at:Date.now(),value});value.catch(()=>{if(obsCache.get(key)?.value===value)obsCache.delete(key);});
 while(obsCache.size>300)obsCache.delete(obsCache.keys().next().value!);
 return value;
}
export async function coverage(typeRaw:string,metricsCsv:string,expected:number){
 const db=await entityDb(),type=normalizeType(typeRaw);
 const total=Number((await db.query<{n:number}>('select count(*)::int n from entities where type=$1::text',[type])).rows[0]?.n||0);
 const keys=metricsCsv.split(',').map(s=>s.trim()).filter(Boolean);
 // The observation checks read every value of the type: computed once per change of the type's data (data_changes),
 // not on every call (an editor's or collector's run calls coverage many times; a country type has ~1M values).
 const obs=await observationChecks(db,type,keys,total);const rows=obs.rows;
 const perMetric=rows.map(r=>({...r,coverage:total?Math.round(Number(r.entities)/total*1000)/10+'%':'0%',
  latestPeriods:obs.latest.filter(x=>x.metric===r.metric).sort((a,b)=>a.period<b.period?1:-1).slice(0,5).map(x=>({period:x.period,n:x.n})),
  lacking:obs.lacking.find(x=>x.metric===r.metric)?.names||[]}));
 // Metrics of the type that no recipe loads (they would never be refreshed), and recipes that never ran or failed.
 const recipes=await listRecipes(db,type);
 const loaded=new Set<string>();
 for(const r of recipes)for(const st of r.steps as {tool?:string;args?:Record<string,unknown>}[]){
  if(st.tool!=='entity_upsert')continue;let mc=st.args?.metricColumns;if(typeof mc==='string'){try{mc=JSON.parse(mc);}catch{mc={};}}
  for(const v of Object.values((mc||{}) as Record<string,{metric?:string}>))if(v?.metric)loaded.add(String(v.metric).split('@')[0]);}
 const notInRecipes=rows.map(r=>String(r.metric)).filter(m=>!loaded.has(m));
 const recipeHealth=recipes.map(r=>({name:r.name,steps:r.steps.length,status:r.status,lastRunAt:r.lastRunAt,lastOk:(r.lastResult as {ok?:boolean}|null)?.ok??null,problems:checkRecipe(r.steps as never)}));
 const dupes=(await db.query(`select ent_norm(name) k, array_agg(name order by name) names, count(*)::int n from entities where type=$1::text group by ent_norm(name) having count(*)>1 limit 20`,[type])).rows;
 const noIds=Number((await db.query<{n:number}>(`select count(*)::int n from entities where type=$1::text and ids='{}'::jsonb`,[type])).rows[0]?.n||0);
 // Data checks (the collector's responsibility): a measure mostly zero (a wrong field or a failed parse), entities
 // whose every value is zero, and names that are not names (no letters, a web address, a sentence, very long).
 const zeroMetrics=obs.zeroMetrics,allZero=obs.allZero,extremes=obs.extremes;
 const oddNames=(await db.query<{name:string}>(`select name from entities where type=$1::text and (name !~ '[[:alpha:]]' or length(name)>120 or name ~* '^https?://|www\\.' or array_length(regexp_split_to_array(trim(name),'\\s+'),1)>9) order by name limit 10`,[type])).rows.map(r=>r.name);
 const dataProblems=[...zeroMetrics.map(z=>`Metric ${z.metric}: ${z.zeros} of ${z.n} values are 0 — check the field mapping or the parse (remove the wrong values and reload).`),
  ...(allZero.length?[`Entities whose every value is 0 (probably not real members, or loaded from a broken probe): ${allZero.join('; ')} — fix or remove them.`]:[]),
  ...(oddNames.length?[`Names that do not look like ${type} names: ${oddNames.join('; ')} — fix the name column or drop these rows.`]:[])];
 // Values far above the rest of the top (more than 20× the median of the top 20) are often a source's typo or wrong
 // unit: each must be checked against a second source before the ranking is published.
 const toVerify=extremes.map(x=>`${x.name}: ${x.metric} = ${x.value} (the top 20's median is ${Math.round(x.med)}) — confirm with a second source, or correct it.`);
 // Measured data with one or two periods: most statistical sources publish years of history (ACS since 2005, BEA
 // since 1997, World Bank since 1960) that pages show as trends and rankings over time. Each one is either loaded
 // with its history or recorded as having none (record_sources, why) — derived indices follow their inputs.
 const historyGaps=rows.filter(r=>!r.derived&&Number(r.periods)<=2).map(r=>`Metric ${r.metric}: only ${r.periods===1?'one period ('+r.last+')':'2 periods ('+r.first+', '+r.last+')'} — load every earlier year the source (or another source) offers, in its recipe; if no source has history, record that with record_sources.`);
 return {type,entities:total,expected:expected||null,universeCoverage:expected?Math.round(total/expected*1000)/10+'%':null,entitiesWithoutStandardId:noIds,possibleDuplicates:dupes,metrics:perMetric,
  // Data must stay fresh by itself: every metric needs a recipe that loads it, and every recipe must have run successfully.
  metricsWithoutRecipe:notInRecipes,recipes:recipeHealth,dataProblems,historyGaps,toVerify,
  recipeProblems:[...notInRecipes.map(m=>'No recipe loads metric '+m+': it will never be refreshed.'),...recipeHealth.filter(r=>r.lastOk!==true).map(r=>'Recipe '+r.name+(r.lastRunAt?' failed its last run.':' has never been run (run_recipe).')),...recipeHealth.flatMap(r=>r.problems.map(p=>r.name+': '+p))]};
}
// Entities per type (a full count of the entities table): shared by the teams' calls for a few minutes.
let countsAt=0,countsP:Promise<Map<string,number>>|null=null;
function typeCounts(db:{query:<T>(sql:string,params?:unknown[])=>Promise<{rows:T[]}>}):Promise<Map<string,number>>{
 if(!countsP||Date.now()-countsAt>5*60_000){countsAt=Date.now();
  countsP=db.query<{type:string;n:number}>('select type, count(*)::int n from entities group by type').then(r=>new Map(r.rows.map(x=>[x.type,Number(x.n)])));
  countsP.catch(()=>{countsP=null;});}
 return countsP;
}
async function previewPage(path:string){
 const p=String(path||'').trim();if(!/^\/[\w\-./?=&%]*$/.test(p)||p.startsWith('//'))throw Error('Give a site path such as /rankings/country-rankings.');
 const base=process.env.TEAM_PREVIEW_ORIGIN||siteUrl()||'http://127.0.0.1:'+(process.env.PORT||'3000');
 // Rebuilt from the database for this request (x-rankwiki-fresh), so the agent sees its own change, not the stored page.
 const r=await fetch(base+p,{redirect:'follow',signal:AbortSignal.timeout(60_000),headers:{'user-agent':'RankWiki-reviewer',...(process.env.TEAM_ADMIN_TOKEN?{'x-rankwiki-fresh':process.env.TEAM_ADMIN_TOKEN}:{})}});
 const html=await r.text();
 const title=/<title>([^<]*)<\/title>/.exec(html)?.[1]||'';
 const body=html.replace(/<script[\s\S]*?<\/script>/g,'').replace(/<style[\s\S]*?<\/style>/g,'');
 const text=body.replace(/<svg[\s\S]*?<\/svg>/g,' ').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&#x27;|&#39;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g,' ').trim();
 // Each server-drawn chart as text (its labels, axis ticks and series names), so the reviewer can judge it: repeated
 // tick labels, two units on one chart, an empty or near-empty chart.
 const chartTexts=[...body.matchAll(/<svg[\s\S]*?<\/svg>/g)].map(m=>[...m[0].matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map(t=>t[1].replace(/&amp;/g,'&').trim()).filter(Boolean)).filter(l=>l.length).slice(0,12).map(l=>l.slice(0,60).join(' | '));
 return {status:r.status,url:siteUrl()+p,title,rows:(body.match(/<tr[\s>]/g)||[]).length,charts:(body.match(/wf-rank-svg|role="img"/g)||[]).length,chartTexts,links:(body.match(/<a\s/g)||[]).length,text:text.slice(0,8000)};
}

export async function runTeamTool(role:Role,name:string,args:Record<string,unknown>,ctx:AgentContext,topicId:string|null,signal?:AbortSignal):Promise<{data:unknown}>{
 if(!teamToolDefs(role).some(t=>t.name===name))throw Error(name+' is not one of the '+role+'\'s tools.');
 const db=await entityDb(),who=role+':'+(ctx.agent?.id||'');
 switch(name){
  case 'list_public_sources':return {data:await listPublicSources(signal,String(args.source??''))};
  case 'call_public_source':{const data=await callPublicSource(String(args.sourceId),String(args.tool),json(args.argumentsJson||'{}','argumentsJson'),ctx,signal);
   if(topicId&&(role==='collector'||role==='editor')){const src=(data as {source?:string})?.source;void autoRecordSource(db,topicId,'call_public_source',{url:typeof src==='string'&&/^https?:/.test(src)?src.split(/[\s;]/)[0]:'https://rankwiki.aisoup.net/sources/'+encodeURIComponent(String(args.sourceId))}).catch(()=>{});}
   return {data};}
  case 'team_state':return {data:await teamState(String(args.type||''),topicId)};
  case 'web_search':{const {searchWeb}=await import('./sources');return {data:await searchWeb(String(args.query||''),Number(args.count)||8,signal)};}
  case 'find_sources':{const {findSources}=await import('./sources');return {data:await findSources(String(args.query||''),String(args.country||''))};}
  case 'record_sources':{const {recordSources}=await import('./sources');const items=json(args.itemsJson,'itemsJson');if(!Array.isArray(items)||!items.length)throw Error('itemsJson: a JSON array of sources.');return {data:await recordSources(db,topicId,items)};}
  case 'coverage':return {data:await coverage(String(args.type),String(args.metrics||''),Number(args.expected)||0)};
  case 'set_entity_schema':return {data:await saveEntityType(db,{type:String(args.type),label:String(args.label||''),plural:String(args.plural||''),description:String(args.description||''),schema:json(args.schemaJson,'schemaJson'),topicId,updatedBy:who})};
  case 'set_entity_template':return {data:await saveEntityType(db,{type:String(args.type),label:String(args.label||''),plural:String(args.plural||''),template:json(args.templateJson,'templateJson'),topicId,updatedBy:who})};
  case 'save_recipe':{const steps=json(args.stepsJson,'stepsJson');const problems=checkRecipe(parseSteps(steps));if(problems.length)throw Error('Recipe not saved: '+problems.join(' '));
   const r=await saveRecipe(db,{type:String(args.type),name:String(args.name),description:String(args.description||''),steps,schedule:String(args.schedule||''),createdBy:who});
   return {data:{saved:true,type:r.type,name:r.name,steps:r.steps.length,schedule:r.schedule}};}
  case 'retract_observations':return {data:await retractObservations(db,{type:String(args.type||''),metric:String(args.metric||''),source:String(args.source||'')||undefined,keepSource:String(args.keepSource||'')||undefined,period:String(args.period||'')||undefined})};
  case 'propose_subtopics':{const {proposeSubtopics}=await import('./manager');const items=json(args.itemsJson,'itemsJson');if(!Array.isArray(items)||!items.length)throw Error('itemsJson: a JSON array of proposals.');
   const slug=topicId?(await db.query<{slug:string}>('select slug from topics where id=$1::uuid',[topicId])).rows[0]?.slug:null;if(!slug)throw Error('This team has no topic.');
   return {data:await proposeSubtopics(db,slug,items)};}
  case 'list_interfaces':{const {listInterfaces}=await import('@/app/entity-db/inherit');return {data:{interfaces:await listInterfaces(db)}};}
  case 'set_interfaces':{
   const type=normalizeType(String(args.type||''));const list=json(args.interfacesJson,'interfacesJson');if(!Array.isArray(list))throw Error('interfacesJson: a JSON array of interface names.');
   const names=[...new Set(list.map(x=>normalizeType(String(x))))];
   const known=new Set((await (await import('@/app/entity-db/inherit')).listInterfaces(db)).map(i=>i.type));
   const bad=names.filter(n=>!known.has(n));if(bad.length)throw Error('Not interfaces: '+bad.join(', ')+'. See list_interfaces.');
   const r=await db.query(`update entity_types set schema=jsonb_set(coalesce(schema,'{}'::jsonb),'{interfaces}',$2::jsonb), updated_at=now() where type=$1::text returning type`,[type,JSON.stringify(names)]);
   if(!r.rows.length)throw Error('No entity type '+type+'.');
   if(topicId)await recordDecision(db,topicId,{by:role,conflict:'Interfaces of '+type,decision:names.join(', ')||'none',why:String(args.why||'').slice(0,1000)});
   (await import('@/app/entity-db/inherit')).clearTypeCache();
   return {data:{type,interfaces:names}};}
  case 'request_access':{const {raiseIssue}=await import('@/app/ops/issues');const t=topicId?(await db.query<{slug:string}>('select slug from topics where id=$1::uuid',[topicId])).rows[0]?.slug??'':'';
   const service=String(args.service||'').trim().slice(0,120);if(!service)throw Error('service: the provider name.');
   const need=['key','account','paid_plan','licence','quota'].includes(String(args.need))?String(args.need):'key';
   let host='';try{host=new URL(String(args.url||'')).hostname.replace(/^www\./,'');}catch{}
   // One issue per service (fingerprint), so repeated requests from many topics add up on the admin page.
   const r=await raiseIssue(db,{source:'access',topic:t,severity:'major',title:'Access needed: '+service+' ('+need.replace('_',' ')+')',
    detail:['Topic: '+t,'Service: '+service,'URL: '+String(args.url||''),'Need: '+need,'Why: '+String(args.why||''),'Alternatives tried: '+String(args.alternatives||'')].join('\n').slice(0,4000),
    fingerprint:'access:'+(host||service.toLowerCase().replace(/[^a-z0-9]+/g,'-'))+':'+need});
   return {data:{requested:true,id:r.issue.id,alreadyRequested:!r.isNew,note:'The operators are told; keep working with the sources available meanwhile.'}};}
  case 'report_issue':{const {raiseIssue}=await import('@/app/ops/issues');const t=topicId?(await db.query<{slug:string}>('select slug from topics where id=$1::uuid',[topicId])).rows[0]?.slug??'':'';
   const sev=['blocker','major','minor'].includes(String(args.severity))?String(args.severity) as 'blocker'|'major'|'minor':'major';
   const r=await raiseIssue(db,{source:'agent:'+role,topic:t,severity:sev,title:String(args.title||'').slice(0,300),detail:String(args.detail||'')});
   return {data:{reported:true,id:r.issue.id,repeat:!r.isNew}};}
  case 'run_recipe':{const r=await getRecipe(db,String(args.type),String(args.name));if(!r)throw Error('No recipe '+args.type+'/'+args.name+'.');return {data:await runRecipe(db,r,signal)};}
  case 'save_ranking':{const def=await saveRankingDef(db,{slug:String(args.slug),title:String(args.title),scope:json(args.scopeJson,'scopeJson'),criteria:String(args.criteria||'').split(','),config:json(args.configJson||'{}','configJson'),topicId});
   // The ranking's view vectors are ready before anyone searches for it (the heartbeat retries a failure).
   await embedNow(def.id).catch(e=>console.warn('ranking vectors deferred',(e as Error).message));
   return {data:def};}
  case 'save_plan':{
   const editorId=await topicEditorId(db,topicId);if(!editorId)throw Error('No topic.');
   const items=json(args.itemsJson,'itemsJson');if(!Array.isArray(items)||!items.length||items.length>50)throw Error('itemsJson: a list of 1–50 items.');
   const saved=[];for(const it of items as Record<string,unknown>[]){
    const kind=String(it.kind);if(!['ranking','entity_pages','ingest','refresh'].includes(kind))throw Error('kind: ranking | entity_pages | ingest | refresh.');
    saved.push(await addRoadmapItem(db,{editorId,kind:kind as RoadmapKind,title:String(it.title||'').slice(0,300),spec:it.spec&&typeof it.spec==='object'?it.spec as Record<string,unknown>:{},priority:Number(it.priority)||50,cadence:String(it.cadence||''),origin:'plan'}));}
   return {data:{saved:saved.map(i=>({id:i.id,kind:i.kind,title:i.title,priority:i.priority,dueAt:i.dueAt}))}};}
  case 'close_plan_items':{
   const ids=json(args.idsJson,'idsJson');const status=String(args.status)==='cancelled'?'cancelled':'done';if(!Array.isArray(ids))throw Error('idsJson: a list of ids.');
   const editorId=await topicEditorId(db,topicId);const mine=new Map((editorId?await listRoadmap(db,editorId):[]).map(i=>[i.id,i]));
   let n=0;for(const id of ids.map(String)){const it=mine.get(id);if(!it)continue;if(role==='collector'&&!['ingest','refresh'].includes(it.kind))continue;
    await updateRoadmapItem(db,id,{status:it.cadence&&status==='done'?'pending':status,spec:{...it.spec,lastNote:String(args.note||'').slice(0,1000),lastDoneBy:role}});n++;}
   return {data:{updated:n}};}
  case 'missing_pages':{
   const t=String(args.type||'').trim();
   const r=await db.query<{type:string;entities:number;mentions:number;top:unknown}>(`with m as (select e.id,e.type,e.name,count(r.subject_id)::int n from entities e
     join relations r on r.object_id=e.id left join entity_types t on t.type=e.type
     where (t.type is null or t.template='{}'::jsonb or t.status<>'published') and ($1::text='' or e.type=$1::text) group by e.id,e.type,e.name)
    select type, count(*)::int entities, sum(n)::int mentions, (array_agg(name||' ('||n||')' order by n desc))[1:15] top from m group by type order by mentions desc limit 20`,[t?normalizeType(t):'']);
   return {data:{types:r.rows,note:'Mentions count relations pointing at these entities from pages that exist. Types listed here have no published page template yet.'}};}
  case 'read_inbox':{const editorId=await topicEditorId(db,topicId);if(!editorId)return {data:{queries:[]}};
   const q=await listInbox(db,editorId,{limit:Math.min(200,Number(args.limit)||50)});
   const counts=new Map<string,number>();for(const e of q){const k=e.query.toLowerCase().trim();counts.set(k,(counts.get(k)||0)+1);}
   return {data:{queries:q.map(e=>({id:e.id,query:e.query,language:e.language,askedAt:e.createdAt,timesAsked:counts.get(e.query.toLowerCase().trim())}))}};}
  case 'triage_queries':{const editorId=await topicEditorId(db,topicId);if(!editorId)return {data:{updated:0}};
   const ids=json(args.idsJson,'idsJson');if(!Array.isArray(ids))throw Error('idsJson: a list of ids.');
   return {data:{updated:await triageInbox(db,editorId,ids.map(String),String(args.note||'').slice(0,500))}};}
  case 'record_decision':{if(!topicId)throw Error('No topic.');return {data:await recordDecision(db,topicId,{by:role,conflict:String(args.conflict||'').slice(0,1000),decision:String(args.decision||'').slice(0,1000),why:String(args.why||'').slice(0,1000)})};}
  case 'set_topic_brief':{if(!topicId)throw Error('No topic.');const b=String(args.brief||'').trim();if(b.length<40)throw Error('Write the whole brief.');await setTopicBrief(db,topicId,b);return {data:{saved:true}};}
  case 'preview_page':return {data:await previewPage(String(args.path))};
 }
 const out=entityToolNames.includes(name)?await runEntityTool(name,args,ctx,signal):await runDataTool(name,args,ctx,signal);
 // Every source a team member actually read from is written to the topic's source register by the program (as a
 // candidate the collector then marks chosen or rejected), so the register never depends on remembering to record.
 if(topicId&&(role==='collector'||role==='editor')&&AUTO_SOURCE.has(name))void autoRecordSource(db,topicId,name,args).catch(()=>{});
 return out;
}
const AUTO_SOURCE=new Set(['fetch_data','extract_tables','browse_page','crawl_pages','extract_fields','llm_extract','bulk_import']);
async function autoRecordSource(db:Queryable,topicId:string,tool:string,args:Record<string,unknown>){
 const raw=String(args.url||args.startUrl||args.indexUrl||'').trim();if(!/^https?:\/\//.test(raw))return;
 let u:URL;try{u=new URL(raw.replace(/\{\{[^}]*\}\}/g,'x'));}catch{return;}
 // One entry per site path (not per query string), so repeated calls to one API do not flood the register.
 const url=u.origin+u.pathname.replace(/\/+$/,'');
 const notes=JSON.stringify({name:u.hostname.replace(/^www\./,''),countries:'',covers:'read with '+tool,format:tool==='bulk_import'?'bulk':tool==='fetch_data'?'api':'html',decision:'candidate',reason:'recorded automatically when the team read it',auto:true,at:new Date().toISOString()});
 await db.query(`insert into sources(topic_id,url,kind,notes,last_ok_at) values ($1::uuid,$2::text,'auto',$3::text,now()) on conflict (coalesce(topic_id::text, ''), url) do update set last_ok_at=now()`,[topicId,url.slice(0,2000),notes]);
}
export {getEntityType,listMetrics};
