import type {Queryable} from './client';
// Entity types form a hierarchy that follows the topic tree, like classes: a subtopic's type extends the type of the
// nearest topic above it (schema.extends), inherits everything it has — metrics, attributes, relations, template
// lead, card and sections — and may only add. The effective schema and template are the ancestors' merged with the
// type's own, most general first; nothing inherited can be removed.
type Row=Record<string,unknown>;
const obj=(v:unknown):Row=>v&&typeof v==='object'&&!Array.isArray(v)?v as Row:{};
const arr=(v:unknown):unknown[]=>Array.isArray(v)?v:[];
async function rowOf(db:Queryable,type:string){return (await db.query<{type:string;schema:Row;template:Row;topic_id:string|null}>('select type, schema, template, topic_id from entity_types where type=$1::text',[type])).rows[0]??null;}
// The type and its ancestors, the type itself first (at most 8 levels; a cycle stops the walk).
export async function typeChain(db:Queryable,type:string):Promise<{type:string;schema:Row;template:Row}[]>{
 const out:{type:string;schema:Row;template:Row}[]=[];const seen=new Set<string>();
 for(let t:string|undefined=type;t&&!seen.has(t)&&out.length<8;){seen.add(t);const r=await rowOf(db,t);if(!r)break;out.push({type:r.type,schema:obj(r.schema),template:obj(r.template)});t=typeof obj(r.schema).extends==='string'?String(obj(r.schema).extends):undefined;}
 return out;
}
const keyOf=(x:unknown)=>typeof x==='string'?x:String(obj(x).key??obj(x).url??obj(x).name??obj(x).column??JSON.stringify(x));
// Union of lists by key, ancestors' entries first; a descendant's entry with the same key refines it.
function unionBy(lists:unknown[][]):unknown[]{const m=new Map<string,unknown>();for(const l of lists)for(const x of l)m.set(keyOf(x),x);return [...m.values()];}
export function mergeSchemas(chainGeneralFirst:Row[]):Row{
 const out:Row={};
 for(const s of chainGeneralFirst)for(const [k,v] of Object.entries(s))if(!Array.isArray(v)&&(typeof v!=='object'||v===null))out[k]=v;else if(!Array.isArray(v))out[k]={...obj(out[k]),...obj(v)};
 // Lists inherit by union, ancestors first: data to collect, planned indices, ranking criteria and data sources.
 for(const k of ['metrics','attributes','relations','indices','criteria','sources'])out[k]=unionBy(chainGeneralFirst.map(s=>arr(s[k])));
 return out;
}
export function mergeTemplates(chainGeneralFirst:Row[]):Row{
 const own=chainGeneralFirst[chainGeneralFirst.length-1]||{};
 const lead=[...chainGeneralFirst].reverse().map(t=>arr(t.lead)).find(l=>l.length)||[];
 const card=[...new Set(chainGeneralFirst.flatMap(t=>arr(t.card).map(String)))];
 const sections=unionBy(chainGeneralFirst.map(t=>arr(t.sections).map(s=>({...obj(s),key:String(obj(s).kind)+':'+JSON.stringify(obj(s).metrics??obj(s).title??'')}))) as unknown[][]).map(s=>{const {key:_k,...rest}=obj(s);return rest;});
 return {...own,lead,card,sections,...(own.page?{page:own.page}:{})};
}
// Interfaces (mixins): besides its one parent, a type may declare interfaces (schema.interfaces: type names of kind
// "interface"), each a set of attributes, metrics, indices, sections and sources it also has — a military drone is
// military equipment that also has the aircraft interface. Interfaces declared anywhere on the line are inherited.
// Effective = each type of the line, most general first, preceded by the interfaces it declares; only additions.
export async function effectiveType(db:Queryable,type:string):Promise<{schema:Row;template:Row;extends:string[];interfaces:string[]}>{
 // A tag interface (one an editor defined for a class: gaming laptops among laptops) is that class plus the tag's own
 // additions: its pages and rankings show everything a member has.
 const own=await rowOf(db,type);const applies=own&&obj(own.schema).kind==='interface'&&typeof obj(own.schema).appliesTo==='string'?String(obj(own.schema).appliesTo):'';
 if(applies&&applies!==type){
  const base=await effectiveType(db,applies);
  const layers=[...(await typeChain(db,type)).reverse()].map(l=>({schema:{...l.schema,extends:undefined,interfaces:undefined,kind:undefined,appliesTo:undefined,rule:undefined},template:l.template}));
  const schema=mergeSchemas([base.schema,...layers.map(l=>l.schema)]);schema.extends=applies;schema.interfaces=base.interfaces;schema.kind='interface';
  const tpls=[base.template,...layers.map(l=>l.template)];
  return {schema,template:tpls.some(t=>Object.keys(t).length)?mergeTemplates(tpls):{},extends:[...base.extends,applies],interfaces:base.interfaces};
 }
 const chain=(await typeChain(db,type)).reverse();
 const layers:{schema:Row;template:Row}[]=[];const ifaces:string[]=[];
 for(const c of chain){
  for(const i of arr(c.schema.interfaces).map(String)){
   if(ifaces.includes(i))continue;ifaces.push(i);
   // An interface may itself extend another interface; its whole line comes in.
   for(const l of (await typeChain(db,i)).reverse())layers.push({schema:{...l.schema,extends:undefined,interfaces:undefined,kind:undefined},template:l.template});
  }
  layers.push({schema:c.schema,template:c.template});
 }
 const schema=mergeSchemas(layers.map(l=>l.schema));schema.extends=chain.length>1?chain[chain.length-2].type:undefined;schema.interfaces=ifaces;
 return {schema,template:layers.some(l=>Object.keys(l.template).length)?mergeTemplates(layers.map(l=>l.template)):{},extends:chain.slice(0,-1).map(c=>c.type).reverse(),interfaces:ifaces};
}
export async function listInterfaces(db:Queryable):Promise<{type:string;label:string;description:string;appliesTo:string|null;rule:string|null}[]>{
 return (await db.query<{type:string;label:string;description:string;appliesTo:string|null;rule:string|null}>(`select type, label, description, schema->>'appliesTo' "appliesTo", schema->>'rule' rule from entity_types where schema->>'kind' = 'interface' order by type`)).rows;
}
// A tag interface's class: the type its members are (gaming_laptop → laptop); null for anything else.
let ifaceCache:{at:number;map:Map<string,string>}|null=null;
export async function interfaceClass(db:Queryable,type:string):Promise<string|null>{
 if(!ifaceCache||Date.now()-ifaceCache.at>60_000){
  const rows=(await db.query<{type:string;applies:string}>(`select type, schema->>'appliesTo' applies from entity_types where schema->>'kind' = 'interface' and schema ? 'appliesTo'`)).rows;
  ifaceCache={at:Date.now(),map:new Map(rows.map(r=>[r.type,r.applies]))};
 }
 return ifaceCache.map.get(type)??null;
}
// The type a new type of this topic extends: the main type of the nearest topic above it that has one.
export async function parentTypeFor(db:Queryable,topicId:string|null,self:string):Promise<string|null>{
 if(!topicId)return null;
 const r=await db.query<{type:string}>(`with recursive up(id,parent_id,depth) as (select id,parent_id,0 from topics where id=$1::uuid union all select t.id,t.parent_id,u.depth+1 from topics t join up u on t.id=u.parent_id where u.depth<12)
  select et.type from up join entity_types et on et.topic_id=up.id where up.depth>0 and et.type<>$2::text order by up.depth, et.created_at limit 1`,[topicId,self]).catch(()=>({rows:[]}));
 return r.rows[0]?.type??null;
}

// The type and every type that extends it, at any depth ("is-a": a ranking of laptops includes gaming laptops).
// Cached briefly: scope queries ask often and the hierarchy changes rarely.
let subCache:{at:number;map:Map<string,string[]>}|null=null;
export async function withSubtypes(db:Queryable,type:string):Promise<string[]>{
 if(!subCache||Date.now()-subCache.at>60_000){
  // An interface is class-level, like a class: its members are the classes that implement it (with all their
  // subclasses: military drones implement aircraft, so every military drone is an aircraft) and the entities tagged
  // with it one by one (entities.also_types, matched by the scope query).
  const rows=(await db.query<{type:string;parent:string|null;ifaces:string[]|null}>("select type, schema->>'extends' parent, array(select jsonb_array_elements_text(case when jsonb_typeof(schema->'interfaces')='array' then schema->'interfaces' else '[]'::jsonb end)) ifaces from entity_types")).rows;
  const kids=new Map<string,string[]>();const add=(p:string,c:string)=>{const l=kids.get(p)??[];l.push(c);kids.set(p,l);};
  for(const r of rows){if(r.parent)add(r.parent,r.type);for(const i of r.ifaces||[])if(i!==r.type)add(i,r.type);}
  subCache={at:Date.now(),map:kids};
 }
 const out=[type],seen=new Set(out);
 for(let i=0;i<out.length&&out.length<500;i++)for(const k of subCache.map.get(out[i])||[])if(!seen.has(k)){seen.add(k);out.push(k);}
 return out;
}
export function clearTypeCache(){subCache=null;ifaceCache=null;}
