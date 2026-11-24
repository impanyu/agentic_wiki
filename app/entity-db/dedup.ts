import type {Queryable,EntityDb} from './client';
// Entity identity across the type hierarchy. Topics may overlap (universities in Asia, research universities), so the
// same real thing can be collected from several places; it must stay one entity. Its "family" is where a duplicate
// can arise: its own type, its ancestors, its descendants, and — below a non-root parent — its siblings' subtrees
// (research_university and asian_university share university). Matching in the family uses the standard ids, then
// the normalised name with the same country (when both entities have one).
type Row={type:string;parent:string|null};
let cache:{at:number;parent:Map<string,string|null>;kids:Map<string,string[]>}|null=null;
async function hierarchy(db:Queryable){
 if(!cache||Date.now()-cache.at>60_000){
  const rows=(await db.query<Row>("select type, schema->>'extends' parent from entity_types")).rows;
  const parent=new Map<string,string|null>(),kids=new Map<string,string[]>();
  for(const r of rows){parent.set(r.type,r.parent||null);if(r.parent){const l=kids.get(r.parent)??[];l.push(r.type);kids.set(r.parent,l);}}
  cache={at:Date.now(),parent,kids};
 }
 return cache;
}
const subtree=(kids:Map<string,string[]>,root:string)=>{const out=[root],seen=new Set(out);for(let i=0;i<out.length&&out.length<800;i++)for(const k of kids.get(out[i])||[])if(!seen.has(k)){seen.add(k);out.push(k);}return out;};
export async function typeFamily(db:Queryable,type:string):Promise<string[]>{
 const h=await hierarchy(db);const out=new Set<string>(subtree(h.kids,type));
 // Ancestors (at most 8 levels).
 for(let t=h.parent.get(type)??null,n=0;t&&n<8;t=h.parent.get(t)??null,n++)out.add(t);
 // Siblings' subtrees, when the parent is itself a specific type (it extends something): not under a root such as
 // "place", where a city and a country may share a name.
 const p=h.parent.get(type)??null;
 if(p&&h.parent.get(p))for(const s of subtree(h.kids,p))out.add(s);
 return [...out];
}
export function clearFamilyCache(){cache=null;}

// One entity absorbs another: the dropped one's facts, relations, ids, aliases and attributes move to the kept one
// (the kept one's own values win), its page address redirects, and it is deleted.
export async function mergeEntities(edb:EntityDb,keepId:string,dropId:string):Promise<void>{
 if(keepId===dropId)return;
 await edb.tx(async db=>{
  await db.query(`update observations o set entity_id=$1::uuid where entity_id=$2::uuid and not exists (select 1 from observations x where x.entity_id=$1::uuid and x.metric=o.metric and x.period=o.period and x.source=o.source)`,[keepId,dropId]);
  await db.query(`update relations r set subject_id=$1::uuid where subject_id=$2::uuid and object_id<>$1::uuid and not exists (select 1 from relations x where x.subject_id=$1::uuid and x.predicate=r.predicate and x.object_id=r.object_id)`,[keepId,dropId]);
  await db.query(`update relations r set object_id=$1::uuid where object_id=$2::uuid and subject_id<>$1::uuid and not exists (select 1 from relations x where x.object_id=$1::uuid and x.predicate=r.predicate and x.subject_id=r.subject_id)`,[keepId,dropId]);
  const d=(await db.query<{name:string;aliases:string[];ids:Record<string,string>;attributes:Record<string,unknown>;description:string;image:string|null;num:string}>('select name, aliases, ids, attributes, description, image, num::text num from entities where id=$1::uuid',[dropId])).rows[0];
  if(d){
   // Unique id indexes: the dropped entity's ids are released before the kept one takes those it lacks.
   await db.query(`update entities set ids='{}'::jsonb where id=$1::uuid`,[dropId]);
   await db.query(`update entities set aliases=ent_merge_aliases(name, aliases || $2::text[]), ids=$3::jsonb || ids, attributes=$4::jsonb || attributes,
    description=case when description='' then $5::text else description end, image=coalesce(image, $6::text), updated_at=now() where id=$1::uuid`,
    [keepId,[d.name,...(d.aliases||[])],JSON.stringify(d.ids||{}),JSON.stringify(d.attributes||{}),d.description||'',d.image]);
   await db.query(`insert into entity_redirects(num, to_id) values ($1::bigint, $2::uuid) on conflict (num) do update set to_id=excluded.to_id`,[d.num,keepId]);
   await db.query(`update entity_redirects set to_id=$1::uuid where to_id=$2::uuid`,[keepId,dropId]);
  }
  await db.query('delete from entities where id=$1::uuid',[dropId]);
 });
}

// Duplicates already in the database: same normalised name, same country (or neither has one), types in one family.
// The entity of the more general type is kept (the ancestor), else the one with more facts. At most `limit` merges.
export async function dedupSweep(db:EntityDb,limit=300):Promise<{merged:number}>{
 const pairs=(await db.query<{a:string;b:string;ta:string;tb:string;na:number;nb:number}>(`with e as (select e.id, e.type, ent_norm(e.name) k, coalesce(e.attributes->>'country','') c from entities e)
  select a.id a, b.id b, a.type ta, b.type tb, (select count(*)::int from observations o where o.entity_id=a.id) na, (select count(*)::int from observations o where o.entity_id=b.id) nb
  from e a join e b on a.k=b.k and a.c=b.c and a.id<b.id and a.type<>b.type and a.k<>'' limit $1::int`,[limit*20])).rows;
 const h=await hierarchy(db);const ancestors=(t:string)=>{const s=new Set<string>();for(let x=h.parent.get(t)??null,n=0;x&&n<8;x=h.parent.get(x)??null,n++)s.add(x);return s;};
 const gone=new Set<string>();let merged=0;
 for(const p of pairs){
  if(merged>=limit)break;if(gone.has(p.a)||gone.has(p.b))continue;
  const fam=await typeFamily(db,p.ta);if(!fam.includes(p.tb))continue;
  const keepA=ancestors(p.tb).has(p.ta)?true:ancestors(p.ta).has(p.tb)?false:p.na>=p.nb;
  const [keep,drop]=keepA?[p.a,p.b]:[p.b,p.a];
  await mergeEntities(db,keep,drop);gone.add(drop);merged++;
 }
 return {merged};
}
