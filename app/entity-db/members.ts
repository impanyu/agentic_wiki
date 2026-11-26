import type {Queryable,EntityDb} from './client';
import {entitySearchIds,type Scope} from './repo';
// A ranking's stored query (its scope: class, tree node, filters) is evaluated by the database and its result kept in
// ranking_members, like a materialized view. A ranking is refreshed when an entity of its class changed after its last
// refresh, and at least daily (metric filters move with new data). Pages read the members in one indexed lookup.
const MAX=Number(process.env.RANKING_MEMBERS_MAX||20000);
export async function refreshMembers(db:EntityDb,{limit=150}:{limit?:number}={}):Promise<{refreshed:number}>{
 const due=(await db.query<{id:string;scope:Scope;at:string|null}>(`select id, scope, members_at at from rankings where status <> 'archived' and slug is not null
  order by members_at nulls first limit 2000`)).rows;
 const {withSubtypes}=await import('./inherit');
 let refreshed=0;
 for(const r of due){
  if(refreshed>=limit)break;
  if(r.at&&Date.now()-Date.parse(r.at)<24*3600_000){
   const types=r.scope?.type?await withSubtypes(db,String(r.scope.type)):[];
   const changed=(await db.query(`select 1 from entities where updated_at > $1::timestamptz and (type = any($2::text[]) or also_types && $2::text[] or $3::boolean) limit 1`,[r.at,types,!types.length])).rows.length;
   if(!changed)continue;
  }
  await refreshOne(db,r.id,r.scope).catch(e=>console.warn('[members]',r.id,(e as Error).message));refreshed++;
 }
 return {refreshed};
}
export async function refreshOne(db:EntityDb,id:string,scope:Scope){
 const ids=await entitySearchIds(db,{type:scope?.type,node:scope?.node,filters:scope?.filters},MAX);
 await db.tx(async q=>{
  await q.query('delete from ranking_members where ranking_id=$1::uuid',[id]);
  if(ids.length)await q.query('insert into ranking_members(ranking_id, entity_id) select $1::uuid, unnest($2::uuid[]) on conflict do nothing',[id,ids]);
  await q.query('update rankings set members_at=now() where id=$1::uuid',[id]);
 });
}
// For each of these rankings: whether the entity is a member (true/false), or null when its members are not computed yet.
export async function memberOf(db:Queryable,entityId:string,slugs:string[]):Promise<Map<string,boolean|null>>{
 const r=(await db.query<{slug:string;at:string|null;m:boolean}>(`select r.slug, r.members_at at, (m.entity_id is not null) m from rankings r
  left join ranking_members m on m.ranking_id = r.id and m.entity_id = $1::uuid where r.slug = any($2::text[])`,[entityId,slugs])).rows;
 return new Map(r.map(x=>[x.slug,x.at?x.m:null]));
}
