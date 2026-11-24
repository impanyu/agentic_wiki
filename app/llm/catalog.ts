// THE single place for providers, model ids, capabilities, known limits and task-class chains.
// Free-tier model ids and quotas change often: edit here, or override at deploy time with the
// env var LLM_CATALOG_OVERRIDES (JSON, deep-merged), e.g.
//   {"models":{"nrp:qwen3":{"model":"qwen3-vl-235b","limits":{"concurrency":2}}},"chains":{"fast":["groq:gpt-oss-120b","openai"]}}
// Limits below are the providers' published free-tier numbers where known (checked 2026-11);
// unknown limits are left undefined (only reactive 429 handling applies).
import type {TaskClass} from './types';

export type ProviderId='openai'|'nrp'|'gemini'|'openrouter'|'groq'|'deepseek'|'pool';
export type ProviderConfig={id:ProviderId;kind:'responses'|'chat';base:string;keyEnv:string;premium?:boolean;
 // Default cooldown after a 429 without Retry-After. OpenAI is 0: one TPM spike must not block production.
 cooldownMs:number;headers?:Record<string,string>};
export type Limits={rpm?:number;rpd?:number;tpm?:number;concurrency?:number;dayReset?:'utc'|'pacific'};
export type Capabilities={tools:boolean;vision:boolean;jsonSchema:boolean;jsonObject:boolean;reasoningEffort:boolean;context:number;maxOutput:number;thinkTags?:boolean};
export type EmbedSpec={dims:number;supportsDimensions:boolean;matryoshka:boolean;maxBatch:number};
export type ModelEntry={id:string;provider:ProviderId;model:string;family:string;caps:Capabilities;limits:Limits;embed?:EmbedSpec;timeoutMs?:number};
export type Catalog={providers:Record<ProviderId,ProviderConfig>;models:Record<string,ModelEntry>;chains:Record<Exclude<TaskClass,'embed'|'site-embed'>,string[]>;premiumFallback:'agent';siteEmbed:{model:string;dims:number};defaultEmbed:string[]};

const chat=(o:Partial<Capabilities>={}):Capabilities=>({tools:true,vision:false,jsonSchema:true,jsonObject:true,reasoningEffort:false,context:128000,maxOutput:8192,...o});
const m=(id:string,provider:ProviderId,model:string,family:string,caps:Capabilities,limits:Limits={},extra:Partial<ModelEntry>={}):[string,ModelEntry]=>[id,{id,provider,model,family,caps,limits,...extra}];

export const BASE_CATALOG:Catalog={
 providers:{
  openai:{id:'openai',kind:'responses',base:'https://api.openai.com/v1',keyEnv:'OPENAI_API_KEY',premium:true,cooldownMs:0},
  nrp:{id:'nrp',kind:'chat',base:'https://ellm.nrp-nautilus.io/v1',keyEnv:'NRP_LLM_TOKEN',cooldownMs:20000},
  // Our own GPUs (app/llm/pool.ts): offered only while a worker serving the model is connected; free.
  pool:{id:'pool',kind:'chat',base:'',keyEnv:'',cooldownMs:15000},
  // DeepSeek's own API (paid, capped per day by DEEPSEEK_DAILY_USD): the builders' model on its own servers.
  deepseek:{id:'deepseek',kind:'chat',base:'https://api.deepseek.com',keyEnv:'DEEPSEEK_API_KEY',cooldownMs:20000},
  gemini:{id:'gemini',kind:'chat',base:'https://generativelanguage.googleapis.com/v1beta/openai',keyEnv:'GEMINI_API_KEY',cooldownMs:30000},
  openrouter:{id:'openrouter',kind:'chat',base:'https://openrouter.ai/api/v1',keyEnv:'OPENROUTER_API_KEY',cooldownMs:30000,headers:{'X-Title':'Agentic Wiki'}},
  groq:{id:'groq',kind:'chat',base:'https://api.groq.com/openai/v1',keyEnv:'GROQ_API_KEY',cooldownMs:20000},
 },
 models:Object.fromEntries([
  // "openai" = the model the caller selected (OPENAI_MODEL / OPENAI_AGENT_MODEL), passed through unchanged.
  m('openai','openai','(caller)','openai',chat({vision:true,reasoningEffort:true,context:400000,maxOutput:128000})),
  // Fixed OpenAI models for the chains (prices in prices.ts): Luna is the low-cost tier (scored like Terra on our
  // extraction and translation tests, 2026-11-23), Terra the stronger tier kept for escalations.
  m('openai:luna','openai','gpt-5.6-luna','openai',chat({vision:true,reasoningEffort:true,context:400000,maxOutput:128000})),
  m('openai:terra','openai','gpt-5.6-terra','openai',chat({vision:true,reasoningEffort:true,context:400000,maxOutput:128000})),
  m('openai:text-embedding-3-small','openai','text-embedding-3-small','openai',chat({tools:false}),{},{embed:{dims:1536,supportsDimensions:true,matryoshka:true,maxBatch:256}}),
  // NRP Nautilus managed LLMs. Fair Use Policy (nrp.ai/documentation/userdocs/ai/llm-managed/fair-use/, Nov 2026):
  // per-user concurrency kimi/glm-5 2, minimax/gemma 8, qwen3/deepseek-v4-flash/gpt-oss/qwen3-embedding 16; the gateway
  // also caps 48k output tokens/minute per token and model (HTTP 429, handled by the cooldown). Long requests (>35% of
  // context) are limited to 1 at a time. We stay a little under the published limits.
  m('nrp:qwen3','nrp','qwen3','qwen',chat({vision:true,context:262144,maxOutput:32768,thinkTags:true}),{concurrency:12},{timeoutMs:120000}),
  m('pool:local','pool','local','local',chat({context:131072,maxOutput:16384}),{concurrency:64},{timeoutMs:300000}),
  // Our V100s (llama.cpp, a quantized model): extraction only.
  m('pool:v100','pool','v100','local',chat({context:32768,maxOutput:8192}),{concurrency:16},{timeoutMs:300000}),
  m('deepseek:v4-flash','deepseek','deepseek-v4-flash','deepseek',chat({context:131072,maxOutput:32768}),{concurrency:64},{timeoutMs:120000}),
  m('nrp:deepseek-v4-flash','nrp','deepseek-v4-flash','deepseek',chat({context:131072,maxOutput:32768}),{concurrency:12},{timeoutMs:120000}),
  m('nrp:glm-5','nrp','glm-5','glm',chat({context:131072,maxOutput:32768,thinkTags:true}),{concurrency:2},{timeoutMs:120000}),
  m('nrp:kimi','nrp','kimi','kimi',chat({context:131072,maxOutput:32768}),{concurrency:2},{timeoutMs:120000}),
  m('nrp:minimax','nrp','minimax','minimax',chat({vision:true,context:1000000,maxOutput:32768}),{concurrency:6},{timeoutMs:120000}),
  m('nrp:gemma','nrp','gemma','gemma',chat({vision:true,context:131072,maxOutput:8192}),{concurrency:6}),
  m('nrp:gpt-oss','nrp','gpt-oss','gpt-oss',chat({reasoningEffort:true,context:131072,maxOutput:16384}),{concurrency:12}),
  m('nrp:qwen3-embedding','nrp','qwen3-embedding','qwen',chat({tools:false}),{concurrency:12},{embed:{dims:4096,supportsDimensions:false,matryoshka:false,maxBatch:64}}),
  // Gemini API free tier; daily quotas reset at midnight Pacific time.
  m('gemini:gemini-4-hydrogen','gemini','gemini-4-hydrogen','gemini',chat({vision:true,reasoningEffort:true,context:1048576,maxOutput:65536}),{rpm:5,tpm:250000,rpd:100,dayReset:'pacific'},{timeoutMs:180000}),
  m('gemini:gemini-3.8-flash','gemini','gemini-3.8-flash','gemini',chat({vision:true,reasoningEffort:true,context:1048576,maxOutput:65536}),{rpm:10,tpm:250000,rpd:250,dayReset:'pacific'}),
  m('gemini:gemini-3.8-flash-lite','gemini','gemini-3.5-flash-lite','gemini',chat({vision:true,reasoningEffort:true,context:1048576,maxOutput:65536}),{rpm:15,tpm:250000,rpd:1000,dayReset:'pacific'}),
  m('gemini:gemini-embedding-2','gemini','gemini-embedding-2','gemini',chat({tools:false}),{rpm:100,tpm:30000,rpd:1000,dayReset:'pacific'},{embed:{dims:3072,supportsDimensions:true,matryoshka:true,maxBatch:100}}),
  // OpenRouter ":free" variants: 20 RPM; 50 RPD without purchased credits (1000 with), UTC reset.
  m('openrouter:nemotron-3-ultra','openrouter','nvidia/nemotron-3-ultra-550b-a55b:free','nemotron',chat({jsonSchema:false,context:131072,maxOutput:16384}),{rpm:20,rpd:50,dayReset:'utc'},{timeoutMs:180000}),
  m('openrouter:nemotron-3.5-super-vl','openrouter','nvidia/nemotron-3.5-super-vl:free','nemotron',chat({vision:true,jsonSchema:false,context:131072,maxOutput:16384}),{rpm:20,rpd:50,dayReset:'utc'}),
  m('openrouter:gemma-4-31b','openrouter','google/gemma-4-31b-it:free','gemma',chat({vision:true,jsonSchema:false,context:131072,maxOutput:8192}),{rpm:20,rpd:50,dayReset:'utc'}),
  // Groq free tier for gpt-oss-120b.
  m('groq:gpt-oss-120b','groq','openai/gpt-oss-120b','gpt-oss',chat({reasoningEffort:true,context:131072,maxOutput:32766}),{rpm:30,rpd:1000,tpm:8000,dayReset:'utc'}),
 ]),
 // THE routing table: for each task, the preferred model first, then the fallbacks in order. Own GPUs (free) first,
 // then low-cost paid models, free shared models as the reserve; the strong paid model (Terra) only when a task
 // escalates. Paid models stop for the day at their daily cap (OPENAI_DAILY_USD, DEEPSEEK_DAILY_USD) and the
 // month at LLM_MONTHLY_BUDGET_USD (all paid providers together).
 // Removed 2026-11-23 after 3 days of production measurements (success rate per call): nrp:kimi 7%, nrp:gpt-oss 20%,
 // nrp:glm-5 53%, nrp:qwen3 61%, nrp:minimax 69% as a builder (91% as a reviewer, kept there), groq:gpt-oss-120b 0%
 // (our requests exceed its size limit), gemini:gemini-4-hydrogen 7% (daily quota), openrouter nemotron 70%.
 chains:{
  // Escalation: a task the agent chain failed (or a caller asking for the best model).
  premium:['openai:terra'],
  // Builders (team editors and collectors): Qwen3.5-122B on our L40S, DeepSeek V4 Flash, GPT-5.6 Luna, NRP's DeepSeek.
  agent:['pool:local','deepseek:v4-flash','openai:luna','nrp:deepseek-v4-flash'],
  // The team's reviewer: a model family other than the builder's where possible (an independent check).
  review:['pool:local','nrp:minimax','openai:luna','deepseek:v4-flash'],
  // Short background tasks.
  fast:['gemini:gemini-3.8-flash-lite','openai:luna','deepseek:v4-flash'],
  // A reader is waiting (a page's first view in a language): only models that answer in seconds.
  instant:['gemini:gemini-3.8-flash-lite','openai:luna'],
  // Page translation (background); never the builders' first choices, so translation does not slow the teams.
  translate:['gemini:gemini-3.8-flash-lite','openai:luna','pool:local','nrp:gemma'],
  // Reading facts out of web pages at scale (recipes' llm_extract steps): only our own GPUs, never a paid model.
  extract:['pool:local','pool:v100'],
  // An agent testing extraction on a few pages before saving the recipe: our own models, else free models.
  'extract-test':['pool:local','pool:v100','nrp:deepseek-v4-flash','gemini:gemini-3.8-flash-lite'],
  vision:['nrp:gemma','gemini:gemini-3.8-flash','openai:luna','openrouter:nemotron-3.5-super-vl'],
 },
 // premium -> (over budget or failing) -> the free part of this chain.
 premiumFallback:'agent',
 // The site's question/page-profile vectors were made with this exact model and size: never change.
 siteEmbed:{model:'openai:text-embedding-3-small',dims:512},
 // Default entity-index embedding model: the first whose provider is configured.
 // NRP's qwen3-embedding is now Qwen3-VL-Embedding-8B, which refuses shortened (matryoshka) vectors, and the entity
 // index was built with OpenAI vectors: one vector space, so OpenAI stays first.
 defaultEmbed:['openai:text-embedding-3-small','gemini:gemini-embedding-2'],
};

function merge(base:any,patch:any):any{
 if(Array.isArray(patch)||patch===null||typeof patch!=='object')return patch;
 const out:any={...(base&&typeof base==='object'&&!Array.isArray(base)?base:{})};
 for(const [k,v] of Object.entries(patch))out[k]=merge(out[k],v);
 return out;
}
export function loadCatalog(overrides?:string):Catalog{
 if(!overrides)return BASE_CATALOG;
 let patch:unknown;try{patch=JSON.parse(overrides);}catch{throw Error('LLM_CATALOG_OVERRIDES is not valid JSON.');}
 const result=merge(BASE_CATALOG,patch) as Catalog;
 for(const [id,entry] of Object.entries(result.models))entry.id=id;
 return result;
}
