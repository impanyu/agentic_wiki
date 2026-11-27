import type {EntityDb,Queryable,Row} from './client';
import {typeFamily} from './dedup';
import {RESERVED_SEGMENTS} from './reserved';
import {GLOBAL_ID_KEYS,storedEmbedDim} from './schema';
import {getEmbedder,toVector,entityText} from './embeddings';
import {normalizeUnit} from './units';
import {METRIC_KEY,DENOMINATORS,parseDefinition,parseMetricRef,evaluateDefinition,competitionRanks,type DerivedDefinition,type EvalData,type Point} from './metrics';
// Repository for the entity database. Every function takes the database (or a transaction) first.
// All SQL is parameterised: user values only ever travel as $n parameters.

class Params{list:unknown[]=[];add(v:unknown){this.list.push(v);return '$'+this.list.length;}}
const UPSERT_LOCK=724_002;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPE=/^[a-z][a-z0-9_]{0,40}$/;
const iso=(d:unknown)=>d instanceof Date?d.toISOString():d==null?null:String(d);
export function normalizePredicate(t:string){const s=String(t||'').trim().toLowerCase().replace(/[\s-]+/g,'_');if(!TYPE.test(s))throw Error('Invalid relation "'+t+'": use a lower-case name like "brand", "country", "part_of", "located_in".');return s;}
export function normalizeType(t:string){const s=String(t||'').trim().toLowerCase().replace(/[\s-]+/g,'_');if(!TYPE.test(s))throw Error('Invalid entity type "'+t+'": use a lower-case noun like "country", "city", "football_club".');return s;}
function stable(v:unknown):string{if(Array.isArray(v))return '['+v.map(stable).join(',')+']';if(v&&typeof v==='object')return '{'+Object.keys(v).filter(k=>(v as Row)[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+stable((v as Row)[k])).join(',')+'}';return JSON.stringify(v);}

// ───────────── values ─────────────
export function parseNumber(v:unknown):number|null{
 if(typeof v==='number')return Number.isFinite(v)?v:null;
 if(typeof v!=='string')return null;
 const s=v.trim().replace(/[−–]/g,'-').replace(/[,\s_ ]/g,'').replace(/%$/,'');
 return /^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(s)?Number(s):null;
}
export function normalizeId(key:string,value:unknown):string|null{
 if(value==null)return null;let s=String(value).trim();if(!s)return null;
 if(key==='wikidata'){const m=/Q\d+/i.exec(s);return m?m[0].toUpperCase():null;}
 if(['iso3','iso2','ticker','isin','lei','iata','icao','fifa'].includes(key))s=s.toUpperCase();
 return s.slice(0,200);
}

// ───────────── entities: identity resolution and upsert ─────────────
export type EntityInput={type:string;name:string;aliases?:string[];description?:string;ids?:Record<string,string>;attributes?:Record<string,unknown>;image?:string;pageId?:string;topicId?:string|null};
export type EntityMapping={type:string;nameColumn:string;idColumns?:Record<string,string>;aliasColumns?:string[];descriptionColumn?:string;imageColumn?:string;
 attributeColumns?:(string|{column:string;key:string})[];metricColumns?:Record<string,{metric:string;unit?:string;period?:string}>;
 relationColumns?:Record<string,RelationColumn>;topicId?:string|null};
// A column naming another entity: "brand" → Chanel. by: "name" (default) or an id key ("wikidata", "iso3"…) the cell holds;
// create: make a minimal entity of `type` when no entity matches a name (default true when type is given and by is "name").
export type RelationColumn={predicate:string;type?:string;by?:string;create?:boolean;period?:string};
export type Provenance={source:string;retrievedAt?:string|Date};
export type UpsertResult={rows:number;inserted:number;merged:number;skipped:number;observations:number;relations:number;unresolved:number;idConflicts:number;errors:string[];entityIds:string[];units:{column:string;from:string;to:string;factor:number}[]};

type Match={id:string;ids:Record<string,string>;tsv:string;t?:string};
// Identity rule:
// 1. any shared standard id (ids keys) → same entity; wikidata matches across types, other keys within the type;
//    when ids point at different entities the first (wikidata first) wins and the conflicting keys are not written;
// 2. else same type and a shared normalised name/alias, unless both carry the same id key with different values;
// 3. else a new entity. Existing ids are never overwritten; aliases are merged; attributes are updated.
// A metric key as a readable label ("race_wins" → "Race wins"): never show a key to readers.
export const keyLabel=(key:string)=>{const s=String(key||'').replace(/_+/g,' ').trim();return s.charAt(0).toUpperCase()+s.slice(1);};
const labelOf=(label:string|undefined,key:string)=>{const l=String(label||'').trim();return !l||l===key||/^[a-z0-9]+(_[a-z0-9]+)+$/.test(l)?keyLabel(key):l;};
// Footnote marks a source table puts after a name ("Lewis Hamilton~", "Ayrton Senna^", "Name†") are not part of it.
export const cleanName=(name:string)=>String(name||'').trim().replace(/(?<=[\p{L}\p{N}).])\s*[~^*†‡§¶]+$/u,'').trim();
async function isAncestor(q:Queryable,maybeAncestor:string,type:string){const {typeChain}=await import('./inherit');return (await typeChain(q,type)).slice(1).some(t=>t.type===maybeAncestor);}
async function recordCandidates(q:Queryable,id:string,name:string,ids:Record<string,string>,family:string[],country:string){
 const others=new Set<string>();
 for(const [k,v] of Object.entries(ids)){for(const r of (await q.query<{id:string}>(`select id from entities where ids @> $1::jsonb and not (type = any($2::text[])) and id<>$3::uuid limit 5`,[JSON.stringify({[k]:v}),family,id])).rows)others.add(r.id+'|id '+k);}
 const n=(await q.query<{id:string;c:string|null}>(`select id, attributes->>'country' c from entities where id<>$1::uuid and not (type = any($2::text[]))
  and ent_norm(name) = ent_norm($3::text)
  limit 8`,[id,family,name])).rows;
 for(const r of n)if(!country||!r.c||r.c===country)others.add(r.id+'|name');
 for(const o of others){const [b,reason]=o.split('|');await q.query(`insert into entity_candidates(a,b,reason) values ($1::uuid,$2::uuid,$3::text) on conflict do nothing`,[id,b,reason]);}
}
// The shape of a code: digits only, letters only, or mixed (after its link prefix).
export function idShape(v:unknown):'digits'|'letters'|'mixed'{const t=String(v??'').trim().replace(/^.*\//,'');return /^\d+$/.test(t)?'digits':/^[a-z]+$/i.test(t)?'letters':'mixed';}
// Two spellings of one code are the same id: "01", "1" and "0400000US01" (a Census GEOID) are FIPS 1; "Q173" and
// "q173" are one Wikidata item. Codes that differ in their number are different ids.
export function sameId(a:unknown,b:unknown):boolean{
 // A link and a bare code are one id too: "https://openlibrary.org/works/OL17732W", "/works/OL17732W", "OL17732W".
 const tail=(v:unknown)=>{const t=String(v??'').trim().replace(/[?#].*$/,'').replace(/\/+$/,'');return t.includes('/')?t.slice(t.lastIndexOf('/')+1):t;};
 const x=tail(a),y=tail(b);if(x===y||x.toLowerCase()===y.toLowerCase())return true;
 const dx=/(\d+)$/.exec(x),dy=/(\d+)$/.exec(y);if(!dx||!dy)return false;
 const strip=(v:string,d:string)=>v.slice(0,v.length-d.length).replace(/^0+/,'');
 // The digits agree as numbers, and one code's prefix is empty or a GEOID-style prefix ("0400000US").
 return Number(dx[1])===Number(dy[1])&&(!strip(x,dx[1])||!strip(y,dy[1])||/US$/i.test(strip(x,dx[1]))||/US$/i.test(strip(y,dy[1])));
}
export async function upsertEntity(q:Queryable,input:EntityInput):Promise<{id:string;action:'inserted'|'merged';idConflicts:number}>{
 // An entity loaded under a tag interface (gaming_laptop) is one of the tag's class (laptop), tagged with it.
 const asType=normalizeType(input.type);const {interfaceClass}=await import('./inherit');const cls=await interfaceClass(q,asType).catch(()=>null);
 if(cls&&cls!==asType){const r=await upsertEntity(q,{...input,type:cls});await q.query(`update entities set also_types=array(select distinct unnest(also_types||$2::text[])) where id=$1::uuid`,[r.id,[asType]]);return r;}
 const type=asType,name=cleanName(String(input.name||'')).slice(0,300);
 if(!name)throw Error('An entity needs a name.');
 const ids:Record<string,string>={};
 for(const [k,v] of Object.entries(input.ids||{})){const key=k.trim().toLowerCase();const n=normalizeId(key,v);if(n&&/^[a-z][a-z0-9_]{0,40}$/.test(key))ids[key]=n;}
 const order=Object.keys(ids).sort((a,b)=>Number(!GLOBAL_ID_KEYS.includes(a as never))-Number(!GLOBAL_ID_KEYS.includes(b as never)));
 let target:Match|null=null;let conflicts=0;const drop=new Set<string>();
 // The type's family (itself, ancestors, descendants, siblings under a specific parent): overlapping topics collect the
 // same things, which must stay one entity (app/entity-db/dedup.ts).
 const family=await typeFamily(q,type).catch(()=>[type]);
 for(const k of order){
  const global=GLOBAL_ID_KEYS.includes(k as never);
  const r=await q.query<Match>('select id, ids, tsv::text as tsv, type t from entities where ids @> $1::jsonb and ($3::boolean or type = any($2::text[])) limit 1',[JSON.stringify({[k]:ids[k]}),family,global]);
  const row=r.rows[0];if(!row)continue;
  if(!target)target=row;else if(row.id!==target.id){drop.add(k);conflicts++;}
 }
 const aliases=(input.aliases||[]).map(a=>String(a).trim().slice(0,300)).filter(Boolean);
 if(!target){
  // Same name in the family; the same country too when both have one (Paris, France is not Paris, Texas).
  const country=String((input.attributes as Record<string,unknown>|undefined)?.country??'').trim();
  const r=await q.query<Match&{c:string|null;t:string}>(`select id, ids, tsv::text as tsv, attributes->>'country' c, type t from entities where type = any($1::text[]) and name_keys && ent_keys($2::text, $3::text[])
   order by (type = $4::text) desc, (ent_norm(name) = ent_norm($2::text)) desc, created_at limit 10`,[family,name,aliases,type]);
  // Another type of the family is the same thing on the name only when both name the same country; otherwise (two
  // films called "Adam") the pair goes to the resolver as a candidate.
  // An id that cannot be the same kind of code as the one already stored (a number where the other is letters:
  // USPS "AL" against "1") is a mislabelled column, not a different thing: it does not stop a same-name match in the
  // same type (it is dropped below).
  const clash=(a:unknown,b:unknown)=>!sameId(a,b)&&idShape(a)===idShape(b);
  target=r.rows.find(row=>!Object.keys(ids).some(k=>row.ids[k]!=null&&(row.t===type?clash(row.ids[k],ids[k]):!sameId(row.ids[k],ids[k])))&&(row.t===type||(!!country&&row.c===country)))||null;
 }
 if(target)for(const k of Object.keys(ids))if(target.ids[k]!=null&&!sameId(target.ids[k],ids[k])&&!drop.has(k)){drop.add(k);conflicts++;}
 const writeIds=Object.fromEntries(Object.entries(ids).filter(([k])=>!drop.has(k)));
 const attributes=Object.fromEntries(Object.entries(input.attributes||{}).filter(([,v])=>v!==undefined&&v!==null&&v!==''));
 const description=String(input.description||'').trim().slice(0,4000),image=String(input.image||'').trim().slice(0,2000),pageId=String(input.pageId||'').trim().slice(0,200);
 const topicId=input.topicId&&UUID.test(input.topicId)?input.topicId:null;
 if(!target){
  const r=await q.query<{id:string}>(`insert into entities(type,name,aliases,description,ids,attributes,image,page_id,topic_id)
   values ($1::text,$2::text,ent_merge_aliases($2::text,$3::text[]),$4::text,$5::jsonb,$6::jsonb,nullif($7::text,''),nullif($8::text,''),$9::uuid) returning id`,
   [type,name,aliases,description,JSON.stringify(writeIds),JSON.stringify(attributes),image,pageId,topicId]);
  // System-wide: anything outside the family that may be the same thing (the same standard id under another type,
  // or the same name) is recorded
  // as a candidate; the resolver (app/entity-db/dedup.ts) judges each pair and merges the same ones.
  await recordCandidates(q,r.rows[0].id,name,ids,[type],String((input.attributes as Record<string,unknown>|undefined)?.country??'')).catch(()=>{});
  return {id:r.rows[0].id,action:'inserted',idConflicts:conflicts};
 }
 const r=await q.query<{tsv:string}>(`update entities set aliases = ent_merge_aliases(name, aliases || $2::text[]), ids = $3::jsonb || ids,
   attributes = attributes || $4::jsonb, description = case when $5::text <> '' then $5::text else description end,
   image = coalesce(nullif($6::text,''), image), page_id = coalesce(page_id, nullif($7::text,'')), topic_id = coalesce(topic_id, $8::uuid), updated_at = now()
   where id = $1::uuid returning tsv::text as tsv`,[target.id,[name,...aliases],JSON.stringify(writeIds),JSON.stringify(attributes),description,image,pageId,topicId]);
 // Text that feeds the embedding changed → re-embed later.
 if(r.rows[0]?.tsv!==target.tsv)await q.query('update entities set embedding = null where id = $1::uuid',[target.id]);
 // The entity found under another type is also one of this type (a research university that is also an Asian
 // university): it joins this type's rankings without a second record.
 // An entity held under a broader class (an organization) loaded now as a more specific one (a university) moves
 // down to that class: an entity is stored under its most specific class, its ancestors follow from the tree.
 if(target.t&&target.t!==type&&await isAncestor(q,target.t,type))await q.query(`update entities set type=$2::text, also_types=array_remove(also_types,$2::text) where id=$1::uuid`,[target.id,type]).catch(()=>{});
 else if(target.t&&target.t!==type&&!(await isAncestor(q,type,target.t)))await q.query(`update entities set also_types=array(select distinct unnest(also_types||$2::text[])) where id=$1::uuid`,[target.id,[type]]).catch(()=>{});
 return {id:target.id,action:'merged',idConflicts:conflicts};
}

const cellText=(v:unknown)=>v==null?'':typeof v==='object'?JSON.stringify(v):String(v).trim();
// Maps dataset rows to entities (+ observations) and upserts them in transactions of 250 rows.
// A bad row is skipped (savepoint) and reported, never aborting the batch.
export async function upsertEntities(db:EntityDb,rows:Row[],mapping:EntityMapping,provenance:Provenance):Promise<UpsertResult>{
 const type=normalizeType(mapping.type);
 // Values are stored in base units: "million USD" → USD ×1e6, "sq mi" → km2, "万人" → people ×1e4 (see units.ts).
 const metricCols=Object.entries(mapping.metricColumns||{}).map(([column,m])=>{const {key}=parseMetricRef(m.metric);const u=normalizeUnit(m.unit||'');return {column,key,unit:u.unit,factor:u.factor,from:m.unit||'',period:m.period||''};});
 const source=String(provenance.source||'').slice(0,500),retrievedAt=iso(provenance.retrievedAt)||new Date().toISOString();
 const out:UpsertResult={rows:rows.length,inserted:0,merged:0,skipped:0,observations:0,relations:0,unresolved:0,idConflicts:0,errors:[],entityIds:[],units:metricCols.filter(m=>m.factor!==1||m.unit!==m.from).map(m=>({column:m.column,from:m.from,to:m.unit,factor:m.factor}))};
 const relCols=Object.entries(mapping.relationColumns||{}).map(([column,r])=>{
  const t=r.type?normalizeType(r.type):undefined,by=(r.by||'name').trim().toLowerCase();
  return {column,predicate:normalizePredicate(r.predicate),type:t,by,create:r.create??(!!t&&by==='name'),period:r.period||''};});
 if(metricCols.length)await ensureObservedMetrics(db,metricCols.map(m=>({key:m.key,unit:m.unit})));
 for(let start=0;start<rows.length;start+=250){
  await db.tx(async q=>{
   // One load per class at a time (two loads of one class would insert the same new entity twice); loads of
   // different classes run side by side — a global lock queued every write of the site behind one slow load.
   await q.query('select pg_advisory_xact_lock($1, hashtext($2::text))',[UPSERT_LOCK+1,type]);
   const obs:ObservationInput[]=[];const rels:RelationInput[]=[];
   for(const [i,row] of rows.slice(start,start+250).entries()){
    const name=cellText(row[mapping.nameColumn]);
    if(!name){out.skipped++;continue;}
    const ids:Record<string,string>={};for(const [k,col] of Object.entries(mapping.idColumns||{})){const v=cellText(row[col]);if(v)ids[k]=v;}
    const aliases=(mapping.aliasColumns||[]).flatMap(c=>{const v=row[c];return Array.isArray(v)?v.map(String):cellText(v).split(/\s*[;|]\s*/);}).filter(Boolean);
    const attributes:Row={};for(const a of mapping.attributeColumns||[]){const {column,key}=typeof a==='string'?{column:a,key:a}:a;const v=row[column];if(v!=null&&v!=='')attributes[key]=typeof v==='string'?v.trim():v;}
    await q.query('savepoint entity_row');
    try{
     const r=await upsertEntity(q,{type,name,aliases,ids,attributes,description:mapping.descriptionColumn?cellText(row[mapping.descriptionColumn]):'',image:mapping.imageColumn?cellText(row[mapping.imageColumn]):'',topicId:mapping.topicId});
     await q.query('release savepoint entity_row');
     out[r.action]++;out.idConflicts+=r.idConflicts;out.entityIds.push(r.id);
     for(const m of metricCols){const raw=parseNumber(row[m.column]);if(raw==null)continue;const value=raw*m.factor;
      const period=m.period&&m.period in row?cellText(row[m.period]):m.period;
      obs.push({entityId:r.id,metric:m.key,value,period,source,retrievedAt});}
     for(const c of relCols){
      const v=row[c.column];const refs=(Array.isArray(v)?v.map(cellText):cellText(v).split(/\s*[;|]\s*/)).filter(Boolean);
      const period=c.period&&c.period in row?cellText(row[c.period]):c.period;
      for(const ref of refs){
       await q.query('savepoint entity_ref');
       try{
        const objectId=await resolveRef(q,ref,{type:c.type,by:c.by,create:c.create});
        await q.query('release savepoint entity_ref');
        if(objectId&&objectId!==r.id)rels.push({subjectId:r.id,predicate:c.predicate,objectId,period,source,retrievedAt});else if(!objectId)out.unresolved++;
       }catch(e){await q.query('rollback to savepoint entity_ref');out.unresolved++;if(out.errors.length<5)out.errors.push('row '+(start+i+1)+' '+c.column+' "'+ref.slice(0,60)+'": '+(e as Error).message);}
      }
     }
    }catch(e){await q.query('rollback to savepoint entity_row');out.skipped++;if(out.errors.length<5)out.errors.push('row '+(start+i+1)+' ('+name.slice(0,60)+'): '+(e as Error).message);}
   }
   out.observations+=await writeObservations(q,obs);
   out.relations+=await writeRelations(q,rels);
  });
 }
 out.entityIds=[...new Set(out.entityIds)];
 await syncLatest(db,out.entityIds,metricCols.map(m=>({key:m.key,version:0})));
 return out;
}

// ───────────── observations ─────────────
export type ObservationInput={entityId:string;metric:string;value:number;period?:string;source?:string;retrievedAt?:string|Date;metricVersion?:number};
async function writeObservations(q:Queryable,list:ObservationInput[]):Promise<number>{
 const byKey=new Map<string,ObservationInput>();// last one wins inside a batch
 // A percentage measure holding a count (a source's estimate column mapped to its percent column) is not written:
 // no share or rate reaches 10,000 % (inflation, interest and other changes can: hyperinflation).
 for(const o of list){if(!UUID.test(o.entityId)||!Number.isFinite(o.value))continue;const key=parseMetricRef(o.metric).key;
  if(/_pct$/.test(key)&&!/inflation|deflator|interest|growth|change|return|yield/.test(key)&&Math.abs(o.value)>1e4)continue;byKey.set([o.entityId,key,o.period||'',o.source||''].join('\u0000'),{...o,metric:key});}
 const rows=[...byKey.values()];if(!rows.length)return 0;
 await q.query(`insert into observations(entity_id,metric,metric_version,value,period,source,retrieved_at)
  select u.e, u.m, u.v, u.x, u.p, u.s, u.t from unnest($1::uuid[], $2::text[], $3::int[], $4::float8[], $5::text[], $6::text[], $7::timestamptz[]) u(e,m,v,x,p,s,t)
  on conflict (entity_id, metric, period, source) do update set value = excluded.value, metric_version = excluded.metric_version, retrieved_at = excluded.retrieved_at`,
  [rows.map(r=>r.entityId),rows.map(r=>r.metric),rows.map(r=>r.metricVersion||0),rows.map(r=>r.value),rows.map(r=>String(r.period||'').slice(0,40)),rows.map(r=>String(r.source||'').slice(0,500)),rows.map(r=>iso(r.retrievedAt)||new Date().toISOString())]);
 return rows.length;
}
// Records facts (unique per entity, metric, period, source; a repeat updates the value). Undefined
// metrics are defined as observed metrics labelled with their key.
export async function recordObservations(db:EntityDb,list:ObservationInput[]):Promise<number>{
 const keys=[...new Set(list.map(o=>parseMetricRef(o.metric).key))];
 await ensureObservedMetrics(db,keys.map(key=>({key,unit:''})));
 const n=await db.tx(q=>writeObservations(q,list));
 await syncLatest(db,list.map(o=>o.entityId),[...new Set(list.map(o=>parseMetricRef(o.metric).key+'\u0000'+(o.metricVersion||0)))].map(k=>{const [key,v]=k.split('\u0000');return {key,version:Number(v)};}));
 return n;
}
async function ensureObservedMetrics(db:Queryable,list:{key:string;unit:string}[]){
 for(const m of list){if(!METRIC_KEY.test(m.key))throw Error('Invalid metric key "'+m.key+'".');
  await db.query(`insert into metrics(key,version,label,unit,kind,created_by,status,used) select $1::text,1,$3::text,$2::text,'observed','system','published',true
   where not exists (select 1 from metrics where key = $1::text)`,[m.key,m.unit,keyLabel(m.key)]);
  await db.query("update metrics set used = true where key = $1::text and kind = 'observed' and not used",[m.key]);}
}

// ───────────── metric definitions (public, versioned) ─────────────
export type MetricDef={key:string;version:number;label:string;unit:string;description:string;methodology:string;order:'desc'|'asc';format:string;kind:'observed'|'derived';definition:DerivedDefinition|null;createdBy:string;status:'draft'|'published'|'retired';used:boolean;createdAt:string|null};
const metricRow=(r:Row):MetricDef=>({key:String(r.key),version:Number(r.version),label:String(r.label),unit:String(r.unit),description:String(r.description),methodology:String(r.methodology),order:r.sort_order==='asc'?'asc':'desc',format:String(r.format),kind:r.kind==='derived'?'derived':'observed',definition:(r.definition as DerivedDefinition)||null,createdBy:String(r.created_by),status:r.status as MetricDef['status'],used:r.used===true,createdAt:iso(r.created_at)});
export async function getMetric(db:Queryable,key:string,version?:number):Promise<MetricDef|null>{
 const r=version?await db.query('select * from metrics where key=$1::text and version=$2::int',[key,version])
  :await db.query("select * from metrics where key=$1::text order by (status='published') desc, version desc limit 1",[key]);
 return r.rows[0]?metricRow(r.rows[0]):null;
}
export async function listMetrics(db:Queryable,{status,kind}:{status?:string;kind?:string}={}):Promise<MetricDef[]>{
 const r=await db.query('select * from metrics where ($1::text is null or status=$1::text) and ($2::text is null or kind=$2::text) order by key, version',[status||null,kind||null]);
 return r.rows.map(metricRow);
}
export type MetricInput={key:string;label?:string;unit?:string;description?:string;methodology?:string;order?:'desc'|'asc'|'';format?:string;createdBy?:string};
type SaveResult={key:string;version:number;status:string;action:'created'|'new_version'|'updated'|'unchanged'};
async function saveMetric(db:EntityDb,input:MetricInput,kind:'observed'|'derived',definition:DerivedDefinition|null):Promise<SaveResult>{
 const key=String(input.key||'').trim();if(!METRIC_KEY.test(key))throw Error('Invalid metric key "'+key+'": lower-case letters, digits and _ (e.g. "gdp_per_capita").');
 return db.tx(async q=>{
  await q.query('select pg_advisory_xact_lock($1, hashtext($2::text))',[UPSERT_LOCK,key]);
  const latest=(await q.query("select * from metrics where key=$1::text order by version desc limit 1",[key])).rows[0];
  const prev=latest?metricRow(latest):null;
  if(prev&&prev.kind!==kind)throw Error(`Metric "${key}" is ${prev.kind}; choose another key for a ${kind} metric.`);
  const next={label:labelOf(input.label?.trim()||prev?.label,key),unit:input.unit??prev?.unit??'',description:input.description??prev?.description??'',methodology:input.methodology??prev?.methodology??'',
   order:/(^|_)year$|^year_|^year$/.test(key)?'asc' as const:input.order||prev?.order||'desc',format:input.format??prev?.format??'',createdBy:input.createdBy||prev?.createdBy||'system'};
  // A measured metric is shared by every type that has it (population of countries, of cities, of US states): once it
  // has data, its wording is not rewritten for one kind of entity. Notes about one type's data belong in that
  // ranking's about text and its sources.
  if(kind==='observed'&&prev?.used){if(prev.description)next.description=prev.description;if(prev.label)next.label=prev.label;if(prev.methodology)next.methodology=prev.methodology;}
  const status=kind==='derived'?'draft':'published';
  const insert=async(version:number)=>{await q.query(`insert into metrics(key,version,label,unit,description,methodology,sort_order,format,kind,definition,created_by,status)
   values ($1::text,$2::int,$3::text,$4::text,$5::text,$6::text,$7::text,$8::text,$9::text,$10::jsonb,$11::text,$12::text)`,
   [key,version,next.label,next.unit,next.description,next.methodology,next.order,next.format,kind,definition?JSON.stringify(definition):null,next.createdBy,status]);return version;};
  if(!prev)return {key,version:await insert(1),status,action:'created'};
  // Meaning = unit, order and (derived) definition. Once a version is used or published its meaning is frozen.
  const sameMeaning=next.unit===prev.unit&&next.order===prev.order&&stable(definition?parseDefinition(definition):null)===stable(prev.definition?parseDefinition(prev.definition):null);
  const frozen=prev.used||prev.status!=='draft';
  if(!sameMeaning&&frozen)return {key,version:await insert(prev.version+1),status,action:'new_version'};
  const presentationSame=next.label===prev.label&&next.description===prev.description&&next.methodology===prev.methodology&&next.format===prev.format;
  if(sameMeaning&&presentationSame)return {key,version:prev.version,status:prev.status,action:'unchanged'};
  await q.query(`update metrics set label=$3::text, unit=$4::text, description=$5::text, methodology=$6::text, sort_order=$7::text, format=$8::text, definition=$9::jsonb, updated_at=now()
   where key=$1::text and version=$2::int`,[key,prev.version,next.label,next.unit,next.description,next.methodology,next.order,next.format,definition?JSON.stringify(definition):null]);
  return {key,version:prev.version,status:prev.status,action:'updated'};
 });
}
// Observed metric (a fact pulled from a source). Presentation fields (label, description, methodology, format)
// update in place; a different unit or order creates the next version.
export const defineMetric=(db:EntityDb,input:MetricInput)=>saveMetric(db,input,'observed',null);
// Derived metric from a declarative definition (see metrics.ts). Starts as a draft; a changed definition,
// unit or order of a used or published version creates the next version.
export async function defineDerivedMetric(db:EntityDb,input:MetricInput&{definition:unknown}):Promise<SaveResult>{
 const def=parseDefinition(input.definition);
 for(const i of def.inputs){const ref=parseMetricRef(i.metric);
  if(ref.key===input.key)throw Error('A derived metric cannot use itself as an input.');
  const m=await getMetric(db,ref.key,i.version??ref.version);
  if(!m&&!(await db.query('select 1 from observations where metric=$1::text limit 1',[ref.key])).rows.length)throw Error(`Input metric "${i.metric}" does not exist (no definition and no observations).`);}
 for(const t of new Set(def.inputs.map(i=>i.transform)))if(t==='per_capita'||t==='per_km2'){const den=DENOMINATORS[t];if(!(await db.query('select 1 from observations where metric=$1::text limit 1',[den])).rows.length)throw Error(`Transform ${t} needs observations of "${den}" first.`);}
 return saveMetric(db,input,'derived',def);
}
// Makes a version the public one; earlier published versions of the key are retired.
export async function publishMetric(db:EntityDb,key:string,version:number):Promise<MetricDef>{
 return db.tx(async q=>{
  const r=await q.query("update metrics set status='published', updated_at=now() where key=$1::text and version=$2::int returning *",[key,version]);
  if(!r.rows[0])throw Error(`Unknown metric ${key}@${version}.`);
  await q.query("update metrics set status='retired', updated_at=now() where key=$1::text and version<>$2::int and status='published'",[key,version]);
  return metricRow(r.rows[0]);
 });
}

// A requested metric resolved to the observations that carry it.
type ResolvedMetric={column:string;key:string;version:number;obsVersion:number;def:MetricDef|null};
async function resolveMetric(q:Queryable,ref:string,version?:number):Promise<ResolvedMetric>{
 const r=parseMetricRef(ref);const v=version??r.version;
 const def=await getMetric(q,r.key,v);
 if(!def){if(v)throw Error(`Unknown metric ${r.key}@${v}.`);return {column:r.key,key:r.key,version:1,obsVersion:0,def:null};}
 return {column:r.version?`${r.key}_v${r.version}`:r.key,key:r.key,version:def.version,obsVersion:def.kind==='derived'?def.version:0,def};
}

// ───────────── relations ─────────────
export type RelationInput={subjectId:string;predicate:string;objectId:string;period?:string;qualifiers?:Row;source?:string;retrievedAt?:string|Date};
// Every entity a reference names: an entity id, a Wikidata QID, "key:value" for another id, or a name/alias (in `type` when given).
export async function findRefs(q:Queryable,ref:string,{type,by='name',limit=20}:{type?:string;by?:string;limit?:number}={}):Promise<string[]>{
 const v=String(ref||'').trim();if(!v)return [];
 const t=type?normalizeType(type):null;
 if(UUID.test(v))return (await q.query<{id:string}>('select id from entities where id = $1::uuid',[v])).rows.map(r=>r.id);
 const kv=/^([a-z][a-z0-9_]{0,40}):(\S.*)$/.exec(v);
 const key=by!=='name'?by:/^Q\d+$/i.test(v)?'wikidata':kv?kv[1]:null;
 if(key){
  const n=normalizeId(key,kv&&by==='name'?kv[2]:v);
  if(n){const r=await q.query<{id:string}>('select id from entities where ids @> $1::jsonb and ($2::text is null or $3::boolean or type = $2::text) limit $4::int',
   [JSON.stringify({[key]:n}),t,GLOBAL_ID_KEYS.includes(key as never),limit]);if(r.rows.length||by!=='name')return r.rows.map(x=>x.id);}
 }
 return (await q.query<{id:string}>(`select id from entities where name_keys && ent_keys($1::text, '{}'::text[]) and ($2::text is null or type = $2::text)
  order by (ent_norm(name) = ent_norm($1::text)) desc, created_at limit $3::int`,[v,t,limit])).rows.map(r=>r.id);
}
// One entity for a reference; with create (and a type), a name nothing matches becomes a new minimal entity.
export async function resolveRef(q:Queryable,ref:string,{type,by='name',create=false}:{type?:string;by?:string;create?:boolean}={}):Promise<string|null>{
 const found=await findRefs(q,ref,{type,by,limit:1});if(found.length)return found[0];
 if(!create||!type||by!=='name')return null;
 const name=String(ref).trim();if(!name||UUID.test(name)||/^Q\d+$/i.test(name))return null;
 return (await upsertEntity(q,{type,name})).id;
}
async function writeRelations(q:Queryable,list:RelationInput[]):Promise<number>{
 const byKey=new Map<string,RelationInput>();
 for(const r of list){if(!UUID.test(r.subjectId)||!UUID.test(r.objectId)||r.subjectId===r.objectId)continue;const predicate=normalizePredicate(r.predicate);byKey.set([r.subjectId,predicate,r.objectId,r.period||''].join('\u0000'),{...r,predicate});}
 const rows=[...byKey.values()];if(!rows.length)return 0;
 await q.query(`insert into relations(subject_id,predicate,object_id,period,qualifiers,source,retrieved_at)
  select u.s, u.p, u.o, u.t, u.q, u.src, u.at from unnest($1::uuid[], $2::text[], $3::uuid[], $4::text[], $5::jsonb[], $6::text[], $7::timestamptz[]) u(s,p,o,t,q,src,at)
  on conflict (subject_id, predicate, object_id, period) do update set qualifiers = excluded.qualifiers, source = excluded.source, retrieved_at = excluded.retrieved_at`,
  [rows.map(r=>r.subjectId),rows.map(r=>r.predicate),rows.map(r=>r.objectId),rows.map(r=>String(r.period||'').slice(0,40)),rows.map(r=>JSON.stringify(r.qualifiers||{})),
   rows.map(r=>String(r.source||'').slice(0,500)),rows.map(r=>iso(r.retrievedAt)||new Date().toISOString())]);
 return rows.length;
}
// Records relations between entities that already exist (ids). A repeat updates source and time.
export async function recordRelations(db:EntityDb,list:RelationInput[]):Promise<number>{
 const n=await db.tx(q=>writeRelations(q,list));
 await syncLatest(db,list.map(r=>r.subjectId),[]);
 return n;
}

// ───────────── scope filters ─────────────
// node: a tree node (slug or id, or several) — its whole subtree, through the closure table.
export type Scope={type?:string;topicId?:string;node?:string|string[];filters?:Record<string,unknown>};
const OPS:Record<string,string>={'>':'>','>=':'>=','<':'<','<=':'<=','=':'=','==':'=','!=':'<>','<>':'<>'};
const latestSql=(p:Params,key:string,obsVersion:number,period?:string)=>`select distinct on (o.entity_id) o.entity_id, o.value, o.period, o.source from observations o
 where o.metric = ${p.add(key)}::text and o.metric_version = ${p.add(obsVersion)}::int${period?` and o.period = ${p.add(period)}::text`:''} order by o.entity_id, o.period desc, o.retrieved_at desc`;
// Filters: {"region":"Asia"} attribute equality (case-insensitive, also matches inside arrays); arrays mean "any of";
// {"population":{">":1e7}} compares a metric's latest value (or a numeric attribute); ops > >= < <= = != in contains exists;
// "ids.wikidata" / "id.iso3" match identifiers; "rel.brand": "Chanel" keeps entities with that relation to the named entity
// (any of, for an array); "rel.located_in+": "Europe" follows the relation transitively; "rel.located_in|part_of+" follows
// any of several relations (a city located_in a country part_of Europe).
// Whether an entity belongs to a scope (type and filters), in one query: a page lists only the rankings it is in.
export async function inScope(db:Queryable,scope:Scope,entityId:string):Promise<boolean>{
 if(!UUID.test(entityId))return false;
 const p=new Params();const where=await scopeSql(db,p,scope);
 const r=await db.query(`select 1 from entities e where ${where} and e.id = ${p.add(entityId)}::uuid limit 1`,p.list);
 return r.rows.length>0;
}
// The measures a scope's members have data for, with how many members have each (most covered first): a ranking
// offers every measure enough of its members have, beyond the criteria it was set up with.
export async function scopeMetricCoverage(db:Queryable,scope:Scope,{minShare=0.3,min=3,limit=120}:{minShare?:number;min?:number;limit?:number}={}):Promise<{members:number;metrics:{key:string;count:number}[]}>{
 const p=new Params();const where=await scopeSql(db,p,scope);
 const r=await db.query<{key:string;k:number;n:number}>(`with ents as (select e.id from entities e where ${where}), n as (select count(*)::int n from ents)
  select o.metric as key, count(distinct o.entity_id)::int k, (select n from n) n from observations o join ents on ents.id = o.entity_id
  where o.metric in (select key from metrics where status = 'published')
  group by o.metric having count(distinct o.entity_id) >= greatest(${p.add(min)}::int, ceil((select n from n) * ${p.add(minShare)}::float8)) order by 2 desc limit ${Math.max(1,Math.min(500,limit))}`,p.list);
 return {members:r.rows[0]?.n||0,metrics:r.rows.map(x=>({key:x.key,count:x.k}))};
}
// The ids of the entities in a scope (type and filters), at most `limit`.
export async function entitySearchIds(db:Queryable,scope:Scope,limit=5000):Promise<string[]>{
 const p=new Params();const where=await scopeSql(db,p,scope);
 return (await db.query<{id:string}>(`select e.id from entities e where ${where} limit ${Math.max(1,Math.min(20000,Math.floor(limit)))}`,p.list)).rows.map(r=>r.id);
}
async function scopeSql(q:Queryable,p:Params,scope:Scope,a='e'):Promise<string>{
 const parts:string[]=['true'];
 // A type includes its subtypes (types that extend it): a ranking of a type ranks every entity that is one.
 if(scope.type){const {withSubtypes}=await import('./inherit');const tp=p.add(await withSubtypes(q,normalizeType(scope.type)));parts.push(`(${a}.type = any(${tp}::text[]) or ${a}.also_types && ${tp}::text[])`);}
 if(scope.topicId){if(!UUID.test(scope.topicId))throw Error('Invalid topicId.');parts.push(`${a}.topic_id = ${p.add(scope.topicId)}::uuid`);}
 if(scope.node){const ns=(Array.isArray(scope.node)?scope.node:[scope.node]).map(String).filter(Boolean).slice(0,50);
  parts.push(`${a}.node_id in (select c.descendant from topic_closure c join topics t on t.id = c.ancestor where t.slug = any(${p.add(ns)}::text[]) or t.id::text = any(${p.add(ns)}::text[]))`);}
 const entries=Object.entries(scope.filters||{});
 if(!entries.length)return parts.join(' and ');
 const keys=entries.map(([k])=>k).filter(k=>/^[a-z][a-z0-9_]{0,63}(@\d+)?$/.test(k));
 const metricKeys=new Set(keys.length?(await q.query<{k:string}>('select key as k from metrics where key = any($1::text[]) union select metric from observations where metric = any($1::text[])',[keys.map(k=>parseMetricRef(k).key)])).rows.map(r=>r.k):[]);
 for(const [rawKey,cond] of entries){
  const key=rawKey.trim();if(!key||key.length>80)throw Error('Invalid filter key "'+rawKey+'".');
  if(key==='type'){parts.push(`${a}.type = ${p.add(normalizeType(String(cond)))}::text`);continue;}
  const rel=/^rel\.([a-z][a-z0-9_]{0,40}(?:\|[a-z][a-z0-9_]{0,40}){0,4})(\+?)$/.exec(key);
  if(rel){
   const refs=(Array.isArray(cond)?cond:[cond]).map(v=>String(v));
   const ids=[...new Set((await Promise.all(refs.map(v=>findRefs(q,v)))).flat())];
   if(!ids.length){parts.push('false');continue;}
   const pr=p.add(rel[1].split('|')),ip=p.add(ids);
   parts.push(rel[2]?`${a}.id in (with recursive t(id) as (select unnest(${ip}::uuid[]) union select r.subject_id from relations r join t on r.object_id = t.id where r.predicate = any(${pr}::text[])) select id from t where not (id = any(${ip}::uuid[])))`
    :`${a}.id in (select r.subject_id from relations r where r.predicate = any(${pr}::text[]) and r.object_id = any(${ip}::uuid[]))`);
   continue;
  }
  const idKey=/^ids?\.([a-z][a-z0-9_]{0,40})$/.exec(key);
  if(idKey){const vals=(Array.isArray(cond)?cond:[cond]).map(v=>normalizeId(idKey[1],v)).filter(Boolean);parts.push(`${a}.ids->>${p.add(idKey[1])}::text = any(${p.add(vals)}::text[])`);continue;}
  const conds:[string,unknown][]=cond&&typeof cond==='object'&&!Array.isArray(cond)?Object.entries(cond as Row):[[Array.isArray(cond)?'in':'=',cond]];
  const isMetric=/^[a-z][a-z0-9_]{0,63}(@\d+)?$/.test(key)&&metricKeys.has(parseMetricRef(key).key);
  let metricSrc='';
  if(isMetric){const m=await resolveMetric(q,key);metricSrc=latestSql(p,m.key,m.obsVersion);}
  for(const [op,val] of conds){
   if(isMetric){
    if(op==='exists'){parts.push(`${val===false?'not ':''}exists (select 1 from (${metricSrc}) l where l.entity_id = ${a}.id)`);continue;}
    if(op==='in'){parts.push(`${a}.id in (select l.entity_id from (${metricSrc}) l where l.value = any(${p.add((Array.isArray(val)?val:[val]).map(parseNumber).filter(n=>n!=null))}::float8[]))`);continue;}
    const sqlOp=OPS[op];const n=parseNumber(val);if(!sqlOp||n==null)throw Error(`Filter ${key}: use {">": number} style comparisons (ops > >= < <= = !=).`);
    parts.push(`${a}.id in (select l.entity_id from (${metricSrc}) l where l.value ${sqlOp} ${p.add(n)}::float8)`);continue;
   }
   const k=p.add(key);
   if(op==='exists'){parts.push(`${val===false?'not ':''}(${a}.attributes ? ${k}::text)`);continue;}
   if(op==='contains'){parts.push(`${a}.attributes->>${k}::text ilike ${p.add('%'+String(val).replace(/[\\%_]/g,m=>'\\'+m)+'%')}::text`);continue;}
   if(op==='in'||op==='='||op==='=='){
    const vals=Array.isArray(val)?val:[val];
    const nums=vals.filter(v=>typeof v==='number'),strs=vals.filter(v=>typeof v!=='number').map(v=>String(v));
    const or:string[]=[];
    if(strs.length){const s=p.add(strs),sl=p.add(strs.map(x=>x.toLowerCase()));or.push(`lower(${a}.attributes->>${k}::text) = any(${sl}::text[])`,`(jsonb_typeof(${a}.attributes->${k}::text) = 'array' and ${a}.attributes->${k}::text ?| ${s}::text[])`);}
    if(nums.length)or.push(`ent_num(${a}.attributes->>${k}::text) = any(${p.add(nums)}::float8[])`);
    parts.push(or.length?'('+or.join(' or ')+')':'false');continue;
   }
   if(op==='!='||op==='<>'){parts.push(typeof val==='number'?`ent_num(${a}.attributes->>${k}::text) is distinct from ${p.add(val)}::float8`:`lower(${a}.attributes->>${k}::text) is distinct from lower(${p.add(String(val))}::text)`);continue;}
   const sqlOp=OPS[op];const n=parseNumber(val);
   if(!sqlOp||n==null)throw Error(`Filter ${key}: unknown operator "${op}" (use > >= < <= = != in contains exists).`);
   parts.push(`ent_num(${a}.attributes->>${k}::text) ${sqlOp} ${p.add(n)}::float8`);
  }
 }
 return parts.join(' and ');
}

// ───────────── search ─────────────
export type EntitySummary={id:string;name:string;type:string;aliases:string[];description:string;ids:Record<string,string>;attributes:Row;image:string|null;pageId:string|null;topicId:string|null};
const ENTITY_COLS='e.id, e.name, e.type, e.aliases, e.description, e.ids, e.attributes, e.image, e.page_id, e.topic_id';
const entityRow=(r:Row):EntitySummary=>({id:String(r.id),name:String(r.name),type:String(r.type),aliases:(r.aliases as string[])||[],description:String(r.description||''),ids:(r.ids as Record<string,string>)||{},attributes:(r.attributes as Row)||{},image:(r.image as string)||null,pageId:(r.page_id as string)||null,topicId:(r.topic_id as string)||null});
export type SearchHit=EntitySummary&{score:number;matchedBy:string[]};
const RRF_K=60;
const words=(s:string)=>(s.toLowerCase().match(/[\p{L}\p{N}]+/gu)||[]).slice(0,12);
// Hybrid search: vector KNN (when an embedder is configured), full text ('simple' tsvector, prefix
// matching on every word, OR-ed) and name/alias matching, each restricted by the scope filters, fused by
// reciprocal rank (score = Σ 1/(60+rank)). With no query, returns the filtered entities by name.
export async function hybridSearch(db:Queryable,{query='',type,topicId,filters,limit=20}:{query?:string;type?:string;topicId?:string;filters?:Record<string,unknown>;limit?:number}):Promise<{mode:string;results:SearchHit[]}>{
 const lim=Math.min(100,Math.max(1,Math.floor(limit)||20)),k=Math.max(50,lim*4),text=String(query||'').trim().slice(0,500);
 const lists:{name:string;ids:string[]}[]=[];
 const run=async(name:string,build:(p:Params,where:string)=>string)=>{const p=new Params();const where=await scopeSql(db,p,{type,topicId,filters});lists.push({name,ids:(await db.query<{id:string}>(build(p,where),p.list)).rows.map(r=>r.id)});};
 if(!text){
  const p=new Params();const where=await scopeSql(db,p,{type,topicId,filters});
  const r=await db.query(`select ${ENTITY_COLS} from entities e where ${where} order by e.name limit ${p.add(lim)}::int`,p.list);
  return {mode:'filter',results:r.rows.map(x=>({...entityRow(x),score:0,matchedBy:['filter']}))};
 }
 const embed=getEmbedder();let mode='text';
 if(embed){
  try{const dim=await storedEmbedDim(db);const [v]=await embed([text]);const vec=toVector(v,dim);
   await run('vector',(p,where)=>`select e.id from entities e where ${where} and e.embedding is not null order by e.embedding <=> ${p.add(vec)}::vector limit ${p.add(k)}::int`);mode='hybrid';
  }catch(e){console.warn('entity-db: query embedding failed, using text search',(e as Error).message);}
 }
 const w=words(text);
 if(w.length)await run('text',(p,where)=>`select e.id from entities e, to_tsquery('simple', ${p.add(w.map(x=>x+':*').join(' | '))}::text) tq
   where ${where} and e.tsv @@ tq order by ts_rank_cd(e.tsv, tq) desc, e.name limit ${p.add(k)}::int`);
 await run('name',(p,where)=>{const t=p.add(text);const prefix=p.add(text.toLowerCase().replace(/[\\%_]/g,m=>'\\'+m)+'%');
  return `select e.id from entities e where ${where} and (e.name_keys && ent_keys(${t}::text, '{}'::text[]) or exists (select 1 from unnest(e.name_keys) nk where nk like ${prefix}::text))
   order by (ent_norm(e.name) = ent_norm(${t}::text)) desc, (e.name_keys && ent_keys(${t}::text, '{}'::text[])) desc, length(e.name), e.name limit ${p.add(k)}::int`;});
 const scores=new Map<string,{score:number;by:string[]}>();
 for(const l of lists)l.ids.forEach((id,i)=>{const s=scores.get(id)||{score:0,by:[]};s.score+=1/(RRF_K+i+1);s.by.push(l.name);scores.set(id,s);});
 const top=[...scores].sort((a,b)=>b[1].score-a[1].score).slice(0,lim);
 if(!top.length)return {mode,results:[]};
 const r=await db.query(`select ${ENTITY_COLS} from entities e where e.id = any($1::uuid[])`,[top.map(([id])=>id)]);
 const byId=new Map(r.rows.map(x=>[String(x.id),entityRow(x)]));
 return {mode,results:top.flatMap(([id,s])=>byId.has(id)?[{...byId.get(id)!,score:Math.round(s.score*1e5)/1e5,matchedBy:s.by}]:[])};
}

// ───────────── metric tables (ranking-ready) ─────────────
export type MetricColumn={column:string;key:string;version:number;kind:string;label:string;unit:string;order:'desc'|'asc';format:string;status:string;methodology:string;count:number};
export type MetricTable={metrics:MetricColumn[];rows:Row[];period:string};
// One row per entity in scope that has at least one of the metrics: each metric's latest value (or the
// value for the given period), its period and source, and its competition rank among the scope
// (ties share a rank; entities without a value have no rank). Rows are ordered by the first metric.
// Derived metrics resolve to their published (else latest) version, or "key@N" for a specific one.
// Rankings stop at RANK_LIMIT: rows are the entities ranked within the top RANK_LIMIT on at least one of the
// metrics (ranks are computed over the whole scope, so every listed rank is exact).
export const RANK_LIMIT=1000;
export async function metricTable(db:Queryable,{type,topicId,filters,metrics,period='latest',limit=RANK_LIMIT}:{type?:string;topicId?:string;filters?:Record<string,unknown>;metrics:string[];period?:string;limit?:number}):Promise<MetricTable>{
 if(!metrics.length)throw Error('Name at least one metric.');if(metrics.length>12)throw Error('At most 12 metrics per table.');
 if(period==='all')return metricHistoryTable(db,{type,topicId,filters,metrics,limit});
 const resolved:ResolvedMetric[]=[];for(const m of metrics)resolved.push(await resolveMetric(db,m));
 const per=period&&period!=='latest'?String(period):'';
 const p=new Params();const where=await scopeSql(db,p,{type,topicId,filters});
 const keys=p.add(resolved.map(m=>m.key)),vers=p.add(resolved.map(m=>m.obsVersion)),dirs=p.add(resolved.map(m=>m.def?.order||'desc')),cols=p.add(resolved.map(m=>m.column));
 const r=await db.query(`with ents as (select e.id, e.name, e.type, e.ids from entities e where ${where}),
  wanted as (select * from unnest(${keys}::text[], ${vers}::int[], ${dirs}::text[], ${cols}::text[]) w(key, ver, dir, col)),
  obs as (select distinct on (o.entity_id, w.col) o.entity_id, w.col, w.dir, o.value, o.period, o.source
   from observations o join ents on ents.id = o.entity_id join wanted w on w.key = o.metric and w.ver = o.metric_version
   ${per?`where o.period = ${p.add(per)}::text`:''} order by o.entity_id, w.col, o.period desc, o.retrieved_at desc)
  select obs.entity_id, obs.col, obs.value, obs.period, obs.source, ents.name, ents.type, ents.ids,
   rank() over (partition by obs.col order by case when obs.dir = 'asc' then obs.value else -obs.value end) as rnk,
   count(*) over (partition by obs.col) as cnt
  from obs join ents on ents.id = obs.entity_id`,p.list);
 const rows=new Map<string,Row>();const counts=new Map<string,number>();
 for(const x of r.rows){const id=String(x.entity_id);let row=rows.get(id);
  if(!row){row={rank:null,entity_id:id,name:x.name,type:x.type};const wd=(x.ids as Row)?.wikidata;if(wd)row.wikidata=wd;rows.set(id,row);}
  const c=String(x.col);row[c]=Number(x.value);row[c+'_rank']=Number(x.rnk);row[c+'_period']=x.period;row[c+'_source']=x.source;counts.set(c,Number(x.cnt));}
 const first=resolved[0].column;
 let list=[...rows.values()].map(row=>{for(const m of resolved)if(!(m.column in row)){row[m.column]=null;row[m.column+'_rank']=null;row[m.column+'_period']=null;row[m.column+'_source']=null;}row.rank=row[first+'_rank'];return row;});
 if(limit>0)list=list.filter(row=>resolved.some(m=>{const r=row[m.column+'_rank'];return typeof r==='number'&&r<=limit;}));
 list.sort((a,b)=>(a.rank==null?1e15:Number(a.rank))-(b.rank==null?1e15:Number(b.rank))||String(a.name).localeCompare(String(b.name)));
 return {period:per||'latest',rows:list,metrics:resolved.map(m=>({column:m.column,key:m.key,version:m.version,kind:m.def?.kind||'observed',label:m.def?.label||m.key,unit:m.def?.unit||'',order:m.def?.order||'desc',format:m.def?.format||'',status:m.def?.status||'published',methodology:m.def?.methodology||'',count:counts.get(m.column)||0}))};
}

// ───────────── derived metrics: compute and sensitivity ─────────────
async function loadEvalData(db:Queryable,def:DerivedDefinition,period:string):Promise<{data:EvalData;entities:Map<string,string>}>{
 const p0=new Params();const where=await scopeSql(db,p0,{type:def.scope.type,filters:def.scope.filter as Record<string,unknown>|undefined});
 const ents=await db.query<{id:string;name:string}>(`select e.id, e.name from entities e where ${where}`,p0.list);
 const entities=new Map(ents.rows.map(r=>[r.id,r.name]));const idList=[...entities.keys()];
 const latest=async(key:string,obsVersion:number,per:string):Promise<Map<string,Point>>=>{
  const p=new Params();const src=latestSql(p,key,obsVersion,per||undefined);
  const r=await db.query<{entity_id:string;value:number;period:string}>(`select l.entity_id, l.value, l.period from (${src}) l where l.entity_id = any(${p.add(idList)}::uuid[])`,p.list);
  return new Map(r.rows.map(x=>[x.entity_id,{value:Number(x.value),period:String(x.period)}]));};
 const inputs:Map<string,Point>[]=[];
 for(const i of def.inputs){const m=await resolveMetric(db,i.metric,i.version);
  const per=i.period==='latest'?'':i.period==='same'?(period==='latest'?'':period):i.period;
  inputs.push(await latest(m.key,m.obsVersion,per));}
 const needs=new Set(def.inputs.map(i=>i.transform));
 const denominators={population:needs.has('per_capita')?await latest(DENOMINATORS.per_capita,0,''):new Map<string,Point>(),area_km2:needs.has('per_km2')?await latest(DENOMINATORS.per_km2,0,''):new Map<string,Point>()};
 return {data:{inputs,denominators},entities};
}
async function derivedMetric(db:Queryable,key:string,version?:number):Promise<MetricDef&{definition:DerivedDefinition}>{
 const m=await getMetric(db,key,version);
 if(!m)throw Error(`Unknown metric ${key}${version?'@'+version:''}.`);
 if(m.kind!=='derived'||!m.definition)throw Error(`${key} is an observed metric; only derived metrics are computed.`);
 return {...m,definition:parseDefinition(m.definition)};
}
export const derivedSource=(key:string,version:number)=>`derived:${key}@v${version}`;
// Evaluates a derived metric over its scope and stores the values as observations (source
// 'derived:<key>@v<version>', metric_version = version). period 'latest' uses each entity's latest
// inputs (stored under the latest input period); a year uses that period for inputs marked "same".
// A recompute replaces earlier values of the same period (all periods for 'latest').
export async function computeDerivedMetric(db:EntityDb,key:string,version?:number,{period='latest'}:{period?:string}={}){
 const m=await derivedMetric(db,key,version);
 const {data,entities}=await loadEvalData(db,m.definition,period);
 const values=evaluateDefinition(m.definition,data);
 const source=derivedSource(m.key,m.version);
 const per=period&&period!=='latest'?period:'';
 const written=await db.tx(async q=>{
  await q.query(`delete from observations where source = $1::text and metric = $2::text${per?' and period = $3::text':''}`,per?[source,m.key,per]:[source,m.key]);
  const n=await writeObservations(q,[...values].map(([entityId,v])=>({entityId,metric:m.key,metricVersion:m.version,value:v.value,period:per||v.period,source})));
  await q.query('update metrics set used = true, updated_at = now() where key = $1::text and version = $2::int',[m.key,m.version]);
  return n;
 });
 await syncLatest(db,[...entities.keys()],[{key:m.key,version:m.version}]);
 const ranks=competitionRanks(values,m.order);
 const top=[...ranks].sort((a,b)=>a[1]-b[1]).slice(0,10).map(([id,rank])=>({rank,name:entities.get(id),value:Math.round(values.get(id)!.value*1e6)/1e6}));
 return {key:m.key,version:m.version,status:m.status,source,period:per||'latest',inScope:entities.size,computed:written,skipped:entities.size-values.size,top};
}
// Robustness of a derived ranking: how the top 20 move when each weight is ±20% and when each input
// is dropped (the rest reweighted). Nothing is stored.
export async function sensitivity(db:Queryable,key:string,version?:number,{period='latest',top:topN=20}:{period?:string;top?:number}={}){
 const m=await derivedMetric(db,key,version);const def=m.definition;
 const {data,entities}=await loadEvalData(db,def,period);
 const base=evaluateDefinition(def,data);const baseRanks=competitionRanks(base,m.order);
 const top=[...baseRanks].sort((a,b)=>a[1]-b[1]).slice(0,topN);
 const label=(i:number)=>def.inputs[i].label||def.inputs[i].metric+(def.inputs[i].transform!=='none'?' ('+def.inputs[i].transform+')':'');
 const scenario=(name:string,kind:string,input:number,factor:number|null,opts:{weights?:number[];drop?:number})=>{
  const vals=evaluateDefinition(def,data,opts.drop!=null?{drop:opts.drop}:{weights:opts.weights});
  const ranks=competitionRanks(vals,m.order);
  const moves=top.map(([id,from])=>({name:entities.get(id)||id,from,to:ranks.get(id)??null}));
  const shifts=moves.map(x=>x.to==null?topN:Math.abs(x.to-x.from));
  return {scenario:name,kind,input:def.inputs[input].metric,inputLabel:label(input),factor,
   meanAbsShift:Math.round(shifts.reduce((a,b)=>a+b,0)/Math.max(1,shifts.length)*100)/100,maxAbsShift:Math.max(0,...shifts),
   topRetained:moves.filter(x=>x.to!=null&&x.to<=topN).length,
   moved:moves.filter(x=>x.to!==x.from).sort((a,b)=>(b.to==null?1e9:Math.abs(b.to-b.from))-(a.to==null?1e9:Math.abs(a.to-a.from))).slice(0,5)};
 };
 const scenarios:ReturnType<typeof scenario>[]=[];
 const weighted=def.combine==='weighted_sum'||def.combine==='weighted_geomean';
 if(weighted&&def.weights)def.weights.forEach((w,i)=>{if(w===0)return;for(const f of [1.2,0.8]){const ws=[...def.weights!];ws[i]=w*f;scenarios.push(scenario(`${label(i)} weight ${f>1?'+':'-'}20%`,'weight',i,f,{weights:ws}));}});
 if(weighted&&def.inputs.length>1)def.inputs.forEach((_,i)=>scenarios.push(scenario(`without ${label(i)}`,'drop',i,null,{drop:i})));
 const worst=scenarios.reduce<ReturnType<typeof scenario>|null>((a,b)=>!a||b.meanAbsShift>a.meanAbsShift?b:a,null);
 const weightMax=Math.max(0,...scenarios.filter(s=>s.kind==='weight').map(s=>s.maxAbsShift));
 return {key:m.key,version:m.version,period,entities:base.size,
  top:top.map(([id,rank])=>({entityId:id,name:entities.get(id),rank,value:Math.round(base.get(id)!.value*1e6)/1e6})),
  scenarios,
  summary:!scenarios.length?'Not applicable: '+def.combine+' has no weights to vary.'
   :`Across ${scenarios.length} scenarios the top ${top.length} moved by at most ${weightMax} places for ±20% weight changes; the most influential change is "${worst!.scenario}" (mean shift ${worst!.meanAbsShift}, ${worst!.topRetained}/${top.length} stay in the top ${topN}).`};
}

// ───────────── entity detail ─────────────
export async function getEntity(db:Queryable,idOrName:string,type?:string){
 const s=String(idOrName||'').trim();if(!s)throw Error('Name an entity (id, name, or a standard id such as "Q30" or "iso3:USA").');
 let rows:Row[];const t=type?normalizeType(type):null;
 const idMatch=/^([a-z][a-z0-9_]{0,40}):(.+)$/.exec(s);
 if(UUID.test(s))rows=(await db.query(`select ${ENTITY_COLS} from entities e where e.id = $1::uuid`,[s])).rows;
 else if(/^Q\d+$/i.test(s))rows=(await db.query(`select ${ENTITY_COLS} from entities e where e.ids @> $1::jsonb`,[JSON.stringify({wikidata:s.toUpperCase()})])).rows;
 else if(idMatch&&!/\s/.test(idMatch[1]))rows=(await db.query(`select ${ENTITY_COLS} from entities e where e.ids @> $1::jsonb and ($2::text is null or e.type = $2::text)`,[JSON.stringify({[idMatch[1]]:normalizeId(idMatch[1],idMatch[2])}),t])).rows;
 else rows=[];
 if(!rows.length)rows=(await db.query(`select ${ENTITY_COLS} from entities e where e.name_keys && ent_keys($1::text, '{}'::text[]) and ($2::text is null or e.type = $2::text)
  order by (ent_norm(e.name) = ent_norm($1::text)) desc, e.created_at limit 6`,[s,t])).rows;
 if(!rows.length)return null;
 const e=entityRow(rows[0]);
 const latest=await db.query(`select distinct on (o.metric, o.metric_version) o.metric, o.metric_version, o.value, o.period, o.source, o.retrieved_at, d.label, d.unit, d.format, d.kind
  from observations o left join lateral (select label, unit, format, kind from metrics m where m.key = o.metric and (o.metric_version = 0 or m.version = o.metric_version) order by m.version desc limit 1) d on true
  where o.entity_id = $1::uuid order by o.metric, o.metric_version, o.period desc, o.retrieved_at desc`,[e.id]);
 const refs=latest.rows.slice(0,12).map(o=>Number(o.metric_version)?`${o.metric}@${o.metric_version}`:String(o.metric));
 const table=refs.length?await metricTable(db,{type:e.type,metrics:refs}):null;
 const rankRow=table?.rows.find(r=>r.entity_id===e.id);
 const history=await db.query(`select metric, metric_version, period, value, source from observations where entity_id = $1::uuid order by metric, period desc, retrieved_at desc limit 300`,[e.id]);
 return {...e,
  facts:latest.rows.map((o,i)=>{const col=i<12?table!.metrics[i].column:'';return {metric:o.metric,version:Number(o.metric_version)||undefined,label:o.label||o.metric,unit:o.unit||'',format:o.format||'',kind:o.kind||'observed',
   value:Number(o.value),period:o.period,source:o.source,retrievedAt:iso(o.retrieved_at),
   ...(col&&rankRow?.[col+'_rank']!=null?{rank:rankRow[col+'_rank'],of:table!.metrics[i].count,rankScope:'all '+e.type.replace(/_/g,' ')+' entities, latest values'}:{})};}),
  relations:await entityRelations(db,e.id),
  history:history.rows.map(h=>({metric:h.metric,version:Number(h.metric_version)||undefined,period:h.period,value:Number(h.value),source:h.source})),
  alternatives:rows.slice(1).map(r=>({id:r.id,name:r.name,type:r.type}))};
}

// Outgoing relations (Chanel No. 5 → brand → Chanel) and incoming ones grouped by predicate and type (Chanel ← brand ← 212 perfumes).
export async function entityRelations(db:Queryable,id:string){
 const out=await db.query(`select r.predicate, r.period, r.source, r.qualifiers, o.id, o.name, o.type from relations r join entities o on o.id = r.object_id
  where r.subject_id = $1::uuid order by r.predicate, r.period desc, o.name limit 200`,[id]);
 const inc=await db.query(`select r.predicate, s.type, count(*)::int as n, jsonb_path_query_array(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) order by s.name), '$[0 to 9]') as sample
  from relations r join entities s on s.id = r.subject_id where r.object_id = $1::uuid group by r.predicate, s.type order by n desc, r.predicate limit 50`,[id]);
 return {outgoing:out.rows.map(r=>({predicate:r.predicate,object:{id:r.id,name:r.name,type:r.type},period:r.period,source:r.source,qualifiers:r.qualifiers||{}})),
  incoming:inc.rows.map(r=>({predicate:r.predicate,type:r.type,count:Number(r.n),sample:r.sample}))};
}

// Every period, in long form: one row per entity and period (entity_id, name, type, [wikidata], period, then
// <m> and <m>_source per metric) for the entities a latest table would list. The ranking component ranks any
// period from it and draws the time views.
async function metricHistoryTable(db:Queryable,{type,topicId,filters,metrics,limit}:{type?:string;topicId?:string;filters?:Record<string,unknown>;metrics:string[];limit:number}):Promise<MetricTable>{
 const latest=await metricTable(db,{type,topicId,filters,metrics,period:'latest',limit});
 const ids=latest.rows.map(r=>String(r.entity_id));if(!ids.length)return {...latest,period:'all',rows:[]};
 const resolved:ResolvedMetric[]=[];for(const m of metrics)resolved.push(await resolveMetric(db,m));
 const base=new Map(latest.rows.map(r=>[String(r.entity_id),{entity_id:r.entity_id,name:r.name,type:r.type,...(r.wikidata?{wikidata:r.wikidata}:{})}]));
 const out=new Map<string,Row>();
 for(const m of resolved){
  const r=await db.query(`select distinct on (o.entity_id, o.period) o.entity_id, o.period, o.value, o.source from observations o
   where o.entity_id = any($1::uuid[]) and o.metric = $2::text and o.metric_version = $3::int and o.period <> '' order by o.entity_id, o.period, o.retrieved_at desc`,[ids,m.key,m.obsVersion]);
  for(const x of r.rows){const id=String(x.entity_id),k=id+'\u0000'+x.period;let row=out.get(k);if(!row){row={...base.get(id)!,period:String(x.period)};out.set(k,row);}
   row[m.column]=Number(x.value);row[m.column+'_source']=x.source;}
 }
 const rows=[...out.values()].sort((a,b)=>String(a.name).localeCompare(String(b.name))||String(a.period).localeCompare(String(b.period)));
 return {...latest,period:'all',rows};
}

// ───────────── latest snapshot ─────────────
// entities.latest = {metrics:{<key> or <key>@<version>:{value,period,source,retrievedAt,rank,of}}, relations:{<predicate>:[{id,name}]}}.
// Values and relations are rebuilt for the given entities; ranks are recomputed over the whole type for the given metrics
// (a new value moves other entities' ranks too) with the same competition ranking metric_table uses.
const SNAPSHOT_REL_LIMIT=20;
const metricSlot=(key:string,version:number)=>version?`${key}@${version}`:key;
export async function refreshLatestValues(q:Queryable,entityIds:string[]):Promise<number>{
 const ids=[...new Set(entityIds.filter(id=>UUID.test(id)))];if(!ids.length)return 0;
 await q.query(`with ids as (select unnest($1::uuid[]) as id),
  v as (select distinct on (o.entity_id, o.metric, o.metric_version) o.entity_id, o.metric, o.metric_version, o.value, o.period, o.source, o.retrieved_at
   from observations o where o.entity_id = any($1::uuid[]) order by o.entity_id, o.metric, o.metric_version, o.period desc, o.retrieved_at desc),
  m as (select v.entity_id, jsonb_object_agg(case when v.metric_version = 0 then v.metric else v.metric || '@' || v.metric_version end,
    coalesce(e.latest->'metrics'->(case when v.metric_version = 0 then v.metric else v.metric || '@' || v.metric_version end), '{}'::jsonb)
    || jsonb_build_object('value', v.value, 'period', v.period, 'source', v.source, 'retrievedAt', v.retrieved_at)) as j
   from v join entities e on e.id = v.entity_id group by v.entity_id),
  rp as (select r.subject_id, r.predicate, jsonb_path_query_array(jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name) order by r.period desc, o.name), '$[0 to ${SNAPSHOT_REL_LIMIT-1}]') as objs
   from relations r join entities o on o.id = r.object_id where r.subject_id = any($1::uuid[]) group by r.subject_id, r.predicate),
  rl as (select subject_id, jsonb_object_agg(predicate, objs) as j from rp group by subject_id),
  locked as (select id from entities where id = any($1::uuid[]) order by id for update)
  update entities e set latest = jsonb_build_object('metrics', coalesce(m.j, '{}'::jsonb), 'relations', coalesce(rl.j, '{}'::jsonb))
  from ids join locked on locked.id = ids.id left join m on m.entity_id = ids.id left join rl on rl.subject_id = ids.id where e.id = ids.id`,[ids]);
 return ids.length;
}
const RANK_BATCH=Number(process.env.RANK_BATCH||3000);
export async function refreshLatestRanks(q:Queryable,type:string,metric:{key:string;version:number}):Promise<number>{
 const def=metric.version?await getMetric(q,metric.key,metric.version):(await q.query('select sort_order from metrics where key = $1::text order by version desc limit 1',[metric.key])).rows[0];
 const order=(def as {order?:string;sort_order?:string}|undefined)?.order||(def as {sort_order?:string}|undefined)?.sort_order||'desc';
 const slot=metricSlot(metric.key,metric.version);
 const run=()=>q.query<{id:string}>(`with v as (select distinct on (o.entity_id) o.entity_id, o.value from observations o join entities e on e.id = o.entity_id
   where e.type = $1::text and o.metric = $2::text and o.metric_version = $3::int order by o.entity_id, o.period desc, o.retrieved_at desc),
  rk as (select entity_id, rank() over (order by value ${order==='asc'?'asc':'desc'}) as rk, count(*) over () as n from v),
  todo as (select rk.* from rk join entities e on e.id = rk.entity_id where e.latest->'metrics' ? $4::text
   and ((e.latest->'metrics'->$4::text->>'rank') is distinct from rk.rk::text or (e.latest->'metrics'->$4::text->>'of') is distinct from rk.n::text) limit $5::int),
  locked as (select e.id from entities e where e.id in (select entity_id from todo) order by e.id for update)
  update entities e set latest = jsonb_set(e.latest, array['metrics', $4::text], (e.latest->'metrics'->$4::text) || jsonb_build_object('rank', todo.rk, 'of', todo.n))
  from todo join locked on locked.id = todo.entity_id where e.id = todo.entity_id returning e.id`,[type,metric.key,metric.version,slot,RANK_BATCH]).then(r=>r.rows.length);
 let n=await run();
 // In batches: a large type (100,000 entities) is updated a few thousand rows at a time, so no statement holds its rows
 // for long (one statement over the whole type once held the writers for over an hour).
 while(n>=RANK_BATCH)n=await run();
 return 1;
}
// A type's snapshot from scratch: every member's latest values, then every measure's ranks within the type. Needed
// when members move between types (a national subclass takes a country's members): their ranks were among the old
// type's members, which no write of a value would correct.
export async function rerankType(q:Queryable,type:string):Promise<{entities:number;metrics:number}>{
 const t=normalizeType(type);
 const ids=(await q.query<{id:string}>('select id from entities where type = $1::text',[t])).rows.map(r=>r.id);
 for(let i=0;i<ids.length;i+=2000)await refreshLatestValues(q,ids.slice(i,i+2000));
 const ms=(await q.query<{metric:string;metric_version:number}>(`select distinct o.metric, o.metric_version from observations o join entities e on e.id = o.entity_id where e.type = $1::text`,[t])).rows;
 for(const m of ms)await refreshLatestRanks(q,t,{key:m.metric,version:Number(m.metric_version)});
 return {entities:ids.length,metrics:ms.length};
}
// Keeps the snapshot current after a write: values/relations of the touched entities, ranks of the touched metrics in their types.
// Recomputes has_page for some entities (ids) or a whole type: the entity has data. Every entity a ranking lists has a page (a type without its own template uses the
// default one), so every name in a ranking links to it.
export async function refreshPages(db:Queryable,{type,ids}:{type?:string;ids?:string[]}={}):Promise<void>{
 const list=ids?[...new Set(ids.filter(id=>UUID.test(id)))]:null;if(list&&!list.length)return;
 const t=type?normalizeType(type):null;
 // One plan per case (a combined "$1 is null or …" condition scanned every entity for each batch of ids and once ran
 // for ten hours), only rows whose value changes, and a whole type a few thousand rows at a time.
 const has=`exists (select 1 from observations o where o.entity_id=e.id)`;
 if(list){await db.query(`update entities e set has_page=${has} where e.id = any($1::uuid[]) and e.has_page is distinct from ${has}`,[list]);return;}
 for(let after='00000000-0000-0000-0000-000000000000';;){
  const r=await db.query<{id:string}>(`select id from entities where ($1::text is null or type=$1::text) and id > $2::uuid order by id limit 5000`,[t,after]);
  if(!r.rows.length)return;after=r.rows[r.rows.length-1].id;
  await db.query(`update entities e set has_page=${has} where e.id = any($1::uuid[]) and e.has_page is distinct from ${has}`,[r.rows.map(x=>x.id)]);
 }
}
export async function syncLatest(db:Queryable,entityIds:string[],metrics:{key:string;version:number}[]):Promise<void>{
 const ids=[...new Set(entityIds.filter(id=>UUID.test(id)))];if(!ids.length)return;
 for(let i=0;i<ids.length;i+=1000){await refreshLatestValues(db,ids.slice(i,i+1000));await refreshPages(db,{ids:ids.slice(i,i+1000)});}
 if(!metrics.length)return;
 const types=(await db.query<{type:string}>('select distinct type from entities where id = any($1::uuid[])',[ids])).rows.map(r=>r.type);
 for(const t of types)for(const m of metrics)await queueRanks(db,t,m);
}
// Ranks are display data: a burst of writes to one type and metric recomputes them once (debounced, at most once a
// minute per type and metric) instead of after every batch.
const rankQueue=new Map<string,{db:Queryable;type:string;metric:{key:string;version:number}}>();let rankTimer:ReturnType<typeof setTimeout>|null=null;
async function queueRanks(db:Queryable,type:string,metric:{key:string;version:number}){
 if(process.env.RANKS_SYNC==='1'){await refreshLatestRanks(db,type,metric);return;}
 rankQueue.set(type+'\u0000'+metric.key+'\u0000'+metric.version,{db,type,metric});
 if(!rankTimer){rankTimer=setTimeout(async()=>{rankTimer=null;const jobs=[...rankQueue.values()];rankQueue.clear();
  for(const j of jobs)await refreshLatestRanks(j.db,j.type,j.metric).catch(e=>console.warn('ranks refresh failed',j.type,j.metric.key,(e as Error).message));},60_000);(rankTimer as {unref?:()=>void}).unref?.();}
}
export async function flushRanks(){if(rankTimer){clearTimeout(rankTimer);rankTimer=null;}const jobs=[...rankQueue.values()];rankQueue.clear();for(const j of jobs)await refreshLatestRanks(j.db,j.type,j.metric);}
// Recreates every snapshot (or one type's) from observations and relations.
export async function rebuildLatest(db:Queryable,{type}:{type?:string}={}):Promise<{entities:number}>{
 const t=type?normalizeType(type):null;
 const ids=(await db.query<{id:string}>('select id from entities where $1::text is null or type = $1::text',[t])).rows.map(r=>r.id);
 for(let i=0;i<ids.length;i+=1000)await refreshLatestValues(db,ids.slice(i,i+1000));
 const pairs=(await db.query<{type:string;metric:string;v:number}>(`select distinct e.type, o.metric, o.metric_version as v from observations o join entities e on e.id = o.entity_id
  where $1::text is null or e.type = $1::text`,[t])).rows;
 for(const p of pairs)await refreshLatestRanks(db,p.type,{key:p.metric,version:Number(p.v)});
 return {entities:ids.length};
}

// ───────────── promote an attribute to a metric ─────────────
// Copies a numeric attribute of every entity of a type into observations (the attribute itself stays), so it can be
// ranked, filtered by value and charted. Values are parsed like dataset cells ("1,234" → 1234); others are counted as skipped.
export async function promoteAttribute(db:EntityDb,{type,attribute,metric,unit='',period='',source=''}:{type:string;attribute:string;metric?:string;unit?:string;period?:string;source?:string}){
 const t=normalizeType(type);const attr=String(attribute||'').trim();if(!attr||attr.length>80)throw Error('Name the attribute to promote.');
 const key=parseMetricRef(metric||attr.toLowerCase().replace(/[^a-z0-9_]+/g,'_').replace(/^_+|_+$/g,'')).key;
 const rows=(await db.query<{id:string;v:unknown;p:unknown}>(`select id, attributes->$2::text as v, attributes->$3::text as p from entities where type = $1::text and attributes ? $2::text`,[t,attr,period])).rows;
 const list:ObservationInput[]=[];let skipped=0;
 for(const r of rows){const value=parseNumber(r.v);if(value==null){skipped++;continue;}
  const per=period&&r.p!=null&&typeof r.p!=='object'?String(r.p):/^\d{4}$/.test(period)?period:'';
  list.push({entityId:r.id,metric:key,value,period:per,source:source||`attribute:${attr}`});}
 await ensureObservedMetrics(db,[{key,unit}]);
 const n=list.length?await recordObservations(db,list):0;
 return {type:t,attribute:attr,metric:key,withAttribute:rows.length,promoted:n,skipped};
}

// ───────────── embeddings ─────────────
// Embeds entities and topics whose embedding is null, in batches, with the injected embedder.
export async function embedPending(db:Queryable,limit=256,batch=64):Promise<{entities:number;topics:number;skipped:boolean}>{
 const embed=getEmbedder();if(!embed)return {entities:0,topics:0,skipped:true};
 const dim=await storedEmbedDim(db);let entities=0,topics=0;
 const ents=await db.query<{id:string;name:string;type:string;aliases:string[];description:string;attributes:Row}>('select id, name, type, aliases, description, attributes from entities where embedding is null order by updated_at limit $1::int',[limit]);
 for(let i=0;i<ents.rows.length;i+=batch){const chunk=ents.rows.slice(i,i+batch);const vecs=await embed(chunk.map(entityText));
  for(const [j,e] of chunk.entries()){await db.query('update entities set embedding = $2::vector where id = $1::uuid',[e.id,toVector(vecs[j],dim)]);entities++;}}
 const tops=await db.query<{id:string;name:string;description:string}>('select id, name, description from topics where embedding is null limit $1::int',[Math.max(1,limit-entities)]);
 if(tops.rows.length){const vecs=await embed(tops.rows.map(t=>(t.name+'. '+t.description).slice(0,2000)));
  for(const [j,t] of tops.rows.entries()){await db.query('update topics set embedding = $2::vector where id = $1::uuid',[t.id,toVector(vecs[j],dim)]);topics++;}}
 return {entities,topics,skipped:false};
}

// ───────────── topics ─────────────
export type Topic={id:string;parentId:string|null;slug:string;name:string;description:string;scope:Row;status:string};
const topicRow=(r:Row):Topic=>({id:String(r.id),parentId:(r.parent_id as string)||null,slug:String(r.slug),name:String(r.name),description:String(r.description),scope:(r.scope as Row)||{},status:String(r.status)});
const slugify=(s:string)=>s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,100);
export async function createTopic(db:Queryable,{parentId=null,slug,name,description='',scope={}}:{parentId?:string|null;slug?:string;name:string;description?:string;scope?:Row}):Promise<Topic>{
 let s=slugify(slug||name);if(!s)throw Error('A topic needs a name.');
 // A topic's slug is a segment of its pages' addresses: never one of the site's own routes or a language code.
 if(RESERVED_SEGMENTS.has(s))s=s+'-topic';
 const r=await db.query(`insert into topics(parent_id,slug,name,description,scope) values ($1::uuid,$2::text,$3::text,$4::text,$5::jsonb) returning *`,[parentId,s,name.trim().slice(0,200),description.slice(0,4000),JSON.stringify(scope)]);
 return topicRow(r.rows[0]);
}
export async function getTopic(db:Queryable,idOrSlug:string):Promise<Topic|null>{
 const r=UUID.test(idOrSlug)?await db.query('select * from topics where id=$1::uuid',[idOrSlug]):await db.query('select * from topics where slug=$1::text',[idOrSlug]);
 return r.rows[0]?topicRow(r.rows[0]):null;
}
// Moves a topic under another (or to the top level with null); refuses a move that would make a cycle.
export async function setTopicParent(db:Queryable,topicId:string,parentId:string|null):Promise<void>{
 if(parentId){
  if(parentId===topicId)throw Error('A topic cannot be its own parent.');
  const up=await db.query(`with recursive a(id,parent_id) as (select id,parent_id from topics where id=$1::uuid union all select t.id,t.parent_id from topics t join a on t.id=a.parent_id) select 1 from a where id=$2::uuid limit 1`,[parentId,topicId]);
  if(up.rows.length)throw Error('That move would put a topic inside itself.');
 }
 await db.query('update topics set parent_id=$2::uuid where id=$1::uuid',[topicId,parentId]);
}
export async function listChildTopics(db:Queryable,parentId:string|null):Promise<Topic[]>{
 return (await db.query("select * from topics where parent_id is not distinct from $1::uuid and status <> 'archived' order by name",[parentId])).rows.map(topicRow);
}
// Nearest topics to a query (text, embedded with the injected embedder) or a vector, by cosine similarity;
// falls back to full-text match over name + description when there are no embeddings.
export async function nearestTopics(db:Queryable,query:string|number[],limit=5):Promise<(Topic&{score:number})[]>{
 const lim=Math.min(50,Math.max(1,limit));let vec:number[]|null=Array.isArray(query)?query:null;
 if(!vec&&getEmbedder()){try{vec=(await getEmbedder()!([String(query)]))[0];}catch{vec=null;}}
 if(vec){const dim=await storedEmbedDim(db);
  const r=await db.query(`select *, 1 - (embedding <=> $1::vector) as score from topics where embedding is not null and status <> 'archived' order by embedding <=> $1::vector limit $2::int`,[toVector(vec,dim),lim]);
  if(r.rows.length)return r.rows.map(x=>({...topicRow(x),score:Number(x.score)}));}
 const w=words(Array.isArray(query)?'':query);if(!w.length)return [];
 const r=await db.query(`select *, ts_rank(to_tsvector('simple', name || ' ' || description), to_tsquery('simple', $1::text)) as score from topics
  where status <> 'archived' and to_tsvector('simple', name || ' ' || description) @@ to_tsquery('simple', $1::text) order by score desc limit $2::int`,[w.map(x=>x+':*').join(' | '),lim]);
 return r.rows.map(x=>({...topicRow(x),score:Number(x.score)}));
}

// ───────────── editors and leasing ─────────────
export type Editor={id:string;topicId:string;brief:Row;memory:unknown;state:string;leaseId:string|null;leaseUntil:string|null;nextShiftAt:string|null;stats:Row};
const editorRow=(r:Row):Editor=>({id:String(r.id),topicId:String(r.topic_id),brief:(r.brief as Row)||{},memory:r.memory,state:String(r.state),leaseId:(r.lease_id as string)||null,leaseUntil:iso(r.lease_until),nextShiftAt:iso(r.next_shift_at),stats:(r.stats as Row)||{}});
export async function createEditor(db:Queryable,{topicId,brief={},nextShiftAt}:{topicId:string;brief?:Row;nextShiftAt?:Date|string}):Promise<Editor>{
 const r=await db.query('insert into editors(topic_id,brief,next_shift_at) values ($1::uuid,$2::jsonb,coalesce($3::timestamptz, now())) returning *',[topicId,JSON.stringify(brief),iso(nextShiftAt)]);
 return editorRow(r.rows[0]);
}
export async function getEditor(db:Queryable,id:string):Promise<Editor|null>{const r=await db.query('select * from editors where id=$1::uuid',[id]);return r.rows[0]?editorRow(r.rows[0]):null;}
// Leases up to `limit` due editors (next_shift_at passed, not paused, no live lease) with
// FOR UPDATE SKIP LOCKED, so concurrent schedulers never get the same editor. A crashed shift's
// lease expires and the editor becomes leasable again.
export async function leaseDueEditors(db:Queryable,{limit=1,leaseSeconds=600,now}:{limit?:number;leaseSeconds?:number;now?:Date}={}):Promise<Editor[]>{
 const r=await db.query(`update editors set state = 'running', lease_id = gen_random_uuid(), lease_until = coalesce($3::timestamptz, now()) + make_interval(secs => $2::int), updated_at = now()
  where id in (select id from editors where state in ('idle','running') and next_shift_at <= coalesce($3::timestamptz, now())
   and (lease_until is null or lease_until < coalesce($3::timestamptz, now())) order by next_shift_at limit $1::int for update skip locked)
  returning *`,[Math.max(1,limit),Math.max(1,Math.floor(leaseSeconds)),iso(now)]);
 return r.rows.map(editorRow);
}
export async function renewLease(db:Queryable,editorId:string,leaseId:string,leaseSeconds=600,now?:Date):Promise<boolean>{
 const r=await db.query(`update editors set lease_until = coalesce($4::timestamptz, now()) + make_interval(secs => $3::int) where id = $1::uuid and lease_id = $2::uuid and state = 'running' returning id`,[editorId,leaseId,Math.floor(leaseSeconds),iso(now)]);
 return r.rows.length>0;
}
export async function releaseEditor(db:Queryable,editorId:string,leaseId:string,{nextShiftAt,memory,stats}:{nextShiftAt?:Date|string;memory?:unknown;stats?:Row}={}):Promise<boolean>{
 const r=await db.query(`update editors set state = 'idle', lease_id = null, lease_until = null, next_shift_at = coalesce($3::timestamptz, now() + interval '1 hour'),
  memory = coalesce($4::jsonb, memory), stats = stats || coalesce($5::jsonb, '{}'::jsonb), updated_at = now() where id = $1::uuid and lease_id = $2::uuid returning id`,
  [editorId,leaseId,iso(nextShiftAt),memory===undefined?null:JSON.stringify(memory),stats?JSON.stringify(stats):null]);
 return r.rows.length>0;
}

// ───────────── roadmap ─────────────
export type RoadmapKind='source'|'ingest'|'entity_pages'|'ranking'|'refresh'|'review';
export type RoadmapItem={id:string;editorId:string;area:string;kind:RoadmapKind;title:string;spec:Row;priority:number;cadence:string;status:string;dueAt:string|null;origin:string;attempts:number;lastResult:unknown;lastRunAt:string|null};
const itemRow=(r:Row):RoadmapItem=>({id:String(r.id),editorId:String(r.editor_id),area:String(r.area),kind:r.kind as RoadmapKind,title:String(r.title),spec:(r.spec as Row)||{},priority:Number(r.priority),cadence:String(r.cadence),status:String(r.status),dueAt:iso(r.due_at),origin:String(r.origin),attempts:Number(r.attempts),lastResult:r.last_result??null,lastRunAt:iso(r.last_run_at)});
// Next due time for a cadence: hourly, daily, weekly, monthly, quarterly, yearly, or "<n>h|d|w|m|y"
// ("" / "once" → null: one-off). Months and years are calendar steps in UTC.
export function nextDue(cadence:string,from:Date=new Date()):Date|null{
 const c=String(cadence||'').trim().toLowerCase();if(!c||c==='once')return null;
 const named:Record<string,string>={hourly:'1h',daily:'1d',weekly:'1w',monthly:'1m',quarterly:'3m',yearly:'1y',annually:'1y'};
 const m=/^(\d{1,4})\s*([hdwmy])$/.exec(named[c]||c);if(!m)throw Error('Unknown cadence "'+cadence+'" (use hourly, daily, weekly, monthly, quarterly, yearly or e.g. "6h", "3d", "2w").');
 const n=Number(m[1]),d=new Date(from.getTime());
 if(m[2]==='h')d.setUTCHours(d.getUTCHours()+n);else if(m[2]==='d')d.setUTCDate(d.getUTCDate()+n);else if(m[2]==='w')d.setUTCDate(d.getUTCDate()+7*n);
 else{const day=d.getUTCDate();d.setUTCDate(1);if(m[2]==='m')d.setUTCMonth(d.getUTCMonth()+n);else d.setUTCFullYear(d.getUTCFullYear()+n);
  const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,last));}
 return d;
}
export async function addRoadmapItem(db:Queryable,item:{editorId:string;area?:string;kind:RoadmapKind;title:string;spec?:Row;priority?:number;cadence?:string;dueAt?:Date|string;origin?:'plan'|'query'|'review'}):Promise<RoadmapItem>{
 if(item.cadence)nextDue(item.cadence);// validate
 const r=await db.query(`insert into roadmap_items(editor_id,area,kind,title,spec,priority,cadence,due_at,origin) values ($1::uuid,$2::text,$3::text,$4::text,$5::jsonb,$6::int,$7::text,coalesce($8::timestamptz, now()),$9::text) returning *`,
  [item.editorId,item.area||'',item.kind,item.title.slice(0,300),JSON.stringify(item.spec||{}),Math.round(item.priority??50),item.cadence||'',iso(item.dueAt),item.origin||'plan']);
 return itemRow(r.rows[0]);
}
const ITEM_FIELDS:Record<string,[string,string]>={area:['area','text'],kind:['kind','text'],title:['title','text'],spec:['spec','jsonb'],priority:['priority','int'],cadence:['cadence','text'],status:['status','text'],dueAt:['due_at','timestamptz'],origin:['origin','text']};
export async function updateRoadmapItem(db:Queryable,id:string,patch:Partial<{area:string;kind:RoadmapKind;title:string;spec:Row;priority:number;cadence:string;status:string;dueAt:Date|string;origin:string}>):Promise<RoadmapItem|null>{
 if(patch.cadence)nextDue(patch.cadence);
 const p=new Params();const idRef=p.add(id);const sets:string[]=[];
 for(const [k,v] of Object.entries(patch)){const f=ITEM_FIELDS[k];if(!f||v===undefined)continue;sets.push(`${f[0]} = ${p.add(f[1]==='jsonb'?JSON.stringify(v):v instanceof Date?v.toISOString():v)}::${f[1]}`);}
 if(!sets.length)throw Error('Nothing to update.');
 const r=await db.query(`update roadmap_items set ${sets.join(', ')}, updated_at = now() where id = ${idRef}::uuid returning *`,p.list);
 return r.rows[0]?itemRow(r.rows[0]):null;
}
export async function listRoadmap(db:Queryable,editorId:string,{status}:{status?:string}={}):Promise<RoadmapItem[]>{
 return (await db.query('select * from roadmap_items where editor_id = $1::uuid and ($2::text is null or status = $2::text) order by status, due_at, priority desc',[editorId,status||null])).rows.map(itemRow);
}
// Due items in shift order: reader demand first, then priority, then the oldest due.
export async function dueRoadmapItems(db:Queryable,editorId:string,{limit=10,now}:{limit?:number;now?:Date}={}):Promise<RoadmapItem[]>{
 return (await db.query(`select * from roadmap_items where editor_id = $1::uuid and status = 'pending' and due_at <= coalesce($3::timestamptz, now())
  order by (origin = 'query') desc, priority desc, due_at limit $2::int`,[editorId,limit,iso(now)])).rows.map(itemRow);
}
// Completing an item: recurring cadence → pending again at the next due time; one-off → done.
// A failure retries with backoff (1h, 2h, 4h … capped at 24h) and fails for good after 5 attempts.
export async function completeRoadmapItem(db:Queryable,id:string,{ok=true,result=null,now=new Date(),maxAttempts=5}:{ok?:boolean;result?:unknown;now?:Date;maxAttempts?:number}={}):Promise<RoadmapItem|null>{
 const cur=(await db.query('select * from roadmap_items where id = $1::uuid',[id])).rows[0];if(!cur)return null;
 const item=itemRow(cur);let status:string,due:Date|null,attempts:number;
 if(ok){due=nextDue(item.cadence,now);status=due?'pending':'done';attempts=0;}
 else{attempts=item.attempts+1;status=attempts>=maxAttempts?'failed':'pending';due=new Date(now.getTime()+Math.min(24,2**(attempts-1))*3600_000);}
 const r=await db.query(`update roadmap_items set status = $2::text, due_at = coalesce($3::timestamptz, due_at), attempts = $4::int, last_result = $5::jsonb, last_run_at = $6::timestamptz, updated_at = now() where id = $1::uuid returning *`,
  [id,status,iso(due),attempts,JSON.stringify(result??null),now.toISOString()]);
 return itemRow(r.rows[0]);
}

// ───────────── inbox ─────────────
export type InboxEntry={id:string;editorId:string;query:string;language:string;pageId:string|null;served:boolean;createdAt:string|null;triagedAt:string|null;note:string|null};
const inboxRow=(r:Row):InboxEntry=>({id:String(r.id),editorId:String(r.editor_id),query:String(r.query),language:String(r.language),pageId:(r.page_id as string)||null,served:r.served===true,createdAt:iso(r.created_at),triagedAt:iso(r.triaged_at),note:(r.note as string)||null});
export async function addInbox(db:Queryable,{editorId,query,language='',pageId=null,served=false}:{editorId:string;query:string;language?:string;pageId?:string|null;served?:boolean}):Promise<InboxEntry>{
 const r=await db.query('insert into inbox(editor_id,query,language,page_id,served) values ($1::uuid,$2::text,$3::text,$4::text,$5::boolean) returning *',[editorId,query.slice(0,2000),language.slice(0,20),pageId,served]);
 return inboxRow(r.rows[0]);
}
export async function listInbox(db:Queryable,editorId:string,{untriaged=true,limit=50}:{untriaged?:boolean;limit?:number}={}):Promise<InboxEntry[]>{
 return (await db.query('select * from inbox where editor_id = $1::uuid and (not $2::boolean or triaged_at is null) order by created_at limit $3::int',[editorId,untriaged,limit])).rows.map(inboxRow);
}
// Marks entries triaged (with an optional note: "answered by page X", "added roadmap item Y").
export async function triageInbox(db:Queryable,editorId:string,ids:string[],note=''):Promise<number>{
 const r=await db.query('update inbox set triaged_at = now(), note = nullif($3::text, \'\') where editor_id = $1::uuid and id = any($2::uuid[]) and triaged_at is null returning id',[editorId,ids.filter(i=>UUID.test(i)),note.slice(0,1000)]);
 return r.rows.length;
}

// ───────────── sources and rankings ─────────────
export async function addSource(db:Queryable,{topicId=null,url,kind='',notes=''}:{topicId?:string|null;url:string;kind?:string;notes?:string}){
 const r=await db.query(`insert into sources(topic_id,url,kind,notes) values ($1::uuid,$2::text,$3::text,$4::text)
  on conflict (coalesce(topic_id::text, ''), url) do update set kind = excluded.kind, notes = excluded.notes returning *`,[topicId,url.slice(0,2000),kind,notes.slice(0,2000)]);
 return r.rows[0];
}
export async function markSourceOk(db:Queryable,id:string){await db.query('update sources set last_ok_at = now() where id = $1::uuid',[id]);}
export async function listSources(db:Queryable,topicId:string|null){return (await db.query('select * from sources where topic_id is not distinct from $1::uuid order by created_at',[topicId])).rows;}
export async function recordRanking(db:Queryable,{topicId=null,title='',scope={},criteria=[],pageId=null}:{topicId?:string|null;title?:string;scope?:Row;criteria?:string[];pageId?:string|null}){
 return (await db.query('insert into rankings(topic_id,title,scope,criteria,page_id) values ($1::uuid,$2::text,$3::jsonb,$4::text[],$5::text) returning *',[topicId,title,JSON.stringify(scope),criteria,pageId])).rows[0];
}

// Withdraws observations a team has ruled out (a superseded or less authoritative source): every observation of
// one metric for one entity type whose source starts with `source`, or — with `keepSource` — every one whose
// source does NOT start with it. Optional period limits it to one period. Snapshots, ranks and page flags of
// the affected entities are rebuilt at once. Refuses to remove every value of the metric when keepSource
// matches nothing (that would empty the metric by mistake).
export async function retractObservations(db:EntityDb,{type,metric,source,keepSource,period}:{type:string;metric:string;source?:string;keepSource?:string;period?:string}):Promise<{removed:number;entities:number;remaining:number;sourcesLeft:{source:string;n:number}[]}>{
 const t=normalizeType(type),m=String(metric||'').trim();
 if(!t||!m)throw Error('type and metric are required.');
 if(!!source===!!keepSource)throw Error('Give exactly one of source (remove what starts with it) or keepSource (remove everything else).');
 const where=`o.metric=$1::text and e.type=$2::text and ($3::text is null or o.period=$3::text) and `+(source?`o.source like $4::text || '%'`:`o.source not like $4::text || '%'`);
 const args=[m,t,period||null,source||keepSource];
 if(keepSource){
  const kept=await db.query<{n:number}>(`select count(*)::int n from observations o join entities e on e.id=o.entity_id where o.metric=$1::text and e.type=$2::text and ($3::text is null or o.period=$3::text) and o.source like $4::text || '%'`,args);
  if(!kept.rows[0]?.n)throw Error(`No ${m} observation of type ${t} has a source starting with "${keepSource}"; nothing would remain. Check the source names with entity_get first.`);
 }
 const gone=await db.tx(async q=>(await q.query<{entity_id:string;v:number}>(`delete from observations o using entities e where e.id=o.entity_id and ${where} returning o.entity_id, o.metric_version as v`,args)).rows);
 const ids=gone.map(r=>String(r.entity_id)),uniq=[...new Set(ids)];
 await syncLatest(db,uniq,[...new Set(gone.map(r=>Number(r.v)))].map(version=>({key:m,version})));
 const left=await db.query<{source:string;n:number}>(`select o.source, count(*)::int n from observations o join entities e on e.id=o.entity_id where o.metric=$1::text and e.type=$2::text group by o.source order by n desc limit 20`,[m,t]);
 return {removed:ids.length,entities:uniq.length,remaining:left.rows.reduce((a,r)=>a+r.n,0),sourcesLeft:left.rows};
}
// Composite indices are scores from 0 to 100 (higher is better). One computed on another scale (before this rule, or
// by an older definition) is recomputed: a few each maintenance pass, until every one is on the scale.
export async function rescaleComposites(db:EntityDb,limit=40):Promise<{recomputed:string[]}>{
 const r=await db.query<{key:string;version:number}>(`select m.key, m.version from metrics m
  where m.kind = 'derived' and m.status <> 'retired' and m.definition->>'combine' in ('weighted_sum','weighted_geomean')
   and exists (select 1 from observations o where o.source = 'derived:'||m.key||'@v'||m.version and o.metric = m.key)
   and (select min(o.value) < -0.000001 or max(o.value) > 100.000001 or max(o.value) <= 1.5 from observations o where o.source = 'derived:'||m.key||'@v'||m.version and o.metric = m.key)
  limit $1::int`,[limit]);
 const done:string[]=[];
 for(const m of r.rows){try{await computeDerivedMetric(db,m.key,m.version);done.push(m.key+'@'+m.version);}catch(e){console.warn('[composites] recompute failed',m.key,(e as Error).message);}}
 return {recomputed:done};
}
