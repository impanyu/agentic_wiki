import type {Queryable} from '@/app/entity-db/client';
import {normalizeType} from '@/app/entity-db/repo';
// The initial class schema of the topic tree: for every node its entity type, the type it extends, and what it adds
// (attributes, metrics, relations, planned indices, ranking criteria). Loaded once into entity_types (draft, no
// template, so no pages yet) and linked from each topic (topics.scope.type); a team plans from it and only fills gaps.
// Loading again merges: what a team added since is kept; nothing inherited is removed.
export type SeedNode={slug:string;type:string;label?:string;plural?:string;extends?:string;attributes?:unknown[];metrics?:unknown[];relations?:unknown[];indices?:unknown[];criteria?:string[];sources?:unknown[];filter?:Record<string,string>};
const keyOf=(x:unknown)=>String((x as {key?:string})?.key??(x as {url?:string})?.url??(x as {predicate?:string})?.predicate??JSON.stringify(x));
const union=(a:unknown[]=[],b:unknown[]=[])=>{const m=new Map<string,unknown>();for(const x of [...a,...b])if(!m.has(keyOf(x)))m.set(keyOf(x),x);return [...m.values()];};
export async function seedSchema(db:Queryable,nodes:SeedNode[]):Promise<{types:number;created:number;linked:number;skipped:string[]}>{
 let types=0,created=0,linked=0;const skipped:string[]=[];
 for(const n of nodes){
  const topic=(await db.query<{id:string}>('select id from topics where slug=$1::text',[n.slug])).rows[0];
  if(!topic||!n.type){skipped.push(n.slug);continue;}
  const type=normalizeType(n.type);
  // A filtered node (a country's cities) is a subset of a global type: it links to the type and its filter only.
  if(n.filter){await db.query(`update topics set scope=coalesce(scope,'{}'::jsonb)||jsonb_build_object('type',$2::text,'filter',$3::jsonb) where id=$1::uuid`,[topic.id,type,JSON.stringify(n.filter)]);linked++;continue;}
  const cur=(await db.query<{schema:Record<string,unknown>}>('select schema from entity_types where type=$1::text',[type])).rows[0];
  const own=cur?.schema||{};
  const schema={...own,...(n.extends?{extends:normalizeType(n.extends)}:{}),
   attributes:union(own.attributes as unknown[],n.attributes),metrics:union(own.metrics as unknown[],n.metrics),relations:union(own.relations as unknown[],n.relations),
   indices:union(own.indices as unknown[],n.indices),sources:union(own.sources as unknown[],n.sources),criteria:[...new Set([...((own.criteria as string[])||[]),...(n.criteria||[])])],seeded:true};
  if(cur)await db.query('update entity_types set schema=$2::jsonb, topic_id=coalesce(topic_id,$3::uuid), updated_at=now() where type=$1::text',[type,JSON.stringify(schema),topic.id]);
  else{await db.query(`insert into entity_types(type,topic_id,label,plural,schema,template,status,updated_by) values ($1::text,$2::uuid,$3::text,$4::text,$5::jsonb,'{}'::jsonb,'draft','schema-seed')`,
   [type,topic.id,String(n.label||type.replace(/_/g,' ')).slice(0,120),String(n.plural||'').slice(0,120),JSON.stringify(schema)]);created++;}
  await db.query(`update topics set scope=coalesce(scope,'{}'::jsonb)||jsonb_build_object('type',$2::text) where id=$1::uuid`,[topic.id,type]);
  types++;linked++;
 }
 const {clearTypeCache}=await import('@/app/entity-db/inherit');clearTypeCache();
 return {types,created,linked,skipped:skipped.slice(0,50)};
}
