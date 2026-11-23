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
export async function effectiveType(db:Queryable,type:string):Promise<{schema:Row;template:Row;extends:string[]}>{
 const chain=(await typeChain(db,type)).reverse();
 return {schema:mergeSchemas(chain.map(c=>c.schema)),template:chain.some(c=>Object.keys(c.template).length)?mergeTemplates(chain.map(c=>c.template)):{},extends:chain.slice(0,-1).map(c=>c.type).reverse()};
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
  const rows=(await db.query<{type:string;parent:string|null}>("select type, schema->>'extends' parent from entity_types")).rows;
  const kids=new Map<string,string[]>();for(const r of rows)if(r.parent){const l=kids.get(r.parent)??[];l.push(r.type);kids.set(r.parent,l);}
  subCache={at:Date.now(),map:kids};
 }
 const out=[type],seen=new Set(out);
 for(let i=0;i<out.length&&out.length<500;i++)for(const k of subCache.map.get(out[i])||[])if(!seen.has(k)){seen.add(k);out.push(k);}
 return out;
}
export function clearTypeCache(){subCache=null;}
