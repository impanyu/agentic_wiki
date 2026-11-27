import type {Queryable} from '@/app/entity-db/client';
// The operators' view of the two structures the manager keeps: the site map (pages readers browse) and the class
// tree (what data exists), down to each class's fields and the sources each field comes from.
type Row=Record<string,unknown>;
const obj=(v:unknown):Row=>v&&typeof v==='object'&&!Array.isArray(v)?v as Row:{};
const arr=(v:unknown):Row[]=>Array.isArray(v)?v as Row[]:[];

// Site map: every node (topic or ranking) with its children, from the address tree readers browse.
export type SiteNode={path:string;name:string;kind:string;slug:string;live:boolean;children:SiteNode[]};
export async function siteTree(db:Queryable):Promise<{roots:SiteNode[];nodes:number}>{
 const {pathMaps}=await import('@/app/entity-db/pages');const maps=await pathMaps(db);
 const build=(p:string,depth:number):SiteNode=>{const n=maps.nodes.get(p)!;
  return {path:p,name:n.name,kind:n.kind,slug:n.slug,live:!!n.live,children:depth>12?[]:(maps.children.get(p)??[]).map(c=>build(c,depth+1)).sort((a,b)=>Number(b.live)-Number(a.live)||a.name.localeCompare(b.name))};};
 const roots=(maps.children.get('')??[]).filter(p=>maps.nodes.has(p)).map(p=>build(p,0)).sort((a,b)=>a.name.localeCompare(b.name));
 return {roots,nodes:maps.nodes.size};
}

// Class tree: every class with its parent, members (own type) and the progress row when there is one.
export type ClassNode={type:string;label:string;members:number;national:string;children:ClassNode[]};
export async function classTree(db:Queryable):Promise<{roots:ClassNode[];classes:number}>{
 const rows=(await db.query<{type:string;label:string;parent:string|null;national:string|null}>(`select type, label, schema->>'extends' parent,
   case when jsonb_typeof(schema->'value')='array' and schema->'value'->>0 ~ '^[A-Z]{3}$' then schema->'value'->>0 end national
   from entity_types where schema->>'kind'='class' and coalesce(schema->>'retiredInto','')=''`)).rows;
 const counts=new Map((await db.query<{type:string;n:number}>(`select type, count(*)::int n from entities group by type`)).rows.map(r=>[r.type,r.n]));
 const nodes=new Map(rows.map(r=>[r.type,{type:r.type,label:r.label||r.type,members:counts.get(r.type)||0,national:r.national||'',children:[] as ClassNode[]}]));
 const roots:ClassNode[]=[];
 for(const r of rows){const n=nodes.get(r.type)!;const p=r.parent?nodes.get(r.parent):undefined;if(p&&p!==n)p.children.push(n);else roots.push(n);}
 const sort=(l:ClassNode[])=>{l.sort((a,b)=>a.label.localeCompare(b.label));for(const n of l)sort(n.children);};sort(roots);
 return {roots,classes:rows.length};
}

// One class: where it sits, its member lists, and every field (own and inherited) with its sources and how many
// members have it.
export async function classDetail(db:Queryable,type:string){
 const et=(await db.query<{type:string;label:string;plural:string;description:string;schema:Row}>(`select type, label, plural, description, schema from entity_types where type=$1::text`,[type])).rows[0];
 if(!et)return null;
 const own=obj(et.schema);
 const {effectiveType,withSubtypes}=await import('@/app/entity-db/inherit');
 const eff=obj((await effectiveType(db,type).catch(()=>null))?.schema);
 const chain:string[]=[];for(let t=String(own.extends||''),i=0;t&&i<10;i++){chain.unshift(t);t=String(obj((await db.query<{schema:Row}>('select schema from entity_types where type=$1::text',[t])).rows[0]?.schema).extends||'');}
 const kids=(await db.query<{type:string;label:string}>(`select type, label from entity_types where schema->>'extends'=$1::text and schema->>'kind'='class' order by label`,[type])).rows;
 const types=await withSubtypes(db,type);
 const members=Number((await db.query<{n:number}>(`select count(*)::int n from entities where type = any($1::text[])`,[types])).rows[0]?.n||0);
 const fill=new Map((await db.query<{metric:string;k:number;s:number;srcs:string[]}>(`with ents as (select id from entities where type = any($1::text[]))
   select o.metric, count(distinct o.entity_id)::int k, count(distinct o.source)::int s, (array_agg(distinct left(o.source,80)))[1:6] srcs
   from observations o join ents on ents.id=o.entity_id group by 1`,[types])).rows.map(r=>[r.metric,r]));
 const ownKeys=new Set([...arr(own.metrics),...arr(own.attributes)].map(f=>String(f.key)));
 const field=(f:Row,kind:'metric'|'attribute')=>{const k=String(f.key);const x=fill.get(k);
  return {key:k,kind,label:String(f.label||k.replace(/_/g,' ')),unit:String(f.unit||f.type||''),order:String(f.order||''),aspect:String(f.aspect||''),
   own:ownKeys.has(k),deprecated:!!f.deprecated,sourceNeeded:!!f.source_needed,
   planned:arr(f.sources).map(s=>({name:String(s.name||''),url:String(s.url||''),field:String(s.field||''),access:String(s.access||'')})),
   filled:x?.k||0,loadedSources:x?.s||0,loaded:x?.srcs||[]};};
 const fields=[...arr(eff.metrics).map(f=>field(f,'metric')),...arr(eff.attributes).map(f=>field(f,'attribute'))];
 const universe=obj(own.universe);
 const progress=(await db.query(`select * from class_progress where type=$1::text`,[type]).catch(()=>({rows:[]}))).rows[0]||null;
 const rankings=(await db.query<{slug:string;title:string;status:string}>(`select slug, title, status from rankings where scope->>'type'=$1::text and slug is not null and status<>'archived' order by (config ? 'main') desc, title limit 50`,[type])).rows;
 return {type:et.type,label:et.label,plural:et.plural,description:et.description,chain,children:kids,members,national:Array.isArray(own.value)?own.value:[],
  universe:{expected:universe.expectedCount??null,admission:String(universe.admission||''),gaps:String(universe.gaps||''),lists:arr(universe.lists)},
  rankingCriteria:arr(eff.rankingCriteria).map(String),composites:arr(eff.composites),fields,progress,rankings};
}

// Fields across all classes, filtered: "one source only", "no source", "declared but empty".
export async function fieldSearch(db:Queryable,{q='',problem=''}:{q?:string;problem?:string}){
 const rows=(await db.query<{type:string;label:string;key:string;kind:string;sources:number;need:boolean}>(`select et.type, et.label, f->>'key' key, k.kind,
   jsonb_array_length(coalesce(f->'sources','[]'::jsonb)) sources, coalesce((f->>'source_needed')::boolean,false) need
   from entity_types et, lateral (select 'metric' kind, x f from jsonb_array_elements(case when jsonb_typeof(et.schema->'metrics')='array' then et.schema->'metrics' else '[]'::jsonb end) x
     union all select 'attribute', x from jsonb_array_elements(case when jsonb_typeof(et.schema->'attributes')='array' then et.schema->'attributes' else '[]'::jsonb end) x) k(kind,f)
   where et.schema->>'kind'='class' and coalesce((f->>'deprecated')::boolean,false)=false
    and ($1::text='' or f->>'key' ilike '%'||$1||'%' or et.type ilike '%'||$1||'%' or et.label ilike '%'||$1||'%')
    and ($2::text='' or ($2='one-source' and jsonb_array_length(coalesce(f->'sources','[]'::jsonb))=1) or ($2='no-source' and (jsonb_array_length(coalesce(f->'sources','[]'::jsonb))=0 or coalesce((f->>'source_needed')::boolean,false))))
   order by et.label, k.kind, f->>'key' limit 500`,[q.trim().slice(0,80),problem])).rows;
 return rows;
}
