// The entity database never calls a model itself: the LLM layer injects its embedder here
// (one fixed model whose dimension equals ENTITY_EMBED_DIM). Without one, search falls back to
// full text + filters and embedPending does nothing.
export type Embedder=(texts:string[])=>Promise<number[][]>;
const state=globalThis as typeof globalThis&{entityEmbedder?:Embedder|null};
export function setEmbedder(fn:Embedder|null){state.entityEmbedder=fn;}
export function getEmbedder():Embedder|null{return state.entityEmbedder||null;}
// pgvector text form; rejects vectors of the wrong size or with non-finite numbers.
export function toVector(v:number[],dim:number):string{
 if(!Array.isArray(v)||v.length!==dim||!v.every(Number.isFinite))throw Error(`Embedding must be ${dim} finite numbers (got ${Array.isArray(v)?v.length:typeof v}).`);
 return '['+v.join(',')+']';
}
export function entityText(e:{name:string;type:string;aliases?:string[]|null;description?:string|null;attributes?:Record<string,unknown>|null}):string{
 const attrs=Object.entries(e.attributes||{}).filter(([,v])=>v!=null&&typeof v!=='object').slice(0,8).map(([k,v])=>k+': '+String(v).slice(0,60));
 return [e.name+' ('+e.type.replace(/_/g,' ')+')',e.aliases?.length?'also: '+e.aliases.slice(0,10).join(', '):'',e.description||'',attrs.join('; ')].filter(Boolean).join('. ').slice(0,2000);
}
