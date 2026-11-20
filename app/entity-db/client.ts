import {resolve} from 'node:path';
import {migrate} from './schema';
// The entity database client. One small interface over two engines:
// - ENTITY_DB_URL=postgres://… → a node-postgres Pool (production: PostgreSQL 16 + pgvector);
// - otherwise PGlite (Postgres in WASM with pgvector) persisted at ${DATA_DIR}/entity-db, or in memory for tests.
// The same SQL runs on both. numeric and bigint come back as JS numbers on both engines.
export type Row=Record<string,unknown>;
export interface Queryable{query<T=Row>(sql:string,params?:unknown[]):Promise<{rows:T[]}>}
export interface EntityDb extends Queryable{
 kind:'postgres'|'pglite';
 tx<T>(fn:(q:Queryable)=>Promise<T>):Promise<T>;
 close():Promise<void>;
}
const NUMERIC=1700,INT8=20;
const toNumber=(v:unknown)=>v==null?v:Number(v);

async function postgresDb(url:string):Promise<EntityDb>{
 const pg=await import('pg');
 const Pool=pg.Pool||(pg as unknown as {default:typeof pg}).default.Pool;
 const builtin=pg.types||(pg as unknown as {default:typeof pg}).default.types;
 const pool=new Pool({connectionString:url,max:Number(process.env.ENTITY_DB_POOL)||10,idleTimeoutMillis:30_000,
  types:{getTypeParser:((oid:number,format?:'text'|'binary')=>oid===NUMERIC||oid===INT8?toNumber:builtin.getTypeParser(oid,format as 'text')) as never}});
 pool.on('error',e=>console.error('entity-db pool error',e));
 const wrap=(c:{query:(s:string,p:unknown[])=>Promise<{rows:unknown[]}>}):Queryable=>({query:async<T>(s:string,p:unknown[]=[])=>({rows:(await c.query(s,p)).rows as T[]})});
 return {kind:'postgres',...wrap(pool),
  async tx(fn){const c=await pool.connect();
   try{await c.query('BEGIN');const out=await fn(wrap(c));await c.query('COMMIT');return out;}
   catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}
   finally{c.release();}},
  close:()=>pool.end()};
}

async function pgliteDb(dataDir?:string):Promise<EntityDb>{
 const {PGlite}=await import('@electric-sql/pglite');
 const {vector}=await import('@electric-sql/pglite-pgvector');
 const options={extensions:{vector},parsers:{[NUMERIC]:toNumber,[INT8]:toNumber}};
 const db=dataDir?await PGlite.create(dataDir,options):await PGlite.create(options);
 return {kind:'pglite',
  query:async<T>(s:string,p:unknown[]=[])=>({rows:(await db.query<T>(s,p)).rows}),
  tx:fn=>db.transaction(t=>fn({query:async<T>(s:string,p:unknown[]=[])=>({rows:(await t.query<T>(s,p)).rows})})),
  close:()=>db.close()};
}

export type EntityDbOptions={url?:string;dataDir?:string;memory?:boolean;embedDim?:number;migrate?:boolean};
export const embedDimFromEnv=()=>{const n=Number(process.env.ENTITY_EMBED_DIM||768);if(!Number.isInteger(n)||n<1||n>16000)throw Error('ENTITY_EMBED_DIM must be an integer between 1 and 16000.');return n;};
// Factory: explicit options win over the environment. memory:true gives a throwaway PGlite (tests).
export async function createEntityDb(options:EntityDbOptions={}):Promise<EntityDb>{
 const url=options.memory?'':options.url??process.env.ENTITY_DB_URL??'';
 const db=url?await postgresDb(url):await pgliteDb(options.memory?undefined:options.dataDir||resolve(process.env.DATA_DIR||'./data','entity-db'));
 if(options.migrate!==false)await migrate(db,{embedDim:options.embedDim??embedDimFromEnv()});
 return db;
}
// Process-wide instance, created and migrated on first use (kept on globalThis to survive dev reloads).
const state=globalThis as typeof globalThis&{entityDb?:Promise<EntityDb>};
export function entityDb():Promise<EntityDb>{
 return state.entityDb??=createEntityDb().catch(e=>{state.entityDb=undefined;throw e;});
}
// For tests and tooling: use this database as the process-wide instance.
export function setEntityDb(db:EntityDb|null){state.entityDb=db?Promise.resolve(db):undefined;}
