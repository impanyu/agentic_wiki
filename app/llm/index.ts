// The app's single entry point for model calls. See app/llm/README.md.
import {createLLM,searched,type UsageRow,type Embedder} from './core';
import {reasoningOptions} from '@/app/agents/reasoning';
import {readEvents} from '@/app/event-stream';
import {database} from '@/db/store';
import {env} from '@/server/runtime';
import type {LLMRequest,LLMResponse,StreamHandlers,TaskClass} from './types';
export type {LLMRequest,LLMResponse,TaskClass,Embedder};
export {searched};

const usage={
 async record(row:UsageRow){
  await database().prepare('INSERT INTO llm_usage(created_at,month,class,provider,model,status,latency_ms,input_tokens,cached_tokens,output_tokens,cost_usd,web_searches,fallback_reason) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(row.createdAt,row.month,row.class,row.provider,row.model,row.status,Math.round(row.latencyMs),row.inputTokens,row.cachedTokens,row.outputTokens,row.costUsd,row.webSearches,row.fallbackReason).run();
 },
 async daySpend(day:string,provider:string){
  const row=await database().prepare('SELECT COALESCE(SUM(cost_usd),0) spent FROM llm_usage WHERE created_at>=? AND provider=?').bind(day,provider).first<{spent:number}>();
  return Number(row?.spent||0);
 },
 async monthSpend(month:string){
  const row=await database().prepare("SELECT COALESCE(SUM(cost_usd),0) spent FROM llm_usage WHERE month=? AND provider IN ('openai','deepseek')").bind(month).first<{spent:number}>();
  return Number(row?.spent||0);
 },
};
// The pool's availability is read synchronously; the module loads on first use.
let poolMod:typeof import('./pool')|null=null;void import('./pool').then(m=>{poolMod=m;}).catch(()=>{});
const poolAvailableSync=(m:string)=>!!poolMod?.poolAvailable(m);
const state=globalThis as typeof globalThis&{agenticLLM?:ReturnType<typeof createLLM>};
function llm(){
 return state.agenticLLM??=createLLM({
  env:name=>(env as unknown as Record<string,string|undefined>)[name]||process.env[name],
  fetch:(...args)=>fetch(...args),usage,readEvents,
  // Our own GPUs (lab machine, HCC jobs) through the pull queue.
  pool:{available:m=>poolAvailableSync(m),slots:m=>poolMod?.poolSlots(m),run:(m,b,t,s,w)=>import('./pool').then(p=>p.poolRun(m,b,t,s,w))},
  // Same defaults the direct OpenAI helper applied: explicit effort for known model families.
  openaiDefaults:body=>reasoningOptions(String(body.model||'')),
 });
}
// Every model call of the site goes through one scheduler (the worker process's): see ./remote.
export function respondLocal(request:LLMRequest,signal?:AbortSignal):Promise<LLMResponse>{return llm().respond(request,signal);}
export async function respond(request:LLMRequest,signal?:AbortSignal):Promise<LLMResponse>{
 const r=await import('./remote');
 return r.delegated()?r.viaScheduler('respond',{request},()=>respondLocal(request,signal),signal):respondLocal(request,signal);
}
export function respondStream(request:LLMRequest,handlers:StreamHandlers,signal?:AbortSignal):Promise<LLMResponse>{return llm().respondStream(request,handlers,signal);}
// Entity-index embeddings: fixed model + dimension (ENTITY_EMBED_MODEL / ENTITY_EMBED_DIM).
export function embedderLocal():Embedder{return llm().embedder();}
export function embedder():Embedder{
 const local=embedderLocal();
 if(process.env.RANKWIKI_ROLE!=='web')return local;
 return Object.assign(async(texts:string[],signal?:AbortSignal)=>{const r=await import('./remote');return r.delegated()?r.viaScheduler('embed',{texts},()=>local(texts,signal),signal):local(texts,signal);},{model:local.model,dims:local.dims});
}
// The site's question/page-profile vectors (text-embedding-3-small, 512 dims). Never changes.
export function siteEmbedLocal(texts:string[],signal?:AbortSignal){return llm().siteEmbed(texts,signal);}
export async function siteEmbed(texts:string[],signal?:AbortSignal):Promise<number[][]>{
 const r=await import('./remote');
 return r.delegated()?r.viaScheduler('siteEmbed',{texts},()=>siteEmbedLocal(texts,signal),signal):siteEmbedLocal(texts,signal);
}
// Current month's metered OpenAI spend against LLM_MONTHLY_BUDGET_USD.
export function llmSpend(){return llm().spend();}
export function llmStatus(){const l=llm();return {rates:l.tracker.snapshot(),chains:Object.fromEntries((['premium','agent','fast','vision','translate','instant','review','extract','extract-test'] as TaskClass[]).map(c=>[c,l.chain({class:c}).map(e=>e.id)]))};}
