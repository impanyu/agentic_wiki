import {loadDataset,saveDataset,datasetScope} from '@/app/data-tools/datasets';
import type {AgentContext} from '@/app/components-registry/registry';
import {entityDb} from './client';
import {upsertEntities,hybridSearch,getEntity,metricTable,defineMetric,defineDerivedMetric,computeDerivedMetric,sensitivity,embedPending,getMetric,normalizeType,normalizePredicate,promoteAttribute,type EntityMapping,type RelationColumn} from './repo';
import {parseMetricRef} from './metrics';
import {getEmbedder} from './embeddings';
// Agent tools over the entity database (rankwiki). Strict schemas: every property is required;
// "" and 0 mean "not given". JSON-valued arguments are passed as JSON strings.
const tool=(name:string,description:string,properties:Record<string,unknown>)=>({type:'function' as const,name,description,strict:true,parameters:{type:'object',additionalProperties:false,properties,required:Object.keys(properties)}});
const string={type:'string'},integer={type:'integer'};
const FILTERS='filters: JSON object string, "" for none. {"region":"Asia"} matches an attribute (case-insensitive; an array value means any of); {"population":{">":10000000}} compares a metric\'s latest value (or a numeric attribute); operators > >= < <= = != in contains exists; "ids.iso3" matches an identifier; {"rel.brand":"Chanel"} keeps entities related to that entity (a name, QID or "iso3:FRA"; an array means any of); {"rel.located_in+":"Europe"} follows the relation through any number of steps; {"rel.located_in|part_of+":"Europe"} follows any of several relations (a city in a country in Europe).';
export const entityTools=[
 tool('entity_upsert','Load a saved dataset (from fetch_data / extract_tables / query_data) into the entity database: one entity per row, with identifiers, attributes and metric values (observations with unit, period and source). Identity: rows merge into an existing entity when they share a standard id (wikidata QID across all types; iso3, iso2, ticker, isbn… within the type), else the same type and a matching name or alias; names that differ become aliases; attributes are updated; existing ids are never overwritten. Values are stored in base units: give the unit the source uses and it is converted ("million USD" → USD ×1,000,000, "sq mi" → km2, "thousand people" → people, "万人", "亿元"); currencies are never converted into each other. Returns counts {rows, inserted, merged, skipped, observations, relations, unresolved, idConflicts, errors, units (conversions applied)}. type: lower-case singular noun ("country", "city", "football_club"). nameColumn: the column holding the entity name. idColumns: JSON object string id key → column, e.g. \'{"wikidata":"item","iso3":"countryiso3code"}\' ("" none; QIDs are read out of Wikidata URLs). aliasColumns: comma list of columns holding other names ("" none; "a; b" cells are split). descriptionColumn: "" or a column with a short description. attributeColumns: comma list of descriptive columns, "column=key" to rename, e.g. "region,Capital=capital". metricColumns: JSON object string column → {"metric": key, "unit": unit, "period": a period like "2023" or the name of a column holding the year}, e.g. \'{"population":{"metric":"population","unit":"people","period":"year"},"Total in km2 (number)":{"metric":"area_km2","unit":"km2","period":"2023"}}\'. Values are parsed as numbers ("1,234" → 1234); non-numbers are skipped. relationColumns: JSON object string column → {"predicate": relation name, "type": the related entity\'s type, "by": "name" (default) or the id key the cell holds ("wikidata", "iso3"…), "period": "" or a year/column}: the cell names another entity ("a; b" for several) and a relation row subject → predicate → object is stored with the source; a name nothing matches becomes a minimal entity of that type (set "create": false to skip it instead). Where each value goes: every number (price, rating, year, capacity, employees…) → metricColumns, even if nobody ranks by it yet; a link to another entity → relationColumns; a standard code → idColumns; descriptive text (region, notes, colour, website) → attributeColumns. Use relations for links between entities (brand, manufacturer, country, located_in, part_of, member_of, parent_company, author, team), attributes for plain descriptive values. e.g. \'{"brand":{"predicate":"brand","type":"brand"},"countryQid":{"predicate":"country","type":"country","by":"wikidata"}}\' ("" none). source: where the data came from (URL or "World Bank WDI SP.POP.TOTL"), recorded on every observation and relation. topicId: "" or the topic the entities belong to. Example (World Bank population dataset): datasetId "ds_…", type "country", nameColumn "name", idColumns \'{"iso3":"iso3"}\', aliasColumns "", descriptionColumn "", attributeColumns "", metricColumns \'{"population":{"metric":"population","unit":"people","period":"year"}}\', relationColumns "", source "World Bank WDI SP.POP.TOTL", topicId "".',
  {datasetId:string,type:string,nameColumn:string,idColumns:string,aliasColumns:string,descriptionColumn:string,attributeColumns:string,metricColumns:string,relationColumns:string,source:string,topicId:string}),
 tool('entity_search','Search the entity database: meaning (vector similarity, when embeddings are available) + words (full text over names, aliases and descriptions) + name/alias prefix matching, fused by reciprocal rank, restricted by type and filters. Returns entities {id, name, type, aliases, description, ids, attributes, pageId, score, matchedBy}. query: "" lists the entities matching type/filters alphabetically. type: "" for all types. '+FILTERS+' limit: 1–100 (0 = 20). Example: query "island nations in the pacific", type "country", filters \'{"population":{"<":1000000}}\', limit 20.',
  {query:string,type:string,filters:string,limit:integer}),
 tool('entity_get','Read one entity: its fields, identifiers, attributes, latest value of every metric with period, source and its rank among all entities of its type ("rank 4 of 195" — the same numbers metric_table gives a ranking page), its relations (outgoing: brand, country… with the related entity; incoming: e.g. 212 perfumes with brand → this entity, grouped by relation and type, with a sample), plus the history of values. entity: an entity id, a name or alias ("Côte d\'Ivoire"), a Wikidata QID ("Q30") or "key:value" for another identifier ("iso3:USA"). type: "" or the type to disambiguate names ("georgia" country vs. state). Returns null when unknown; other matches are listed in alternatives. Example: entity "iso3:JPN", type "country".',
  {entity:string,type:string}),
 tool('metric_table','Build a ranking-ready table from the entity database and save it as a dataset: one row per entity ranked within the top 1,000 on at least one of the metrics (rankings stop at 1,000; ranks are over the whole scope) with, for each metric, its latest value (or the given period), period, source and competition rank (ties share a rank; missing values have no rank), ordered by the first metric. Columns: rank, entity_id, name, type, [wikidata], then per metric <m>, <m>_rank, <m>_period, <m>_source. Returns the dataset summary plus the metric definitions (label, unit, order, kind, methodology, count = how many entities are ranked) — then save_data it into the ranking page. type: entity type ("" all). '+FILTERS+' metrics: comma list of metric keys, the first decides the order; a derived metric uses its published version, "key@2" a specific one. period: "latest" (or "") for each entity\'s latest value, or a period such as "2022" for exactly that period. Example: type "country", filters \'{"region":"Europe"}\', metrics "gdp_per_capita,population", period "latest", title "European countries by GDP per capita".',
  {type:string,filters:string,metrics:string,period:string,title:string}),
 tool('define_metric','Define or update a public metric. Observed metric (definition ""): a fact pulled from a source. Example: key "population", label "Population", unit "people", order "desc". Derived metric (definition = JSON string): a declarative ranking index computed from other metrics — no code. Example definition: {"inputs":[{"metric":"gdp_per_capita","transform":"log"},{"metric":"life_expectancy"}],"normalize":"minmax","combine":"weighted_sum","weights":[0.5,0.5],"missing":"reweight","min_inputs":1,"scope":{"type":"country","filter":{}}}. inputs[].transform: none | log | per_capita (÷ population) | per_km2 (÷ area_km2) | rank_pct; inputs[].period: "latest" | "same" | a year. normalize: none | minmax | zscore | rank_pct. combine: weighted_sum | weighted_geomean (weights required, one per input; a negative weight means lower is better) | ratio | difference (exactly 2 inputs). missing: skip_entity | reweight | zero. A new derived metric is a draft; compute it with compute_metric and check metric_sensitivity before writing about it. Versioning: key + version is immutable once computed or published — changing unit, order or definition creates the next version (the old one and its values stay as they were); label, description, methodology and format edit in place. methodology: the public explanation shown with the ranking (what, why these inputs and weights, caveats). order: "desc" (higher is better, default) or "asc". format: display hint ("integer", "decimal:1", "percent", "currency:USD", "compact"), "" none. Returns {key, version, status, action}.',
  {key:string,label:string,unit:string,description:string,methodology:string,order:string,format:string,definition:string}),
 tool('compute_metric','Compute a derived metric over its scope from the latest observations of its inputs and store the values (source "derived:<key>@v<version>"), so metric_table, entity_get and ranking pages can use it. Returns {key, version, inScope, computed, skipped (entities lacking inputs), top 10}. version: 0 = the latest version. Example: key "quality_of_life_index", version 0.',
  {key:string,version:integer}),
 tool('metric_sensitivity','Test how robust a derived ranking is: for each weight changed by ±20% and for each input dropped (the others reweighted), how far the top 20 move. Returns {top, scenarios:[{scenario, meanAbsShift, maxAbsShift, topRetained, moved:[{name, from, to}]}], summary} — report this in the ranking\'s methodology section. Nothing is stored. version: 0 = the latest. Example: key "quality_of_life_index", version 0.',
  {key:string,version:integer}),
 tool('promote_attribute','Turn a numeric attribute into a metric: copies attribute <attribute> of every entity of <type> into observations (the attribute stays), so it can be ranked, filtered by value and charted — for a number that was stored as an attribute. Returns {metric, withAttribute, promoted, skipped (not numbers)}. metric: "" = the attribute name as a key. period: "" none, a year like "2024", or another attribute holding the year. source: "" = "attribute:<name>", or the original source. Example: type "restaurant", attribute "michelin_stars", metric "", unit "stars", period "", source "Michelin Guide 2025".',
  {type:string,attribute:string,metric:string,unit:string,period:string,source:string}),
];
export const entityToolNames=entityTools.map(t=>t.name);

const str=(v:unknown,max=4000)=>typeof v==='string'?v.trim().slice(0,max):'';
const list=(v:unknown)=>str(v).split(',').map(s=>s.trim()).filter(Boolean);
function json<T>(v:unknown,what:string):T|undefined{
 const s=str(v,20_000);if(!s)return undefined;
 try{const o=JSON.parse(s);if(!o||typeof o!=='object'||Array.isArray(o))throw 0;return o as T;}catch{throw Error(what+' must be a JSON object string, e.g. '+(what==='filters'?'\'{"region":"Asia"}\'':'\'{"key":"value"}\'')+'.');}
}
// Returns {data} like the other agent tools.
export async function runEntityTool(name:string,args:Record<string,unknown>,ctx:AgentContext,signal?:AbortSignal):Promise<{data:unknown}>{
 signal?.throwIfAborted();
 const db=await entityDb();
 switch(name){
  case 'entity_upsert':{
   const d=await loadDataset(datasetScope(ctx),str(args.datasetId,60));
   const nameColumn=str(args.nameColumn,200);if(!d.columns.includes(nameColumn))throw Error(`Column "${nameColumn}" is not in the dataset (columns: ${d.columns.slice(0,40).join(', ')}).`);
   const idColumns=json<Record<string,string>>(args.idColumns,'idColumns')||{};
   const metricColumns=json<Record<string,{metric:string;unit?:string;period?:string}>>(args.metricColumns,'metricColumns')||{};
   const relationColumns=json<Record<string,RelationColumn>>(args.relationColumns,'relationColumns')||{};
   for(const [col,r] of Object.entries(relationColumns)){if(!r||typeof r.predicate!=='string')throw Error(`relationColumns["${col}"] needs {"predicate": name, "type": entity type}.`);normalizePredicate(r.predicate);if(r.type)normalizeType(r.type);}
   const attributeColumns=list(args.attributeColumns).map(a=>{const [column,key]=a.split('=').map(s=>s.trim());return key?{column,key}:column;});
   const used=[...Object.values(idColumns),...Object.keys(relationColumns),...list(args.aliasColumns),...Object.keys(metricColumns),...attributeColumns.map(a=>typeof a==='string'?a:a.column),...str(args.descriptionColumn)?[str(args.descriptionColumn)]:[]];
   const missing=used.filter(c=>!d.columns.includes(c));if(missing.length)throw Error(`Columns not in the dataset: ${missing.join(', ')} (columns: ${d.columns.slice(0,40).join(', ')}).`);
   for(const [col,m] of Object.entries(metricColumns))if(!m||typeof m.metric!=='string')throw Error(`metricColumns["${col}"] needs {"metric": key}.`);else parseMetricRef(m.metric);
   const mapping:EntityMapping={type:normalizeType(str(args.type,60)),nameColumn,idColumns,aliasColumns:list(args.aliasColumns),descriptionColumn:str(args.descriptionColumn,200)||undefined,attributeColumns,metricColumns,relationColumns,topicId:str(args.topicId,60)||null};
   const r=await upsertEntities(db,d.rows,mapping,{source:str(args.source,500)||d.source});
   if(getEmbedder())void embedPending(db,1000).catch(e=>console.warn('entity-db: embedding failed',(e as Error).message));
   const {entityIds,...counts}=r;
   return {data:{...counts,type:mapping.type,entities:entityIds.length,sampleEntityIds:entityIds.slice(0,5)}};
  }
  case 'entity_search':{
   const r=await hybridSearch(db,{query:str(args.query,500),type:str(args.type,60)||undefined,filters:json(args.filters,'filters'),limit:Number(args.limit)||20});
   return {data:{mode:r.mode,count:r.results.length,results:r.results.map(e=>({...e,aliases:e.aliases.slice(0,6),description:e.description.slice(0,240),attributes:Object.fromEntries(Object.entries(e.attributes).slice(0,15))}))}};
  }
  case 'entity_get':return {data:await getEntity(db,str(args.entity,300),str(args.type,60)||undefined)};
  case 'metric_table':{
   const metrics=list(args.metrics);if(!metrics.length)throw Error('metrics: give at least one metric key, e.g. "population".');
   const t=await metricTable(db,{type:str(args.type,60)||undefined,filters:json(args.filters,'filters'),metrics,period:str(args.period,20)||'latest'});
   const scope=[str(args.type,60)||'all entities',str(args.filters)].filter(Boolean).join(' ');
   const summary=await saveDataset(datasetScope(ctx),{title:str(args.title,200)||`${scope} by ${metrics.join(', ')}`,source:`entity database: metric_table ${scope}; metrics ${t.metrics.map(m=>m.key+'@v'+m.version).join(', ')}; period ${t.period}`,rows:t.rows,
    notes:t.metrics.map(m=>`${m.column}: ${m.label}${m.unit?' ('+m.unit+')':''}, ${m.order==='asc'?'lower is better':'higher is better'}, ${m.kind} v${m.version} ${m.status}, ${m.count} ranked`).join('; ')});
   return {data:{...summary,metrics:t.metrics,period:t.period}};
  }
  case 'define_metric':{
   const order=str(args.order,4);if(order&&order!=='desc'&&order!=='asc')throw Error('order is "desc" (higher is better) or "asc".');
   const input={key:str(args.key,64),label:str(args.label,120),unit:str(args.unit,60),description:str(args.description,2000),methodology:str(args.methodology,8000),order:order as 'desc'|'asc'|'',format:str(args.format,40),createdBy:ctx.agent?.id||'system'};
   const def=str(args.definition,20_000);
   const r=def?await defineDerivedMetric(db,{...input,definition:def}):await defineMetric(db,input);
   return {data:{...r,metric:await getMetric(db,r.key,r.version)}};
  }
  case 'promote_attribute':return {data:await promoteAttribute(db,{type:str(args.type,60),attribute:str(args.attribute,80),metric:str(args.metric,64)||undefined,unit:str(args.unit,60),period:str(args.period,40),source:str(args.source,500)})};
  case 'compute_metric':return {data:await computeDerivedMetric(db,str(args.key,64),Number(args.version)||undefined)};
  case 'metric_sensitivity':return {data:await sensitivity(db,str(args.key,64),Number(args.version)||undefined)};
 }
 throw Error('Unknown entity tool '+name+'.');
}
