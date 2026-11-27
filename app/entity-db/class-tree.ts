import type {EntityDb} from './client';
// The class tree (the data layer, the collectors'): a single-inheritance tree of classes, each dividing its members by
// ONE attribute into subclasses (schema.splitBy; each subclass's schema.value is one value of it). Every entity belongs to
// exactly one class (entities.type, the most specific one it can be placed in); a class has every attribute, metric and
// source of its ancestors (schema.extends) and adds its own. The site map (topics, rankings) is separate: a ranking is a
// stored query {type: class, filters} over this tree.
//
// importClassTree loads an initialised tree (classes, views, dropped topics) and migrates what exists onto it:
//  - each class becomes an entity type (its old types' metrics, attributes and templates are kept);
//  - every old type becomes its class: entities are retyped (a twin already in the class absorbs the copy), and when
//    the old type's topic became a view {class, filters}, the members get those attribute values (their membership
//    is the evidence);
//  - tags (interfaces) end: tagged members get their view's attribute values, also_types is cleared;
//  - rankings are re-scoped to {type: class, filters};
//  - topics record what they show (scope.shows = {class} or {class, filters}).
type Row=Record<string,unknown>;
export type ClassSpec={key:string;label:string;plural:string;parent:string|null;value?:unknown;definition?:string;splitBy?:{key:string;label?:string}|null;
 attributes?:Row[];metrics?:Row[];sources?:Row[];universe?:Row;mapsFrom?:{types?:string[];topics?:string[]};area?:string};
export type ViewSpec={topic:string;class:string;filters:Row;why?:string};
const arr=(v:unknown):Row[]=>Array.isArray(v)?v.filter(x=>x&&typeof x==='object') as Row[]:[];
const keyOf=(x:Row)=>String(x.key??x.url??x.name??JSON.stringify(x));

export async function importClassTree(edb:EntityDb,spec:{classes:ClassSpec[];views:ViewSpec[];dropped?:{topic:string;why?:string}[]},
 {dryRun=false,allowUnmapped=false,log=(e:Row)=>console.log('[class-tree]',JSON.stringify(e))}:{dryRun?:boolean;allowUnmapped?:boolean;log?:(e:Row)=>void}={}):Promise<Row>{
 const classes=new Map(spec.classes.map(c=>[c.key,c]));
 const oldTypes=new Map((await edb.query<{type:string;topic_id:string|null;schema:Row;template:Row;status:string;n:number}>(`select et.type, et.topic_id, et.schema, et.template, et.status,
   (select count(*)::int from entities e where e.type = et.type) n from entity_types et`)).rows.map(r=>[r.type,r]));
 const topicBySlug=new Map((await edb.query<{id:string;slug:string}>('select id, slug from topics')).rows.map(r=>[r.slug,r.id]));
 const slugById=new Map([...topicBySlug].map(([s,i])=>[i,s]));
 // Old type → its class; topic → what it shows.
 const typeTo=new Map<string,string>();
 for(const c of spec.classes)for(const t of c.mapsFrom?.types||[])typeTo.set(t,c.key);
 for(const k of classes.keys())typeTo.set(k,k);
 const shows=new Map<string,{class:string;filters:Row}>();
 for(const c of spec.classes)for(const t of c.mapsFrom?.topics||[])if(!shows.has(t))shows.set(t,{class:c.key,filters:{}});
 for(const v of spec.views)if(v.topic&&classes.has(v.class))shows.set(v.topic,{class:v.class,filters:v.filters||{}});
 // An old type (or tag) whose own topic became a view: its members carry the view's values.
 const viewOf=(t:string)=>{const o=oldTypes.get(t);const s=o?.topic_id?slugById.get(o.topic_id):undefined;const v=s?shows.get(s):undefined;return v&&Object.keys(v.filters).length?v:null;};
 for(const [t,o] of oldTypes){if(typeTo.has(t))continue;const v=viewOf(t);if(v)typeTo.set(t,v.class);else if(o.n>0)log({event:'unmapped_type',type:t,n:o.n});}
 // List attributes (a value is added to the list, not replacing it).
 const listAttrs=new Set(spec.classes.flatMap(c=>arr(c.attributes).filter(a=>a.type==='list').map(a=>String(a.key))));
 const report:Row={classes:spec.classes.length,typesMapped:typeTo.size,views:spec.views.length,dryRun};
 // Nothing with data may be left without a class: its members would drop out of every scope.
 const lost=[...oldTypes].filter(([t,o])=>o.n>0&&!typeTo.has(t)).map(([t,o])=>({type:t,n:o.n}));
 if(!dryRun&&lost.length&&!allowUnmapped)throw Error('Types with entities have no class: '+lost.slice(0,20).map(l=>l.type+' ('+l.n+')').join(', '));
 if(dryRun){
  const moves=[...oldTypes].filter(([t,o])=>o.n>0&&typeTo.get(t)&&typeTo.get(t)!==t).map(([t,o])=>({from:t,to:typeTo.get(t),n:o.n,set:viewOf(t)?.filters||{}}));
  return {...report,moves,unmapped:[...oldTypes].filter(([t,o])=>o.n>0&&!typeTo.has(t)).map(([t,o])=>({type:t,n:o.n}))};
 }
 // 1. Classes.
 for(const c of spec.classes){
  const olds=[...oldTypes].filter(([t])=>typeTo.get(t)===c.key&&t!==c.key).map(([,o])=>o);const own=oldTypes.get(c.key);
  const kept=(k:string)=>[own,...olds].flatMap(o=>arr(o?.schema?.[k]));
  const union=(a:Row[],b:Row[])=>{const m=new Map<string,Row>();for(const x of [...b,...a])m.set(keyOf(x),x);return [...m.values()];};
  const schema:Row={kind:'class',extends:c.parent||undefined,value:c.value??null,splitBy:c.splitBy||null,universe:c.universe||{},area:c.area||'',
   attributes:union(arr(c.attributes),kept('attributes')),metrics:union(arr(c.metrics),kept('metrics')),sources:union(arr(c.sources),kept('sources'))};
  const tpl=[own,...olds.sort((a,b)=>b.n-a.n)].map(o=>o?.template).find(t=>t&&Object.keys(t).length)||{};
  const topic=(c.mapsFrom?.topics||[]).map(s=>topicBySlug.get(s)).find(Boolean)||own?.topic_id||null;
  const status=[own,...olds].some(o=>o?.status==='published')?'published':(own?.status||'draft');
  await edb.query(`insert into entity_types(type,topic_id,label,plural,description,schema,template,status,updated_by) values ($1,$2::uuid,$3,$4,$5,$6::jsonb,$7::jsonb,$8,'class-tree')
   on conflict (type) do update set topic_id=excluded.topic_id, label=excluded.label, plural=excluded.plural, description=excluded.description, schema=excluded.schema,
    template=case when entity_types.template<>'{}'::jsonb then entity_types.template else excluded.template end, status=excluded.status, updated_by='class-tree', updated_at=now()`,
   [c.key,topic,c.label||c.key,c.plural||'',String(c.definition||'').slice(0,4000),JSON.stringify(schema),JSON.stringify(tpl),status]);
 }
 const {clearTypeCache}=await import('./inherit');clearTypeCache();
 // 2. Entities of old types → their classes.
 const {mergeEntities}=await import('./dedup');
 let moved=0,merged=0,valued=0;
 const setValues=async(ids:string[],filters:Row)=>{
  for(const [k,v] of Object.entries(filters)){if(!/^[a-z][a-z0-9_]{0,63}$/.test(k)||v==null||typeof v==='object')continue;
   if(listAttrs.has(k))await edb.query(`update entities set attributes=jsonb_set(attributes,array[$2::text],(case when jsonb_typeof(attributes->$2::text)='array' then attributes->$2::text when attributes ? $2::text then jsonb_build_array(attributes->$2::text) else '[]'::jsonb end)||to_jsonb($3::text)) where id=any($1::uuid[]) and not (coalesce(attributes->$2::text,'[]'::jsonb) @> to_jsonb($3::text) or coalesce(attributes->>$2::text,'') = $3::text)`,[ids,k,String(v)]);
   else await edb.query(`update entities set attributes=attributes||jsonb_build_object($2::text,$3::text) where id=any($1::uuid[]) and coalesce(attributes->>$2::text,'')=''`,[ids,k,String(v)]);
   valued+=ids.length;}
 };
 for(const [t,o] of oldTypes){
  const to=typeTo.get(t);if(!to||to===t||!o.n)continue;
  const v=viewOf(t);
  for(;;){
   const ids=(await edb.query<{id:string}>('select id from entities where type=$1::text limit 2000',[t])).rows.map(r=>r.id);if(!ids.length)break;
   if(v)await setValues(ids,v.filters);
   // Fast path: the whole batch at once; a conflict (a twin already in the class) falls back to one by one.
   const ok=await edb.tx(async q=>{await q.query('update entities set type=$2::text, also_types=array_remove(also_types,$2::text), updated_at=now() where id=any($1::uuid[])',[ids,to]);return true;}).catch(()=>false);
   if(ok){moved+=ids.length;continue;}
   let progressed=0;
   for(const id of ids){
    try{await edb.query('update entities set type=$2::text, also_types=array_remove(also_types,$2::text), updated_at=now() where id=$1::uuid',[id,to]);moved++;progressed++;}
    catch{
     const twin=(await edb.query<{id:string}>(`select x.id from entities x, entities e where e.id=$1::uuid and x.id<>e.id and x.type=$2::text and (ent_norm(x.name)=ent_norm(e.name) or exists (select 1 from jsonb_each_text(e.ids) k where x.ids->>k.key = k.value)) order by (ent_norm(x.name)=ent_norm(e.name)) desc limit 1`,[id,to])).rows[0];
     if(twin){await mergeEntities(edb,twin.id,id);merged++;progressed++;}
     else log({event:'retype_failed',type:t,id});
    }
   }
   if(!progressed){log({event:'stuck',type:t});break;}
  }
  log({event:'type_moved',from:t,to,n:o.n});
 }
 // 3. Tags end: members of a tag carry its view's values; also_types is cleared.
 for(const [t,o] of oldTypes){
  if(o.schema?.kind!=='interface')continue;const v=viewOf(t);
  const ids=(await edb.query<{id:string}>('select id from entities where also_types @> array[$1::text]',[t])).rows.map(r=>r.id);
  if(v&&ids.length)await setValues(ids,v.filters);
 }
 await edb.query(`update entities set also_types='{}' where also_types <> '{}'`);
 // 4. Old types that are no class: retired (kept for the record, out of every scope).
 for(const [t] of oldTypes)if(!classes.has(t))await edb.query(`update entity_types set schema=schema||jsonb_build_object('kind','retired','retiredInto',$2::text), topic_id=null, status='draft', updated_at=now() where type=$1::text`,[t,typeTo.get(t)||null]);
 clearTypeCache();
 // 5. Rankings: re-scoped to their class, with their topic's view filters.
 const rk=(await edb.query<{id:string;topic_id:string|null;scope:Row}>(`select id, topic_id, scope from rankings where status <> 'archived'`)).rows;let rescoped=0;
 for(const r of rk){
  const t=String(r.scope?.type||'');const s=r.topic_id?slugById.get(r.topic_id):undefined;const sh=s?shows.get(s):undefined;
  const cls=typeTo.get(t)||(sh?.class)||t;if(!cls)continue;
  const tv=viewOf(t);const filters={...(tv?.filters||{}),...((r.scope?.filters as Row)||{})};
  const next={type:cls,filters};if(JSON.stringify(next)===JSON.stringify({type:t,filters:r.scope?.filters||{}}))continue;
  await edb.query('update rankings set scope=$2::jsonb, updated_at=now(), members_at=null where id=$1::uuid',[r.id,JSON.stringify(next)]);rescoped++;
 }
 // 6. Topics: what each page shows; the old split marks go.
 await edb.query(`update topics set scope=scope-'split'-'value'-'role'-'viewFilter'-'viewOf'-'convertedAt' where scope ?| array['split','value','role','viewFilter','viewOf','convertedAt']`);
 for(const [slug,sh] of shows){const id=topicBySlug.get(slug);if(id)await edb.query(`update topics set scope=coalesce(scope,'{}'::jsonb)||jsonb_build_object('shows',$2::jsonb) where id=$1::uuid`,[id,JSON.stringify(sh)]);}
 for(const d of spec.dropped||[]){const id=topicBySlug.get(d.topic);if(id)await edb.query(`update topics set scope=coalesce(scope,'{}'::jsonb)||jsonb_build_object('shows',jsonb_build_object('hub',true,'why',$2::text)) where id=$1::uuid`,[id,String(d.why||'').slice(0,300)]);}
 const out={...report,moved,merged,valued,rescoped};log({event:'done',...out});return out;
}
