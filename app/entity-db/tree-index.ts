import type {Queryable} from './client';
// The topic tree is one structure with two uses.
//  - For the collector it is the index of every entity: each node divides its entities by ONE attribute
//    (topics.scope.split = {key, label}); each child is one value of it (topics.scope.value: the value and its other
//    written forms). Each node also carries what to collect (the type schema of the node: attributes, metrics,
//    sources), inherited by everything below it. An entity sits at ONE node (entities.node_id): the deepest node its
//    attributes lead to. Everything above it is derived from the tree, never stored on the entity. An entity that lacks
//    a node's split attribute stays at that node: a gap the collector fills.
//  - For the editor it is the site's page hierarchy: each node is a topic page with its main ranking; other pages
//    (G20 countries, national parks in Canada) are rankings attached to a node with a query over attributes. They hold
//    no members of their own and are not part of the index.
type Row=Record<string,unknown>;
const KIDS=`kids as (select c.id cid, p.id pid, p.scope->'split'->>'key' k, ent_norm(v) val
  from topics p join topics c on c.parent_id = p.id and c.status <> 'archived' and coalesce(c.scope->>'role','') <> 'view',
  jsonb_array_elements_text(case jsonb_typeof(c.scope->'value') when 'array' then c.scope->'value' when 'string' then jsonb_build_array(c.scope->'value') else '[]'::jsonb end) v
  where p.status <> 'archived' and coalesce(p.scope->'split'->>'key','') <> '')`;
// The entity's value of an attribute, as text (the first element of a list).
const VAL=`ent_norm(case jsonb_typeof(e.attributes->kids.k) when 'array' then e.attributes->kids.k->>0 else e.attributes->>kids.k end)`;

// Places entities in the tree: home node first (the node of the entity's type), then down the splits as far as its
// attributes lead; an entity whose attribute no longer matches its node moves back up. Bounded per call.
export async function placeEntities(db:Queryable,{limit=200_000}:{limit?:number}={}):Promise<{homed:number;moved:number}>{
 const homed=(await db.query(`with h as (select e.id, coalesce(et.topic_id, e.topic_id) home from entities e left join entity_types et on et.type = e.type
   where e.node_id is null and coalesce(et.topic_id, e.topic_id) is not null limit $1::int)
  update entities e set node_id = h.home from h where e.id = h.id returning e.id`,[limit])).rows.length;
 let moved=0;
 for(let depth=0;depth<12;depth++){
  // Up: the entity has a value for the split that no longer names its node (a player who changed leagues).
  const up=(await db.query(`with ${KIDS}, cur as (select distinct cid, pid, k from kids)
   update entities e set node_id = cur.pid from cur where e.node_id = cur.cid and coalesce(e.attributes->>cur.k,'') <> ''
    and not exists (select 1 from kids where kids.cid = cur.cid and ${VAL} = kids.val) returning e.id`)).rows.length;
  // Down: the entity's value names a child.
  const down=(await db.query(`with ${KIDS}, m as (select distinct on (e.id) e.id, kids.cid from entities e join kids on e.node_id = kids.pid and ${VAL} = kids.val order by e.id, kids.cid limit $1::int)
   update entities e set node_id = m.cid from m where e.id = m.id returning e.id`,[limit])).rows.length;
  moved+=up+down;
  if(!down)break;
 }
 return {homed,moved};
}

// A node and every node below it.
export async function subtreeIds(db:Queryable,nodeId:string):Promise<string[]>{
 return (await db.query<{id:string}>(`with recursive d(id, depth) as (select $1::uuid, 0 union all select t.id, d.depth + 1 from topics t join d on t.parent_id = d.id where t.status <> 'archived' and d.depth < 16) select id from d`,[nodeId])).rows.map(r=>r.id);
}
// What the collector sees at a node: its split, each child's value and member count, the members still at the node
// itself (no value for the split yet), and the inherited schema.
export async function nodeIndex(db:Queryable,nodeId:string):Promise<Row>{
 const n=(await db.query<{slug:string;name:string;scope:Row}>('select slug, name, scope from topics where id=$1::uuid',[nodeId])).rows[0];
 if(!n)return {};
 const kids=(await db.query<{slug:string;name:string;value:unknown;role:string|null;n:number}>(`select c.slug, c.name, c.scope->'value' value, c.scope->>'role' role,
   (select count(*)::int from entities e where e.node_id = any(array(with recursive d(id) as (select c.id union all select t.id from topics t join d on t.parent_id = d.id where t.status <> 'archived') select id from d))) n
   from topics c where c.parent_id = $1::uuid and c.status <> 'archived' order by c.name`,[nodeId])).rows;
 const here=Number((await db.query<{n:number}>('select count(*)::int n from entities where node_id=$1::uuid',[nodeId])).rows[0]?.n||0);
 return {slug:n.slug,name:n.name,split:n.scope?.split??null,children:kids.filter(k=>k.role!=='view'),views:kids.filter(k=>k.role==='view').map(k=>k.slug),unplaced:here};
}
