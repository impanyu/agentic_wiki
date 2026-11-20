// Entity database (rankwiki): PostgreSQL 16 + pgvector in production, PGlite locally and in tests.
// See README.md in this folder.
export {entityDb,createEntityDb,setEntityDb,type EntityDb,type Queryable} from './client';
export {setEmbedder,getEmbedder,type Embedder} from './embeddings';
export {migrate,SCHEMA_VERSION,STANDARD_ID_KEYS} from './schema';
export * from './repo';
export {parseDefinition,evaluateDefinition,competitionRanks,type DerivedDefinition} from './metrics';
export {entityTools,entityToolNames,runEntityTool} from './tools';
