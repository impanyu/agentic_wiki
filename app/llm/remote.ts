import {createHash,timingSafeEqual} from 'node:crypto';
import type {LLMRequest} from './types';
// One scheduler for the whole site: the web process (RANKWIKI_ROLE=web) does not run models itself; it hands each
// request to the worker process's scheduler (app/api/llm/schedule). While the worker is unreachable (a restart), the
// web process runs the request itself so pages keep working.
const token=()=>{const own=process.env.LLM_SCHEDULER_TOKEN;if(own)return own;const base=process.env.TEAM_ADMIN_TOKEN||process.env.LLM_POOL_TOKEN||'';return base?createHash('sha256').update('llm-scheduler:'+base).digest('hex'):'';};
export function schedulerAuthorized(request:Request){
 const want=token(),got=request.headers.get('x-llm-scheduler')||'';
 return !!want&&got.length===want.length&&timingSafeEqual(Buffer.from(got),Buffer.from(want));
}
// Processes other than the scheduler's own (the worker): the web process and the team worker processes.
export const delegated=()=>(process.env.RANKWIKI_ROLE==='web'||process.env.RANKWIKI_ROLE==='teams')&&!!token();
const url=()=>process.env.LLM_SCHEDULER_URL||'http://127.0.0.1:'+(process.env.WORKER_PORT||'3003')+'/api/llm/schedule';
let downUntil=0;
// Runs op on the worker's scheduler; `local` when the worker cannot be reached. Model errors (AI_LIMIT…) pass through.
export async function viaScheduler<T>(op:string,payload:Record<string,unknown>,local:()=>Promise<T>,signal?:AbortSignal):Promise<T>{
 if(Date.now()<downUntil)return local();
 let r:Response;
 try{r=await fetch(url(),{method:'POST',headers:{'content-type':'application/json','x-llm-scheduler':token()},body:JSON.stringify({op,...payload}),signal});}
 catch(e){if(signal?.aborted)throw e;downUntil=Date.now()+15_000;return local();}
 if(r.status===403||r.status===404||r.status>=500){downUntil=Date.now()+15_000;return local();}
 const b=await r.json() as {ok:boolean;value?:T;error?:string};
 if(!b.ok)throw Error(b.error||'AI_UNAVAILABLE');
 return b.value as T;
}
export async function runScheduled(b:{op?:string;request?:unknown;texts?:string[]},signal:AbortSignal){
 const llm=await import('./index');
 if(b.op==='state')return llm.schedulerStateLocal();
 if(b.op==='respond')return llm.respondLocal(b.request as LLMRequest,signal);
 if(b.op==='siteEmbed')return llm.siteEmbedLocal((b.texts||[]).map(String),signal);
 if(b.op==='embed')return llm.embedderLocal()((b.texts||[]).map(String),signal);
 throw Error('unknown op');
}
