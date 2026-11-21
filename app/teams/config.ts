import type {Queryable,Row} from '@/app/entity-db/client';
import {normalizeType} from '@/app/entity-db/repo';
// Topic teams' configuration in the entity database (format: docs/rankwiki-templates.md).
// Editors write templates and ranking definitions, collectors write schemas and recipes; programs read them.

const SLUG=/^[a-z0-9][a-z0-9-]{1,118}[a-z0-9]$/;
const iso=(d:unknown)=>d instanceof Date?d.toISOString():d==null?null:String(d);
const obj=(v:unknown):Row=>v&&typeof v==='object'&&!Array.isArray(v)?v as Row:{};

// ───────────── entity types ─────────────
export type EntityType={type:string;topicId:string|null;label:string;plural:string;description:string;schema:Row;template:Row;status:string;updatedBy:string;updatedAt:string|null};
const typeRow=(r:Row):EntityType=>({type:String(r.type),topicId:r.topic_id?String(r.topic_id):null,label:String(r.label),plural:String(r.plural),description:String(r.description),
 schema:obj(r.schema),template:obj(r.template),status:String(r.status),updatedBy:String(r.updated_by),updatedAt:iso(r.updated_at)});
export const TEMPLATE_SECTIONS=['trend','position','peer_compare','radar_profile','location_map','relations','rankings','timeline','text'] as const;
export function validateTemplate(t:unknown):Row{
 const o=obj(t);if(!Object.keys(o).length)throw Error('The template must be a JSON object (see the format: lead, card, sections).');
 if(o.lead!=null&&(!Array.isArray(o.lead)||o.lead.some(x=>typeof x!=='string')))throw Error('template.lead is a list of sentence patterns.');
 if(o.card!=null&&(!Array.isArray(o.card)||o.card.some(x=>typeof x!=='string')))throw Error('template.card is a list of metric keys or attr./rel. names.');
 if(o.sections!=null){if(!Array.isArray(o.sections))throw Error('template.sections is a list.');
  for(const s of o.sections){const k=obj(s).kind;if(!TEMPLATE_SECTIONS.includes(k as never))throw Error('Unknown section kind "'+String(k)+'"; use '+TEMPLATE_SECTIONS.join(', ')+'.');}}
 return o;
}
export async function saveEntityType(db:Queryable,input:{type:string;label?:string;plural?:string;description?:string;schema?:Row;template?:Row;topicId?:string|null;updatedBy:string;status?:string}):Promise<EntityType>{
 const type=normalizeType(input.type);
 const r=await db.query(`insert into entity_types(type,topic_id,label,plural,description,schema,template,status,updated_by)
  values ($1::text,$2::uuid,$3::text,$4::text,$5::text,coalesce($6::jsonb,'{}'::jsonb),coalesce($7::jsonb,'{}'::jsonb),coalesce($8::text,'draft'),$9::text)
  on conflict (type) do update set topic_id=coalesce(excluded.topic_id,entity_types.topic_id),
   label=case when $3::text<>'' then $3::text else entity_types.label end, plural=case when $4::text<>'' then $4::text else entity_types.plural end,
   description=case when $5::text<>'' then $5::text else entity_types.description end,
   schema=coalesce($6::jsonb,entity_types.schema), template=coalesce($7::jsonb,entity_types.template), status=coalesce($8::text,entity_types.status),
   updated_by=$9::text, updated_at=now() returning *`,
  [type,input.topicId||null,input.label||'',input.plural||'',input.description||'',input.schema?JSON.stringify(input.schema):null,input.template?JSON.stringify(validateTemplate(input.template)):null,input.status||null,input.updatedBy]);
 return typeRow(r.rows[0]);
}
export async function getEntityType(db:Queryable,type:string):Promise<EntityType|null>{
 const r=await db.query('select * from entity_types where type=$1::text',[normalizeType(type)]);return r.rows[0]?typeRow(r.rows[0]):null;
}
export async function listEntityTypes(db:Queryable,topicId?:string|null):Promise<EntityType[]>{
 return (await db.query('select * from entity_types where $1::uuid is null or topic_id=$1::uuid order by type',[topicId||null])).rows.map(typeRow);
}

// ───────────── ranking definitions ─────────────
export type RankingDef={id:string;slug:string;title:string;topicId:string|null;scope:{type?:string;filters?:Row};criteria:string[];config:Row;status:string;updatedAt:string|null};
const rankRow=(r:Row):RankingDef=>({id:String(r.id),slug:String(r.slug),title:String(r.title),topicId:r.topic_id?String(r.topic_id):null,scope:obj(r.scope) as RankingDef['scope'],
 criteria:(r.criteria as string[])||[],config:obj(r.config),status:String(r.status),updatedAt:iso(r.updated_at)});
export async function saveRankingDef(db:Queryable,input:{slug:string;title:string;scope:Row;criteria:string[];config:Row;topicId?:string|null;status?:string}):Promise<RankingDef>{
 const slug=String(input.slug||'').trim().toLowerCase();if(!SLUG.test(slug))throw Error('A ranking slug is lower-case words joined by hyphens, e.g. "country-rankings".');
 const title=String(input.title||'').trim().slice(0,200);if(!/\bRankings\b|排行榜/.test(title))throw Error('Title a ranking "<scope as a singular noun> Rankings", e.g. "Country Rankings".');
 const scope=obj(input.scope);if(typeof scope.type!=='string')throw Error('scope needs a type, e.g. {"type":"country","filters":{}}.');scope.type=normalizeType(scope.type);
 const criteria=[...new Set((input.criteria||[]).map(c=>String(c).trim()).filter(Boolean))];if(!criteria.length||criteria.length>12)throw Error('Give 1–12 criteria (metric keys).');
 const missing=(await db.query<{k:string}>('select k from unnest($1::text[]) k where not exists (select 1 from metrics m where m.key=split_part(k,\'@\',1))',[criteria])).rows.map(r=>r.k);
 if(missing.length)throw Error('Unknown metrics: '+missing.join(', ')+'. Collect them first (the collector defines metrics when loading data).');
 const config=obj(input.config);if(config.default&&!criteria.includes(String(config.default)))throw Error('config.default must be one of the criteria.');
 const r=await db.query(`insert into rankings(slug,title,topic_id,scope,criteria,config,status) values ($1::text,$2::text,$3::uuid,$4::jsonb,$5::text[],$6::jsonb,coalesce($7::text,'draft'))
  on conflict (slug) where slug is not null do update set title=excluded.title, topic_id=coalesce(excluded.topic_id,rankings.topic_id), scope=excluded.scope, criteria=excluded.criteria,
   config=excluded.config, status=coalesce($7::text,rankings.status), updated_at=now() returning *`,
  [slug,title,input.topicId||null,JSON.stringify(scope),criteria,JSON.stringify(config),input.status||null]);
 // Its view vectors no longer describe it: save_ranking embeds it again right away.
 await db.query('delete from ranking_vectors where ranking_id=$1::uuid',[r.rows[0].id]);
 return rankRow(r.rows[0]);
}
export async function getRankingDef(db:Queryable,slug:string):Promise<RankingDef|null>{
 const r=await db.query('select * from rankings where slug=$1::text',[slug]);return r.rows[0]?rankRow(r.rows[0]):null;
}
export async function listRankingDefs(db:Queryable,{type,topicId}:{type?:string;topicId?:string|null}={}):Promise<RankingDef[]>{
 return (await db.query(`select * from rankings where slug is not null and ($1::text is null or scope->>'type'=$1::text) and ($2::uuid is null or topic_id=$2::uuid) order by slug`,[type?normalizeType(type):null,topicId||null])).rows.map(rankRow);
}
export async function setStatus(db:Queryable,what:'ranking'|'type',key:string,status:'draft'|'published'){
 if(what==='ranking')await db.query('update rankings set status=$2::text, updated_at=now() where slug=$1::text',[key,status]);
 else await db.query('update entity_types set status=$2::text, updated_at=now() where type=$1::text',[normalizeType(key),status]);
}

// ───────────── recipes ─────────────
export type Recipe={id:string;type:string;name:string;description:string;steps:Row[];schedule:string;status:string;createdBy:string;lastRunAt:string|null;lastResult:unknown};
const recipeRow=(r:Row):Recipe=>({id:String(r.id),type:String(r.type),name:String(r.name),description:String(r.description),steps:(r.steps as Row[])||[],schedule:String(r.schedule),
 status:String(r.status),createdBy:String(r.created_by),lastRunAt:iso(r.last_run_at),lastResult:r.last_result??null});
export async function saveRecipe(db:Queryable,input:{type:string;name:string;description?:string;steps:Row[];schedule?:string;createdBy:string}):Promise<Recipe>{
 const type=normalizeType(input.type),name=String(input.name||'').trim().toLowerCase();if(!/^[a-z0-9][a-z0-9-]{1,80}$/.test(name))throw Error('A recipe name is lower-case words joined by hyphens.');
 if(!Array.isArray(input.steps)||!input.steps.length||input.steps.length>20)throw Error('A recipe has 1–20 steps.');
 const r=await db.query(`insert into recipes(type,name,description,steps,schedule,created_by) values ($1::text,$2::text,$3::text,$4::jsonb,$5::text,$6::text)
  on conflict (type,name) do update set description=excluded.description, steps=excluded.steps, schedule=excluded.schedule, created_by=excluded.created_by, status='active', updated_at=now() returning *`,
  [type,name,input.description||'',JSON.stringify(input.steps),input.schedule||'',input.createdBy]);
 return recipeRow(r.rows[0]);
}
export async function getRecipe(db:Queryable,type:string,name:string):Promise<Recipe|null>{
 const r=await db.query('select * from recipes where type=$1::text and name=$2::text',[normalizeType(type),name]);return r.rows[0]?recipeRow(r.rows[0]):null;
}
export async function listRecipes(db:Queryable,type?:string):Promise<Recipe[]>{
 return (await db.query('select * from recipes where $1::text is null or type=$1::text order by type,name',[type?normalizeType(type):null])).rows.map(recipeRow);
}
export async function recordRecipeRun(db:Queryable,id:string,ok:boolean,result:unknown){
 await db.query(`update recipes set last_run_at=now(), last_result=$2::jsonb, status=case when $3::boolean then 'active' else 'failed' end, updated_at=now() where id=$1::uuid`,[id,JSON.stringify(result),ok]);
}

// ───────────── team runs (operations log) ─────────────
export async function startTeamRun(db:Queryable,{topicId,role,task}:{topicId:string|null;role:string;task:string}):Promise<string>{
 return String((await db.query<{id:string}>('insert into team_runs(topic_id,role,task) values ($1::uuid,$2::text,$3::text) returning id',[topicId,role,task.slice(0,4000)])).rows[0].id);
}
export async function logTeamCall(db:Queryable,id:string,call:Row){
 await db.query(`update team_runs set calls = calls || jsonb_build_array($2::jsonb) where id=$1::uuid`,[id,JSON.stringify(call).slice(0,20000)]);
}
export async function finishTeamRun(db:Queryable,id:string,{status,summary,costUsd=0}:{status:string;summary:string;costUsd?:number}){
 await db.query('update team_runs set status=$2::text, summary=$3::text, cost_usd=cost_usd+$4::numeric, finished_at=now() where id=$1::uuid',[id,status,summary.slice(0,20000),costUsd]);
}
export async function listTeamRuns(db:Queryable,topicId?:string|null,limit=50){
 return (await db.query(`select id,topic_id,role,task,status,summary,jsonb_array_length(calls) as calls,cost_usd,started_at,finished_at from team_runs
  where $1::uuid is null or topic_id=$1::uuid order by started_at desc limit $2::int`,[topicId||null,limit])).rows;
}
export async function teamRunCalls(db:Queryable,id:string){
 return (await db.query('select calls from team_runs where id=$1::uuid',[id])).rows[0]?.calls??[];
}

// ───────────── topic brief and decisions ─────────────
// The brief (topics.description) says what the topic covers; decisions (topics.scope.decisions) record how the
// team resolved conflicts between the brief, the platform rules and the data — the reviewer judges against
// the rules and these decisions; the manager's rulings are decisions too and bind the team.
export type Decision={at:string;by:string;conflict:string;decision:string;why:string};
export async function topicBrief(db:Queryable,topicId:string){
 const r=(await db.query('select name, description, scope from topics where id=$1::uuid',[topicId])).rows[0];
 return {name:String(r?.name||''),brief:String(r?.description||''),decisions:((obj(r?.scope).decisions as Decision[])||[])};
}
export async function recordDecision(db:Queryable,topicId:string,d:Omit<Decision,'at'>){
 const entry={...d,at:new Date().toISOString()};
 await db.query(`update topics set scope=jsonb_set(scope,'{decisions}',coalesce(scope->'decisions','[]'::jsonb)||jsonb_build_array($2::jsonb)), updated_at=now() where id=$1::uuid`,[topicId,JSON.stringify(entry)]);
 return entry;
}
export async function setTopicBrief(db:Queryable,topicId:string,brief:string){
 await db.query('update topics set description=$2::text, updated_at=now() where id=$1::uuid',[topicId,brief.slice(0,8000)]);
}

// Embeds ranking views that have no vector yet: the ranking as a whole and one per criterion. Saving a ranking
// replaces its vectors at once (save_ranking); the heartbeat fills any that failed.
export function rankingViewTexts(r:{title:string;scope:Row;criteria:string[]},metrics:Map<string,{label:string;unit:string;description:string}>){
 const type=String(obj(r.scope).type||'entity').replace(/_/g,' ');const filters=obj(obj(r.scope).filters);
 const where=Object.keys(filters).length?' where '+Object.entries(filters).map(([k,v])=>k.replace(/_/g,' ')+' is '+(typeof v==='object'?JSON.stringify(v):String(v))).join(', '):'';
 const info=(k:string)=>metrics.get(k.split('@')[0])??{label:k.replace(/_/g,' '),unit:'',description:''};
 const out=[{criterion:'',text:r.title+'. Ranks every '+type+where+' by '+r.criteria.map(k=>info(k).label).join(', ')+'.'}];
 for(const k of r.criteria){const m=info(k);
  out.push({criterion:k,text:r.title+' by '+m.label+'. Every '+type+where+' ranked by '+m.label+(m.unit?' ('+m.unit+')':'')+(m.description?': '+m.description.slice(0,200).replace(/[.\s]+$/,''):'')+'.'});}
 return out;
}
// onlyId: embed just that ranking (right after it is saved).
export async function embedRankings(db:Queryable,embed:(texts:string[])=>Promise<number[][]>,dim:number,limit=50,onlyId?:string){
 const rows=(await db.query<{id:string;title:string;scope:Row;criteria:string[]}>(`select r.id,r.title,r.scope,r.criteria from rankings r
  where r.slug is not null and ($2::uuid is null or r.id=$2::uuid) and not exists (select 1 from ranking_vectors v where v.ranking_id=r.id) limit $1::int`,[limit,onlyId||null])).rows;
 if(!rows.length)return 0;
 const metrics=new Map((await db.query<{key:string;label:string;unit:string;description:string}>('select distinct on (key) key,label,unit,description from metrics order by key,version desc')).rows.map(r=>[r.key,r]));
 for(const r of rows){
  const views=rankingViewTexts(r,metrics);const vecs=await embed(views.map(v=>v.text));
  for(const [i,v] of views.entries()){const e=vecs[i];if(!Array.isArray(e)||e.length!==dim)continue;
   await db.query(`insert into ranking_vectors(ranking_id,criterion,text,embedding) values ($1::uuid,$2::text,$3::text,$4::vector)
    on conflict (ranking_id,criterion) do update set text=excluded.text, embedding=excluded.embedding, created_at=now()`,[r.id,v.criterion,v.text,'['+e.join(',')+']']);}
 }
 return rows.length;
}
