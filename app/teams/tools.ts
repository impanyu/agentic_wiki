import type {AgentContext} from '@/app/components-registry/registry';
import {entityDb} from '@/app/entity-db/client';
import {entityTools,entityToolNames,runEntityTool} from '@/app/entity-db/tools';
import {listMetrics,normalizeType,createEditor,addRoadmapItem,listRoadmap,updateRoadmapItem,listInbox,triageInbox,type RoadmapKind} from '@/app/entity-db/repo';
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
 set_entity_template:tool('set_entity_template','Editor: save the page template of an entity type — lead sentence patterns, card items, sections. Every page of the type is rendered from it by the platform. '+FORMAT+' templateJson: JSON object string.',{type:string,label:string,plural:string,templateJson:string}),
 save_ranking:tool('save_ranking','Editor: save a ranking definition (create or update by slug). Rendered at /rankings/<slug> from the entity database. title: "<scope as a singular noun> Rankings" (never "Top…", no criterion). scopeJson: {"type": "...", "filters": {...}} (filters as for entity_search, e.g. {"region":"Europe & Central Asia"}). criteria: comma list of metric keys (1–12, must have data). configJson: {"default": key, "views": "auto", "period": "all", "group": attribute, "lead": pattern, "about": [patterns], "related": [slugs]}. '+FORMAT,{slug:string,title:string,scopeJson:string,criteria:string,configJson:string}),
 save_plan:tool('save_plan','Editor: add items to the topic plan (roadmap) — what the team does next. kind: "ranking" (a ranking to create or extend), "entity_pages" (a set of entities that must have pages, e.g. every country, or the cities over 1 million), "ingest" (entities or data the collector must collect next — the collector works from these), "refresh" (data to update on a cadence). Decide from the topic\'s scope, coverage gaps and readers\' queries (read_inbox). itemsJson: JSON array string of {kind, title, spec: object with the details (type, filters, metrics, sources, why), priority 0–100, cadence: "" | daily | weekly | monthly | yearly}.',{itemsJson:string}),
 close_plan_items:tool('close_plan_items','Mark plan items done or cancelled (editor: any item; collector: ingest/refresh items it has completed). idsJson: JSON array string of item ids. status: done | cancelled. note: what was done or why not.',{idsJson:string,status:string,note:string}),
 read_inbox:tool('read_inbox','Editor: readers\' queries the router could not serve and sent to this topic (no page and no data yet), newest first, with how often each was asked. Turn the worthwhile ones into plan items (save_plan), then mark them read with triage_queries.',{limit:integer}),
 triage_queries:tool('triage_queries','Editor: mark inbox queries as read. idsJson: JSON array string of inbox ids. note: the decision (e.g. "planned: ingest every perfume of Chanel" or "out of scope").',{idsJson:string,note:string}),
 record_decision:tool('record_decision','Record how a conflict was resolved — between the brief and the platform rules, between the brief and what the data allows, or between team members — so the reviewer judges the work against it. conflict: what clashed. decision: what was done. why: the reason readers are served best this way.',{conflict:string,decision:string,why:string}),
 set_topic_brief:tool('set_topic_brief','Manager: rewrite the topic brief (what the topic covers and what its pages must offer). The team works from it from the next step on.',{brief:string}),
 preview_page:tool('preview_page','Open a page of this site as a reader or crawler sees it (server-rendered HTML, no scripts): returns status, title, the visible text (first 8,000 characters), the number of table rows, charts and links. path: e.g. "/rankings/country-rankings", "/rankings/country-rankings?year=2005", "/e/country/france".',{path:string}),
};
const ROLE_TOOLS:Record<Role,string[]>={
 collector:['team_state','coverage','set_entity_schema','save_recipe','run_recipe','close_plan_items'],
 editor:['team_state','coverage','set_entity_template','save_ranking','save_plan','close_plan_items','read_inbox','triage_queries','record_decision','preview_page'],
 reviewer:['team_state','coverage','preview_page'],
 manager:['team_state','coverage','preview_page','record_decision','set_topic_brief'],
};
// Data tools without save_data (that writes Page files); the reviewer reads, never writes.
const EXPLORE=[...publicSourceTools,...dataTools.filter(t=>t.name!=='save_data')];
const ENTITY_READ=['entity_search','entity_get','metric_table','metric_sensitivity'];
export function teamToolDefs(role:Role){
 const entity=entityTools.filter(t=>role==='reviewer'||role==='manager'?ENTITY_READ.includes(t.name):role==='editor'?[...ENTITY_READ,'define_metric','compute_metric'].includes(t.name):true);
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
 const counts=new Map((await db.query<{type:string;n:number}>('select type, count(*)::int n from entities group by type')).rows.map(r=>[r.type,Number(r.n)]));
 const metrics=(await db.query(`select o.metric, count(distinct o.entity_id)::int entities, min(o.period) first, max(o.period) last, m.label, m.unit, m.kind
  from observations o join entities e on e.id=o.entity_id left join metrics m on m.key=o.metric and m.version=1
  where $1::text is null or e.type=$1::text group by o.metric, m.label, m.unit, m.kind order by o.metric limit 200`,[type?normalizeType(type):null])).rows;
 return {
  topic:topicId?await topicBrief(db,topicId):null,
  types:types.map(t=>({...t,entities:counts.get(t.type)??0})),
  untypedEntities:[...counts].filter(([t])=>!types.some(x=>x.type===t)).map(([t,n])=>({type:t,entities:n})),
  rankings:await listRankingDefs(db,{type:type||undefined,topicId:type?undefined:topicId}),
  recipes:(await listRecipes(db,type||undefined)).map(r=>({type:r.type,name:r.name,description:r.description,schedule:r.schedule,status:r.status,steps:r.steps.length,lastRunAt:r.lastRunAt,lastResult:r.lastResult})),
  metrics,
  plan:editorId?(await listRoadmap(db,editorId)).filter(i=>i.status==='pending'||i.status==='running'||i.status==='failed').map(i=>({id:i.id,kind:i.kind,title:i.title,spec:i.spec,priority:i.priority,cadence:i.cadence,status:i.status,origin:i.origin})):[],
  inboxWaiting:editorId?(await listInbox(db,editorId,{limit:200})).length:0,
  formats:'See docs/rankwiki-templates.md: template {lead:[patterns], card:[keys], sections:[{kind, …}]} with values metric.<key> period.<key> rank.<key> of.<key> change.<key> attr.<name> rel.<predicate> name type.label; schema {identity, metrics:[{key,label,unit,order,format,source,history}], attributes, relations, universe:{source, expected}}; ranking {slug,title,scope:{type,filters},criteria,config:{default,views,period,group,lead,about,related}}; recipe steps [{id, tool, args}] with "$<step id>".',
 };
}
export async function coverage(typeRaw:string,metricsCsv:string,expected:number){
 const db=await entityDb(),type=normalizeType(typeRaw);
 const total=Number((await db.query<{n:number}>('select count(*)::int n from entities where type=$1::text',[type])).rows[0]?.n||0);
 const keys=metricsCsv.split(',').map(s=>s.trim()).filter(Boolean);
 const rows=(await db.query(`select o.metric, count(distinct o.entity_id)::int entities, min(o.period) first, max(o.period) last, count(*)::int observations
  from observations o join entities e on e.id=o.entity_id where e.type=$1::text and (cardinality($2::text[])=0 or o.metric=any($2::text[])) group by o.metric order by o.metric`,[type,keys])).rows;
 const perMetric=[];
 for(const r of rows){
  const lacking=(await db.query<{name:string}>(`select e.name from entities e where e.type=$1::text and not exists (select 1 from observations o where o.entity_id=e.id and o.metric=$2::text) order by e.name limit 12`,[type,r.metric])).rows.map(x=>x.name);
  const latest=(await db.query<{period:string;n:number}>(`select period, count(*)::int n from (select distinct on (o.entity_id) o.period from observations o join entities e on e.id=o.entity_id where e.type=$1::text and o.metric=$2::text order by o.entity_id, o.period desc) x group by period order by period desc limit 5`,[type,r.metric])).rows;
  perMetric.push({...r,coverage:total?Math.round(Number(r.entities)/total*1000)/10+'%':'0%',latestPeriods:latest,lacking});
 }
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
 return {type,entities:total,expected:expected||null,universeCoverage:expected?Math.round(total/expected*1000)/10+'%':null,entitiesWithoutStandardId:noIds,possibleDuplicates:dupes,metrics:perMetric,
  // Data must stay fresh by itself: every metric needs a recipe that loads it, and every recipe must have run successfully.
  metricsWithoutRecipe:notInRecipes,recipes:recipeHealth,
  recipeProblems:[...notInRecipes.map(m=>'No recipe loads metric '+m+': it will never be refreshed.'),...recipeHealth.filter(r=>r.lastOk!==true).map(r=>'Recipe '+r.name+(r.lastRunAt?' failed its last run.':' has never been run (run_recipe).')),...recipeHealth.flatMap(r=>r.problems.map(p=>r.name+': '+p))]};
}
async function previewPage(path:string){
 const p=String(path||'').trim();if(!/^\/[\w\-./?=&%]*$/.test(p)||p.startsWith('//'))throw Error('Give a site path such as /rankings/country-rankings.');
 const base=process.env.TEAM_PREVIEW_ORIGIN||siteUrl()||'http://127.0.0.1:'+(process.env.PORT||'3000');
 const r=await fetch(base+p,{redirect:'follow',signal:AbortSignal.timeout(60_000),headers:{'user-agent':'RankWiki-reviewer'}});
 const html=await r.text();
 const title=/<title>([^<]*)<\/title>/.exec(html)?.[1]||'';
 const body=html.replace(/<script[\s\S]*?<\/script>/g,'').replace(/<style[\s\S]*?<\/style>/g,'');
 const text=body.replace(/<svg[\s\S]*?<\/svg>/g,' ').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&#x27;|&#39;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g,' ').trim();
 return {status:r.status,url:siteUrl()+p,title,rows:(body.match(/<tr[\s>]/g)||[]).length,charts:(body.match(/wf-rank-svg|role="img"/g)||[]).length,links:(body.match(/<a\s/g)||[]).length,text:text.slice(0,8000)};
}

export async function runTeamTool(role:Role,name:string,args:Record<string,unknown>,ctx:AgentContext,topicId:string|null,signal?:AbortSignal):Promise<{data:unknown}>{
 if(!teamToolDefs(role).some(t=>t.name===name))throw Error(name+' is not one of the '+role+'\'s tools.');
 const db=await entityDb(),who=role+':'+(ctx.agent?.id||'');
 switch(name){
  case 'list_public_sources':return {data:await listPublicSources(signal,String(args.source??''))};
  case 'call_public_source':return {data:await callPublicSource(String(args.sourceId),String(args.tool),json(args.argumentsJson||'{}','argumentsJson'),ctx,signal)};
  case 'team_state':return {data:await teamState(String(args.type||''),topicId)};
  case 'coverage':return {data:await coverage(String(args.type),String(args.metrics||''),Number(args.expected)||0)};
  case 'set_entity_schema':return {data:await saveEntityType(db,{type:String(args.type),label:String(args.label||''),plural:String(args.plural||''),description:String(args.description||''),schema:json(args.schemaJson,'schemaJson'),topicId,updatedBy:who})};
  case 'set_entity_template':return {data:await saveEntityType(db,{type:String(args.type),label:String(args.label||''),plural:String(args.plural||''),template:json(args.templateJson,'templateJson'),topicId,updatedBy:who})};
  case 'save_recipe':{const steps=json(args.stepsJson,'stepsJson');const problems=checkRecipe(parseSteps(steps));if(problems.length)throw Error('Recipe not saved: '+problems.join(' '));
   const r=await saveRecipe(db,{type:String(args.type),name:String(args.name),description:String(args.description||''),steps,schedule:String(args.schedule||''),createdBy:who});
   return {data:{saved:true,type:r.type,name:r.name,steps:r.steps.length,schedule:r.schedule}};}
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
 if(entityToolNames.includes(name))return runEntityTool(name,args,ctx,signal);
 return runDataTool(name,args,ctx,signal);
}
export {getEntityType,listMetrics};
