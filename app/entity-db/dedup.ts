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
  const d=(await db.query<{name:string;aliases:string[];ids:Record<string,string>;attributes:Record<string,unknown>;description:string;image:string|null;num:string;type:string;also:string[]}>('select name, aliases, ids, attributes, description, image, num::text num, type, also_types also from entities where id=$1::uuid',[dropId])).rows[0];
  if(d){
   // Unique id indexes: the dropped entity's ids are released before the kept one takes those it lacks.
   await db.query(`update entities set ids='{}'::jsonb where id=$1::uuid`,[dropId]);
   await db.query(`update entities set aliases=ent_merge_aliases(name, aliases || $2::text[]), ids=$3::jsonb || ids, attributes=$4::jsonb || attributes,
    description=case when description='' then $5::text else description end, image=coalesce(image, $6::text),
    also_types=array(select distinct t from unnest(also_types||$7::text[]) t where t<>type), updated_at=now() where id=$1::uuid`,
    [keepId,[d.name,...(d.aliases||[])],JSON.stringify(d.ids||{}),JSON.stringify(d.attributes||{}),d.description||'',d.image,[d.type,...(d.also||[])]]);
   await db.query(`insert into entity_redirects(num, to_id) values ($1::bigint, $2::uuid) on conflict (num) do update set to_id=excluded.to_id`,[d.num,keepId]);
   await db.query(`update entity_redirects set to_id=$1::uuid where to_id=$2::uuid`,[keepId,dropId]);
  }
  await db.query('delete from entities where id=$1::uuid',[dropId]);
 });
}

// Duplicates already in the database: same normalised name and the same country (both have one), types in one family;
// same-name pairs without a country go to the resolver (findCandidates).
// The entity of the more general type is kept (the ancestor), else the one with more facts. At most `limit` merges.
export async function dedupSweep(db:EntityDb,limit=300):Promise<{merged:number}>{
 const pairs=(await db.query<{a:string;b:string;ta:string;tb:string;na:number;nb:number}>(`with e as (select e.id, e.type, ent_norm(e.name) k, coalesce(e.attributes->>'country','') c from entities e)
  select a.id a, b.id b, a.type ta, b.type tb, (select count(*)::int from observations o where o.entity_id=a.id) na, (select count(*)::int from observations o where o.entity_id=b.id) nb
  from e a join e b on a.k=b.k and a.c=b.c and a.c<>'' and a.id<b.id and a.type<>b.type and a.k<>'' limit $1::int`,[limit*20])).rows;
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

// ───────────── system-wide resolution ─────────────
// Pairs that may be the same real thing across unrelated types (recorded when an entity is created, and found here in
// what is already stored: the same normalised name under two types outside one family) are judged by a model on both
// records (type, country, description, ids) and the same ones merged. Our own GPUs first (class "fast").
export async function findCandidates(db:Queryable,limit=2000):Promise<number>{
 const r=await db.query(`insert into entity_candidates(a,b,reason) select a.id, b.id, 'name' from entities a join entities b on ent_norm(a.name)=ent_norm(b.name) and a.id<b.id and a.type<>b.type
  and coalesce(a.attributes->>'country',b.attributes->>'country','')=coalesce(b.attributes->>'country',a.attributes->>'country','') where length(ent_norm(a.name))>=3
  and not exists (select 1 from entity_candidates c where c.a=a.id and c.b=b.id) limit $1::int on conflict do nothing`,[limit]);
 return (r as unknown as {rowCount?:number}).rowCount??0;
}
type Rec={id:string;name:string;type:string;label:string;country:string|null;description:string;ids:Record<string,string>;facts:number};
const SAME_SCHEMA={type:'object',additionalProperties:false,required:['items'],properties:{items:{type:'array',items:{type:'object',additionalProperties:false,required:['pair','same'],properties:{pair:{type:'integer'},same:{type:'boolean'}}}}}};
export async function resolveCandidates(db:EntityDb,limit=200):Promise<{judged:number;merged:number}>{
 const pend=(await db.query<{a:string;b:string}>(`select a, b from entity_candidates where verdict is null order by created_at limit $1::int`,[limit])).rows;
 if(!pend.length)return {judged:0,merged:0};
 const ids=[...new Set(pend.flatMap(p=>[p.a,p.b]))];
 const recs=new Map((await db.query<Rec>(`select e.id, e.name, e.type, coalesce(et.label,e.type) label, e.attributes->>'country' country, left(e.description,300) description, e.ids,
  (select count(*)::int from observations o where o.entity_id=e.id) facts from entities e left join entity_types et on et.type=e.type where e.id = any($1::uuid[])`,[ids])).rows.map(r=>[r.id,r]));
 const {respond}=await import('@/app/llm');
 let judged=0,merged=0;const gone=new Set<string>();
 for(let i=0;i<pend.length;i+=20){
  const batch=pend.slice(i,i+20).filter(p=>recs.has(p.a)&&recs.has(p.b));
  if(!batch.length)continue;
  const show=(r:Rec)=>({name:r.name,kind:r.label,country:r.country||'',description:r.description||'',ids:r.ids});
  let items:{pair:number;same:boolean}[]=[];
  try{
   const out=await respond({class:'fast',store:false,instructions:'Entity resolution for a public encyclopedia of rankings. For each pair, decide whether both records describe the same single real-world thing (the same country, the same company, the same person…). The kind labels may differ (a country stored once as "Country" and once as "Expat destination" is the same country). Different things that share a name are not the same (Apple the company vs apple the fruit; Paris, France vs Paris, Texas; a film vs the book it adapts). When unsure, answer false.',
    input:JSON.stringify(batch.map((p,k)=>({pair:k,a:show(recs.get(p.a)!),b:show(recs.get(p.b)!)}))),text:{format:{type:'json_schema',name:'same_entities',schema:SAME_SCHEMA,strict:true}},max_output_tokens:2000} as never);
   const text=((out as {output?:{content?:{type?:string;text?:string}[]}[]}).output||[]).flatMap(o=>o.content||[]).map(c=>c.type==='output_text'?c.text||'':'').join('');
   items=(JSON.parse(text) as {items:{pair:number;same:boolean}[]}).items||[];
  }catch{break;}// no model now: try again next run
  for(const it of items){
   const p=batch[it.pair];if(!p)continue;judged++;
   await db.query(`update entity_candidates set verdict=$3::text, judged_at=now() where a=$1::uuid and b=$2::uuid`,[p.a,p.b,it.same?'same':'different']);
   if(!it.same||gone.has(p.a)||gone.has(p.b))continue;
   const A=recs.get(p.a)!,B=recs.get(p.b)!;
   // Keep the record with more facts (then the older one): its type stays primary, the other's joins also_types.
   const [keep,drop]=A.facts>=B.facts?[A,B]:[B,A];
   await mergeEntities(db,keep.id,drop.id);gone.add(drop.id);merged++;
  }
 }
 return {judged,merged};
}
