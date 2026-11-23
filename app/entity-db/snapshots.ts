import type {Queryable} from './client';
// Precomputed pages. Each ranking and entity page's data is computed once, when its data changes, and stored in
// page_data; a page view reads that one row instead of querying observations. The worker keeps the rows current
// (app/entity-db/snapshot-refresh.ts): a page is rebuilt after its data changes (observations of its type, the entity
// itself, its ranking definition or type template), and at least daily. A page with no row yet is built on its first
// view and stored.
export type SnapshotKind='ranking'|'entity';
export async function readSnapshot<T>(db:Queryable,kind:SnapshotKind,key:string):Promise<T|null>{
 try{const r=await db.query<{data:T}>('select data from page_data where kind = $1::text and key = $2::text',[kind,key]);return r.rows[0]?.data??null;}
 catch{return null;}// before the migration: no snapshots
}
export async function saveSnapshot(db:Queryable,kind:SnapshotKind,key:string,type:string,data:unknown):Promise<void>{
 await db.query(`insert into page_data(kind, key, type, data, built_at) values ($1::text, $2::text, $3::text, $4::jsonb, now())
  on conflict (kind, key) do update set type = excluded.type, data = excluded.data, built_at = now()`,[kind,key,type||'',JSON.stringify(data)]);
}
export async function dropSnapshot(db:Queryable,kind:SnapshotKind,key:string):Promise<void>{
 await db.query('delete from page_data where kind = $1::text and key = $2::text',[kind,key]).catch(()=>{});
}
// The stored page, or (none yet, or fresh asked for) built now and stored. typeOf names the page's entity type (what
// makes it stale when that type's data changes).
export async function snapshot<T>(db:Queryable,kind:SnapshotKind,key:string,build:()=>Promise<T|null>,typeOf:(v:T)=>string,fresh=false):Promise<T|null>{
 if(!fresh){const hit=await readSnapshot<T>(db,kind,key);if(hit)return hit;}
 const v=await build();
 if(v)await saveSnapshot(db,kind,key,typeOf(v),v).catch(e=>console.warn('[snapshot] save failed',kind,key,(e as Error).message));
 else await dropSnapshot(db,kind,key);
 return v;
}
