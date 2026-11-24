// Provider-agnostic router. Pure: every dependency (env, fetch, clock, usage store) is injected,
// so tests run it with fakes. app/llm/index.ts wires it to the app.
import {loadCatalog,type Catalog,type ModelEntry} from './catalog';
import {costUsd,chatCostUsd} from './prices';
// Only a paid provider's calls cost money: the same model served free (NRP, our own GPUs) costs nothing.
const PAID=new Set(['deepseek']);
// Providers billed per call, each with a daily cap (<PROVIDER>_DAILY_USD) and together under the monthly budget.
export const DAILY_CAPPED:Record<string,number>={deepseek:8,openai:8};
const paidCost=(entry:{provider:string;model:string},usage:Parameters<typeof chatCostUsd>[1])=>PAID.has(entry.provider)?chatCostUsd(entry.model,usage):0;
import {RateTracker,monthKey,nextMonth,retryAfterMs,type Block} from './limits';
import {toChat,fromChat,forOpenAI,requirements,inputItems,syntheticId} from './translate';
import {schemaErrors,extractJson} from './schema';
import {webSearch,searchConfigured} from './search';
import type {LLMRequest,LLMResponse,OutputItem,StreamHandlers,TaskClass,InputItem,CallInfo} from './types';

export type UsageRow={createdAt:string;month:string;class:TaskClass;provider:string;model:string;status:string;latencyMs:number;inputTokens:number;cachedTokens:number;outputTokens:number;costUsd:number;webSearches:number;fallbackReason:string|null};
export type UsageStore={record(row:UsageRow):Promise<void>;monthSpend(month:string):Promise<number>;daySpend?(day:string,provider:string):Promise<number>};
export type Deps={
 pool?:{available(model:string):boolean;slots?(model:string):number|undefined;run(model:string,body:Record<string,unknown>,timeoutMs:number,signal?:AbortSignal,queueWaitMs?:number):Promise<any>};
 env:(name:string)=>string|undefined;fetch:typeof fetch;usage:UsageStore;now?:()=>number;
 openaiDefaults?:(body:Record<string,any>)=>Record<string,unknown>;
 readEvents?:(stream:ReadableStream<Uint8Array>)=>AsyncIterable<Record<string,unknown>>;
 sleep?:(ms:number)=>Promise<void>;log?:(message:string,detail?:unknown)=>void;
};
export class ProviderError extends Error{
 constructor(public kind:'rate'|'daily'|'server'|'client'|'auth'|'timeout'|'invalid',message:string,public retryAfter:number|null=null,public status=0){super(message);}
}
export type Embedder=((texts:string[],signal?:AbortSignal)=>Promise<number[][]>)&{model:string;dims:number};
const MAX_WAIT_MS=60000,SEARCH_ROUNDS=5;

export function createLLM(deps:Deps){
 const now=deps.now||Date.now,sleep=deps.sleep||((ms:number)=>new Promise(r=>setTimeout(r,ms))),log=deps.log||((m:string,d?:unknown)=>console.warn(m,d??''));
 const tracker=new RateTracker(now);
 let cached:{raw:string|undefined;catalog:Catalog}|null=null;
 const catalog=()=>{const raw=deps.env('LLM_CATALOG_OVERRIDES');if(!cached||cached.raw!==raw)cached={raw,catalog:loadCatalog(raw)};return cached.catalog;};
 const key=(entry:ModelEntry)=>deps.env(catalog().providers[entry.provider].keyEnv)||'';
 const configured=(entry:ModelEntry)=>entry.provider==='pool'?!!deps.pool?.available(entry.model):!!key(entry);

 // ---------- budget ----------
 let spendCache:{month:string;value:number;loadedAt:number}|null=null;
 const budget=()=>{const raw=deps.env('LLM_MONTHLY_BUDGET_USD'),v=raw?Number(raw):NaN;return Number.isFinite(v)&&v>=0?v:300;};
 const dayCache:Record<string,{day:string;at:number;value:number}>={};
 const addDay=(provider:string,cost:number)=>{const dc=dayCache[provider];if(cost&&dc&&dc.day===new Date(now()).toISOString().slice(0,10))dc.value+=cost;};
 async function monthSpend(){
  const month=monthKey(now());
  if(!spendCache||spendCache.month!==month||now()-spendCache.loadedAt>60000){
   const value=await deps.usage.monthSpend(month).catch(error=>{log('LLM usage read failed',String(error));return spendCache?.month===month?spendCache.value:0;});
   spendCache={month,value,loadedAt:now()};
  }
  return spendCache.value;
 }
 async function spend(){const spent=await monthSpend(),limit=budget();return {month:monthKey(now()),spentUsd:Math.round(spent*1e6)/1e6,budgetUsd:limit,remainingUsd:Math.max(0,Math.round((limit-spent)*1e6)/1e6),overBudget:spent>=limit,resetsAt:new Date(nextMonth(now())).toISOString()};}
 async function record(row:Omit<UsageRow,'createdAt'|'month'>){
  const month=monthKey(now());
  if(row.costUsd&&spendCache?.month===month)spendCache.value+=row.costUsd;
  await deps.usage.record({...row,createdAt:new Date(now()).toISOString(),month}).catch(error=>log('LLM usage write failed',String(error)));
 }

 // ---------- chain resolution ----------
 const openaiModel=(cls:TaskClass,body:LLMRequest)=>body.model||(cls==='premium'?deps.env('OPENAI_AGENT_MODEL')||'gpt-5.6-terra':deps.env('OPENAI_MODEL')||'gpt-5.4-mini');
 function familyOf(model:string|undefined){
  if(!model)return '';const c=catalog();
  const entry=c.models[model]||Object.values(c.models).find(e=>e.model===model);
  if(entry)return entry.family;
  return /^(gpt|o\d|text-embedding)/.test(model)?'openai':model.split(/[-:/]/)[0];
 }
 function chain(request:LLMRequest):ModelEntry[]{
  const c=catalog(),cls=request.class,need=requirements(request),ids:string[]=[];
  if(cls==='premium')ids.push(...c.chains.premium,...c.chains[c.premiumFallback]);
  else if(cls==='review'){
   const avoid=familyOf(request.avoidModel),base=c.chains.review;
   ids.push(...base.filter(id=>c.models[id]&&c.models[id].family!==avoid),...base);
  }else if(cls==='agent'||cls==='fast'||cls==='vision'||cls==='translate'||cls==='instant'||cls==='extract'||cls==='extract-test')ids.push(...c.chains[cls]);
  else throw Error('LLM_CLASS_INVALID: '+cls);
  // Images in a non-vision class: try the vision chain's free models too.
  if(need.vision&&cls!=='vision')ids.push(...c.chains.vision);
  const searchable=searchConfigured(deps.env);
  return [...new Set(ids)].map(id=>c.models[id]).filter((e):e is ModelEntry=>!!e&&!e.embed&&configured(e)).filter(e=>{
   if(e.provider==='openai')return true;
   if(need.files||need.openaiOnlyTools)return false;
   if(need.webSearch&&!searchable)return false;
   if(need.vision&&!e.caps.vision)return false;
   if(need.tools&&!e.caps.tools)return false;
   return true;
  });
 }
 const estimate=(body:LLMRequest)=>Math.ceil(((body.instructions||'').length+JSON.stringify(body.input||'').length)/4);

 // ---------- provider calls ----------
 async function post(url:string,headers:Record<string,string>,body:unknown,timeoutMs:number,signal?:AbortSignal){
  const timeout=AbortSignal.timeout(timeoutMs),combined=signal?AbortSignal.any([signal,timeout]):timeout;
  let response:Response;
  try{response=await deps.fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body),signal:combined});}
  catch(error){if(signal?.aborted)throw error;throw new ProviderError(timeout.aborted?'timeout':'server',timeout.aborted?'timeout':'network: '+(error instanceof Error?error.message:String(error)));}
  if(response.ok)return response;
  const text=(await response.text().catch(()=>'')).slice(0,600),retry=retryAfterMs(response.headers?.get?.('retry-after'),now());
  if(response.status===429)throw new ProviderError(/per.?day|daily|RequestsPerDay|quota.*day/i.test(text)?'daily':'rate','429 '+text,retry,429);
  if(response.status===401||response.status===403)throw new ProviderError('auth',response.status+' '+text,null,response.status);
  if(response.status>=500||response.status===408)throw new ProviderError('server',response.status+' '+text,retry,response.status);
  throw new ProviderError('client',response.status+' '+text,null,response.status);
 }
 async function callOpenAI(entry:ModelEntry,request:LLMRequest,signal?:AbortSignal):Promise<LLMResponse>{
  const model=entry.model!=='(caller)'?entry.model:openaiModel(request.class,request),body=forOpenAI({...(deps.openaiDefaults?.({...request,model})||{}),...request,model});
  const response=await post(catalog().providers.openai.base+'/responses',{Authorization:'Bearer '+key(entry)},body,entry.timeoutMs||65000,signal);
  const data=await response.json() as LLMResponse;if(!data.model)data.model=model;return data;
 }
 async function chatOnce(entry:ModelEntry,body:LLMRequest,webSearchEnabled:boolean,signal?:AbortSignal){
  const provider=catalog().providers[entry.provider];
  let data:any;
  if(entry.provider==='pool'){
   try{data=await deps.pool!.run(entry.model,{...toChat(body,entry,{webSearch:webSearchEnabled}) as Record<string,unknown>,...(entry.chatExtra||{})},Math.max(entry.timeoutMs||300000,Number((body as {timeoutMs?:number}).timeoutMs)||0),signal,undefined);}
   // A busy pool is not an error of the model: no cooldown for everyone else (route waits in the queue as a last resort).
   catch(e){const m=(e as Error).message;throw new ProviderError(/timeout/.test(m)?'timeout':'server',m);}
  }else{
  const response=await post(provider.base+'/chat/completions',{Authorization:'Bearer '+key(entry),...(provider.headers||{})},toChat(body,entry,{webSearch:webSearchEnabled}),entry.timeoutMs||120000,signal);
  try{data=await response.json();}catch{throw new ProviderError('server','invalid JSON body');}
  }
  if(data?.error)throw new ProviderError('server','provider error: '+JSON.stringify(data.error).slice(0,300));
  if(!Array.isArray(data?.choices)||!data.choices.length)throw new ProviderError('server','no choices');
  return fromChat(data,{json:!!body.text?.format&&body.text.format.type!=='text'});
 }
 // One Responses-shaped turn on a Chat provider: substitutes web_search, validates structured output.
 async function callChat(entry:ModelEntry,request:LLMRequest,signal?:AbortSignal):Promise<LLMResponse&{webSearches:number}>{
  const need=requirements(request),format=request.text?.format;
  const searchTool=need.webSearch&&!(request.tools||[]).some(t=>t.type==='function'&&(t as {name?:string}).name==='web_search');
  let current:LLMRequest={...request,input:inputItems(request.input)};
  const searches:OutputItem[]=[],usage={input_tokens:0,output_tokens:0,total_tokens:0,input_tokens_details:{cached_tokens:0}};
  let repaired=false;
  for(let round=0;round<SEARCH_ROUNDS+3;round++){
   if(round>=SEARCH_ROUNDS&&searchTool)current={...current,tools:(current.tools||[]).filter(t=>t.type!=='web_search'),tool_choice:current.tool_choice==='required'?'auto':current.tool_choice};
   const result=await chatOnce(entry,current,searchTool&&round<SEARCH_ROUNDS,signal);
   usage.input_tokens+=result.usage?.input_tokens||0;usage.output_tokens+=result.usage?.output_tokens||0;usage.total_tokens+=result.usage?.total_tokens||0;usage.input_tokens_details.cached_tokens+=result.usage?.input_tokens_details?.cached_tokens||0;
   const output=result.output||[],calls=output.filter(o=>o.type==='function_call');
   const searchCalls=searchTool?calls.filter(c=>c.name==='web_search'):[];
   if(searchCalls.length){
    const items:OutputItem[]=[];
    for(const c of searchCalls){
     let args:any={};try{args=JSON.parse(c.arguments||'{}');}catch{}
     const query=String(args.query||'').slice(0,400);
     try{
      if(!query)throw Error('Empty query.');
      const found=await webSearch(query,Number(args.count)||5,deps.env,deps.fetch,signal);
      items.push({type:'web_search_call',id:syntheticId('ws'),status:'completed',action:{type:'search',query,sources:found.results.map(r=>({type:'url',url:r.url,title:r.title}))},llm:{call_id:c.call_id!,results:JSON.stringify({provider:found.provider,results:found.results})}});
     }catch(error){
      if(signal?.aborted)throw error;
      items.push({type:'web_search_call',id:syntheticId('ws'),status:'failed',action:{type:'search',query,sources:[]},llm:{call_id:c.call_id!,results:JSON.stringify({error:error instanceof Error?error.message:'Search failed'})}});
     }
    }
    searches.push(...items);
    const rest=output.filter(o=>!(o.type==='function_call'&&o.name==='web_search'));
    // Other tool calls go back to the caller's loop; the search results ride along on the items.
    if(rest.some(o=>o.type==='function_call'))return {...result,output:[...searches,...rest],usage,webSearches:searches.length};
    current={...current,input:[...(current.input as InputItem[]),...rest as InputItem[],...items as InputItem[]],tool_choice:current.tool_choice==='required'?'auto':current.tool_choice};
    continue;
   }
   if(!calls.length&&format&&format.type!=='text'){
    const message=output.find(o=>o.type==='message'),text=message?.content?.map(c=>c.text||'').join('')||'';
    let errors:string[]=[];
    try{const value=JSON.parse(extractJson(text));if(format.type==='json_schema')errors=schemaErrors(format.schema,value);if(!errors.length&&message)message.content=[{type:'output_text',text:JSON.stringify(value),annotations:[]}];}
    catch{errors=['the reply is not valid JSON'];}
    if(errors.length){
     if(repaired)throw new ProviderError('invalid','structured output invalid after repair: '+errors.slice(0,5).join('; '));
     repaired=true;
     current={...current,input:[...(current.input as InputItem[]),{role:'assistant',content:text||'(empty)'},{role:'user',content:'Your previous reply did not satisfy the required JSON format: '+errors.slice(0,8).join('; ')+'. Return only the corrected JSON value.'}]};
     continue;
    }
   }
   return {...result,output:[...searches,...output],usage,webSearches:searches.length};
  }
  throw new ProviderError('invalid','tool rounds exhausted');
 }

 // ---------- routing: a queue per task class ----------
 // Like an operating system's scheduler: every request of a class has its chain of models (2–4 options, best first).
 // It starts on the first model of its chain that has a free slot right now; when all of them are full it waits in
 // its class's queue (first come, first served; interactive classes ahead of background work) and starts as soon as a
 // slot on any of its models frees up. Models that cannot serve it at all (no key, daily cap or monthly budget reached,
 // auth failure, failed on this request) are skipped. A request that waits past its class's limit fails.
 const PRIORITY:Partial<Record<string,number>>={instant:9,review:6,premium:6,vision:5,agent:4,fast:3,extract:2,'extract-test':2,translate:1};
 type Waiter={prio:number;at:number;pick:()=>{entry:ModelEntry;release:(t?:number)=>void}|null;wake:(p:{entry:ModelEntry;release:(t?:number)=>void})=>void};
 const waiters:Waiter[]=[];let pumpTimer:ReturnType<typeof setTimeout>|null=null;
 function pump(){
  waiters.sort((a,b)=>b.prio-a.prio||a.at-b.at);
  for(let k=0;k<waiters.length;){const w=waiters[k],got=w.pick();if(got){waiters.splice(k,1);w.wake(got);}else k++;}
  // Slots also free up elsewhere (our GPUs serve the other process too; rate windows slide): look again shortly.
  if(waiters.length&&!pumpTimer){pumpTimer=setTimeout(()=>{pumpTimer=null;pump();},500);(pumpTimer as {unref?:()=>void}).unref?.();}
 }
 // A model's slots: its configured concurrency; for our GPU pool, the slots its live workers report.
 const slotsOf=(entry:ModelEntry)=>{const c=entry.limits.concurrency;const live=entry.provider==='pool'?deps.pool?.slots?.(entry.model):undefined;return typeof live==='number'?Math.min(c??live,live):c;};
 const limited=(entry:ModelEntry):ModelEntry=>{const c=slotsOf(entry);return c===entry.limits.concurrency?entry:{...entry,limits:{...entry.limits,concurrency:c}};};
 // Whether this request may use the entry at all now (not whether it has a free slot).
 async function usable(entry:ModelEntry,cls:string,fallbacks:CallInfo['fallbacks']):Promise<'ok'|'budget'|'no'>{
  if(entry.provider in DAILY_CAPPED&&cls!=='site-embed'&&cls!=='embed'){
   // Paid providers have a daily cap (<PROVIDER>_DAILY_USD; defaults: DeepSeek $8, OpenAI $8) and share the monthly
   // budget (LLM_MONTHLY_BUDGET_USD): once reached, the chain moves on to the free models until the next day/month.
   const cap=Number(deps.env(entry.provider.toUpperCase()+'_DAILY_USD')??DAILY_CAPPED[entry.provider]),day=new Date(now()).toISOString().slice(0,10);
   const dc=dayCache[entry.provider]??=({day:'',at:0,value:0});
   const spent=dc.day===day&&now()-dc.at<60_000?dc.value:await (deps.usage.daySpend?.(day,entry.provider)??Promise.resolve(0)).then(v=>{dc.day=day;dc.at=now();dc.value=v;return v;}).catch(()=>dc.value);
   if(!(spent<cap)){if(!fallbacks.some(f=>f.model===entry.id))fallbacks.push({model:entry.id,reason:'daily_cap'});return 'no';}
   const s=await spend();
   if(s.overBudget){if(!fallbacks.some(f=>f.model===entry.id))fallbacks.push({model:entry.id,reason:'over_budget'});return 'budget';}
  }
  const b=tracker.blocked(limited(entry),0);
  // A daily quota or an auth failure lasts: skip. Concurrency, rate windows and short cooldowns pass: wait.
  if(b&&(b.reason==='rpd'||/daily|auth/.test(b.reason))){if(!fallbacks.some(f=>f.model===entry.id))fallbacks.push({model:entry.id,reason:b.reason});return 'no';}
  return 'ok';
 }
 const queueLimitMs=(cls:string)=>cls==='instant'?20_000:Number(deps.env('LLM_QUEUE_MAX_S')||1800)*1000;
 async function route<T>(request:LLMRequest,signal:AbortSignal|undefined,run:(entry:ModelEntry,fallbacks:CallInfo['fallbacks'])=>Promise<{result:T;info:Omit<CallInfo,'fallbacks'|'class'>;usage?:any}>,canFallBack:()=>boolean=()=>true):Promise<T>{
  const cls=request.class,entries=chain(request),fallbacks:CallInfo['fallbacks']=[],tokens=estimate(request);
  if(!entries.length){
   const any=Object.values(catalog().models).some(configured);
   throw Error(any?'AI_UNAVAILABLE':'AI_SETUP');
  }
  const failed=new Set<string>();let lastKind='';const started=now(),prio=PRIORITY[cls]??3;
  while(true){
   const open:ModelEntry[]=[];
   for(const entry of entries){if(failed.has(entry.id))continue;const u=await usable(entry,cls,fallbacks);if(u==='ok')open.push(entry);else{failed.add(entry.id);if(u==='budget')lastKind=lastKind||'budget';}}
   if(!open.length){
    if(lastKind==='budget')log('LLM monthly budget exhausted and no free model could serve the request',{class:cls});
    throw Error(lastKind==='rate'||lastKind==='daily'||lastKind==='budget'?'AI_LIMIT':'AI_UNAVAILABLE');
   }
   // The first of its models with a free slot; the slot is taken at once so no one else gets it.
   const take=(e:ModelEntry)=>{const r=tracker.acquire(e,tokens);let done=false;return (t?:number)=>{if(done)return;done=true;r(t);pump();};};
   const pick=()=>{for(const e of open){if(failed.has(e.id))continue;if(!tracker.blocked(limited(e),tokens))return {entry:e,release:take(e)};}return null;};
   // First come, first served: a newcomer does not overtake requests already waiting at its priority or above.
   let got=waiters.some(w=>w.prio>=prio)?null:pick();
   if(!got){
    const left=queueLimitMs(cls)-(now()-started);
    if(left<=0){for(const e of open){const b=tracker.blocked(limited(e),tokens);if(b&&!fallbacks.some(f=>f.model===e.id&&f.reason===b.reason))fallbacks.push({model:e.id,reason:b.reason});}throw Error('AI_LIMIT');}
    got=await new Promise<{entry:ModelEntry;release:(t?:number)=>void}|null>((resolve,reject)=>{
     const w:Waiter={prio,at:started,pick,wake:p=>{clearTimeout(timer);signal?.removeEventListener('abort',onAbort);resolve(p);}};
     const drop=()=>{const k=waiters.indexOf(w);if(k>=0)waiters.splice(k,1);};
     const timer=setTimeout(()=>{drop();signal?.removeEventListener('abort',onAbort);resolve(null);},Math.min(left,60_000));
     const onAbort=()=>{clearTimeout(timer);drop();reject(signal?.reason??Error('aborted'));};
     signal?.addEventListener('abort',onAbort,{once:true});
     waiters.push(w);pump();
    });
    if(!got)continue;// re-check what is usable (a day or budget may have rolled over), then wait again
   }
   const entry=got.entry;let release=got.release,t0=now();
    for(let attempt=0;attempt<2;attempt++){
     if(attempt>0){release=take(entry);t0=now();}
     try{
      const {result,info,usage}=await run(entry,fallbacks);
      release(usage?.total_tokens);
      const call:CallInfo={...info,class:cls,fallbacks:[...fallbacks]};
      await record({class:cls,provider:info.provider,model:info.model,status:'ok',latencyMs:info.latencyMs,inputTokens:usage?.input_tokens||0,cachedTokens:usage?.input_tokens_details?.cached_tokens||0,outputTokens:usage?.output_tokens||0,costUsd:info.costUsd,webSearches:info.webSearches,fallbackReason:fallbacks.length?fallbacks.map(f=>f.model+':'+f.reason).join(', ').slice(0,500):null});
      if(result&&typeof result==='object'&&!Array.isArray(result))(result as any).llm=call;
      return result;
     }catch(error){
      release();
      if(signal?.aborted)throw error;
      const e=error instanceof ProviderError?error:new ProviderError('server',error instanceof Error?error.message:String(error));
      lastKind=e.kind;
      log('LLM call failed',{model:entry.id,kind:e.kind,message:e.message.slice(0,300)});
      await record({class:cls,provider:entry.provider,model:entry.provider==='openai'&&entry.model==='(caller)'?openaiModel(cls,request):entry.model,status:'error:'+e.kind+(e.status?':'+e.status:''),latencyMs:now()-t0,inputTokens:0,cachedTokens:0,outputTokens:0,costUsd:0,webSearches:0,fallbackReason:null});
      if(!canFallBack())throw Error(e.kind==='rate'?'AI_LIMIT':'AI_UNAVAILABLE');
      const provider=catalog().providers[entry.provider];
      if(e.kind==='daily')tracker.exhaustDay(entry);
      else if(e.kind==='rate'){const ms=e.retryAfter??provider.cooldownMs;if(ms>0)tracker.cooldown(entry,ms,'429');}
      else if(e.kind==='auth')tracker.cooldown(entry,600000,'auth');
      if(e.kind==='server'&&attempt===0)continue;
      fallbacks.push({model:entry.id,reason:e.kind+(e.status?':'+e.status:'')});failed.add(entry.id);break;
     }
    }
  }
 }

 async function respond(request:LLMRequest,signal?:AbortSignal):Promise<LLMResponse>{
  return route<LLMResponse>(request,signal,async entry=>{
   const t0=now();
   if(entry.provider==='openai'){
    const result=await callOpenAI(entry,request,signal),searches=(result.output||[]).filter(o=>o.type==='web_search_call').length,model=String(result.model||openaiModel(request.class,request));
    const cost=costUsd(model,result.usage,searches);addDay('openai',cost);
    return {result,usage:result.usage,info:{provider:'openai',model,catalogId:entry.id,latencyMs:now()-t0,costUsd:cost,webSearches:searches}};
   }
   const {webSearches,...result}=await callChat(entry,request,signal);
   const cost=paidCost(entry,result.usage);addDay(entry.provider,cost);
   return {result,usage:result.usage,info:{provider:entry.provider,model:entry.model,catalogId:entry.id,latencyMs:now()-t0,costUsd:cost,webSearches}};
  });
 }
 // Streams text and tool-argument deltas. OpenAI streams natively; Chat providers deliver the
 // whole turn at once. Fallback to another model only happens before anything was emitted.
 async function respondStream(request:LLMRequest,handlers:StreamHandlers,signal?:AbortSignal):Promise<LLMResponse>{
  let emitted=false;
  return route<LLMResponse>(request,signal,async entry=>{
   const t0=now();
   if(entry.provider!=='openai'){
    const {webSearches,...result}=await callChat(entry,request,signal);
    for(const item of result.output||[]){
     if(item.type==='function_call'&&handlers.onToolArguments){emitted=true;handlers.onToolArguments(item.name||'',item.arguments||'');}
     if(item.type==='message')for(const c of item.content||[])if(c.text&&handlers.onTextDelta){emitted=true;handlers.onTextDelta(c.text);}
    }
    return {result,usage:result.usage,info:{provider:entry.provider,model:entry.model,catalogId:entry.id,latencyMs:now()-t0,costUsd:paidCost(entry,result.usage),webSearches}};
   }
   if(!deps.readEvents)throw Error('LLM streaming is not configured.');
   const model=entry.model!=='(caller)'?entry.model:openaiModel(request.class,request),body=forOpenAI({...(deps.openaiDefaults?.({...request,model})||{}),...request,model,stream:true});
   const response=await post(catalog().providers.openai.base+'/responses',{Authorization:'Bearer '+key(entry)},body,entry.timeoutMs||120000,signal);
   if(!response.body)throw new ProviderError('server','no stream body');
   let completed:LLMResponse|undefined;const toolArguments=new Map<string,{name:string;text:string}>();
   for await(const event of deps.readEvents(response.body)){
    if(event.type==='response.output_item.added'){
     const item=event.item as {id?:string;type?:string;name?:string;arguments?:string}|undefined;
     if(item?.type==='function_call'&&item.id&&item.name)toolArguments.set(item.id,{name:item.name,text:item.arguments||''});
    }else if(event.type==='response.function_call_arguments.delta'&&typeof event.delta==='string'){
     const item=toolArguments.get(String(event.item_id));if(item){item.text+=event.delta;emitted=true;handlers.onToolArguments?.(item.name,item.text);}
    }
    if(event.type==='response.output_text.delta'&&typeof event.delta==='string'){emitted=true;handlers.onTextDelta?.(event.delta);}
    else if(['response.completed','response.failed','response.incomplete'].includes(String(event.type)))completed=event.response as LLMResponse;
    else if(event.type==='error')throw new ProviderError(emitted?'invalid':'server','stream error '+JSON.stringify(event).slice(0,300));
   }
   if(!completed)throw new ProviderError('server','stream ended without a response');
   const searches=(completed.output||[]).filter(o=>o.type==='web_search_call').length;
   return {result:completed,usage:completed.usage,info:{provider:'openai',model,catalogId:entry.id,latencyMs:now()-t0,costUsd:costUsd(model,completed.usage,searches),webSearches:searches}};
  },()=>!emitted);
 }

 // ---------- embeddings ----------
 async function embedWith(entry:ModelEntry,dims:number,cls:'embed'|'site-embed',texts:string[],signal?:AbortSignal):Promise<number[][]>{
  const spec=entry.embed!,provider=catalog().providers[entry.provider],out:number[][]=[];
  if(!configured(entry))throw Error('EMBED_MODEL_UNAVAILABLE: '+entry.id+' is not configured');
  for(let i=0;i<texts.length;i+=spec.maxBatch){
   const batch=texts.slice(i,i+spec.maxBatch),tokens=Math.ceil(batch.join('').length/4);
   let vectors:number[][]|null=null;
   for(let attempt=0;attempt<3&&!vectors;attempt++){
    const block=tracker.blocked(entry,tokens);
    if(block){
     // Never switch embedding model: wait briefly or fail loudly.
     if(block.retryAt-now()>MAX_WAIT_MS||block.reason==='rpd')throw Error('EMBED_MODEL_UNAVAILABLE: '+entry.id+' '+block.reason);
     await sleep(Math.max(50,block.retryAt-now()));attempt--;continue;
    }
    const release=tracker.acquire(entry,tokens),t0=now();
    try{
     const response=await post(provider.base+'/embeddings',{Authorization:'Bearer '+key(entry),...(provider.headers||{})},{model:entry.model,input:batch,...(spec.supportsDimensions&&dims<spec.dims?{dimensions:dims}:{}),encoding_format:'float'},60000,signal);
     const data=await response.json() as {data?:{embedding:number[];index:number}[];usage?:{prompt_tokens?:number;total_tokens?:number}};
     const rows=[...(data.data||[])].sort((a,b)=>a.index-b.index).map(r=>r.embedding);
     if(rows.length!==batch.length)throw new ProviderError('server','embedding count mismatch');
     vectors=rows.map(v=>{
      if(!Array.isArray(v)||v.some(x=>typeof x!=='number'))throw new ProviderError('server','invalid embedding');
      if(v.length===dims)return v;
      if(v.length>dims&&spec.matryoshka){const cut=v.slice(0,dims),norm=Math.sqrt(cut.reduce((n,x)=>n+x*x,0))||1;return cut.map(x=>x/norm);}
      throw Error('EMBED_DIMENSION_MISMATCH: '+entry.id+' returned '+v.length+', index uses '+dims);
     });
     const usedTokens=data.usage?.total_tokens||data.usage?.prompt_tokens||tokens;release(usedTokens);
     await record({class:cls,provider:entry.provider,model:entry.model,status:'ok',latencyMs:now()-t0,inputTokens:usedTokens,cachedTokens:0,outputTokens:0,costUsd:entry.provider==='openai'?costUsd(entry.model,{input_tokens:usedTokens}):0,webSearches:0,fallbackReason:null});
    }catch(error){
     release();
     if(signal?.aborted||!(error instanceof ProviderError))throw error;
     await record({class:cls,provider:entry.provider,model:entry.model,status:'error:'+error.kind+(error.status?':'+error.status:''),latencyMs:now()-t0,inputTokens:0,cachedTokens:0,outputTokens:0,costUsd:0,webSearches:0,fallbackReason:null});
     if(error.kind==='rate'&&(error.retryAfter??provider.cooldownMs)<=30000&&attempt<2){await sleep(error.retryAfter??Math.max(1000,provider.cooldownMs));continue;}
     if(error.kind==='server'&&attempt===0)continue;
     if(error.kind==='daily')tracker.exhaustDay(entry);
     throw Error(error.kind==='rate'||error.kind==='daily'?'AI_LIMIT':'EMBED_MODEL_UNAVAILABLE: '+entry.id+' '+error.message.slice(0,200));
    }
   }
   if(!vectors)throw Error('EMBED_MODEL_UNAVAILABLE: '+entry.id);
   out.push(...vectors);
  }
  return out;
 }
 function embedEntry():ModelEntry{
  const c=catalog(),wanted=deps.env('ENTITY_EMBED_MODEL');
  if(wanted){
   const entry=c.models[wanted]||Object.values(c.models).find(e=>e.embed&&e.model===wanted);
   if(!entry?.embed)throw Error('ENTITY_EMBED_MODEL names no embedding model in the catalog: '+wanted);
   return entry;
  }
  const entry=c.defaultEmbed.map(id=>c.models[id]).find(e=>e?.embed&&configured(e));
  if(!entry)throw Error('AI_SETUP');
  return entry;
 }
 // The entity index's fixed embedding model. Store `.model` with the index and compare it on
 // read: this function never silently changes models when the configured one is down.
 function embedder():Embedder{
  const entry=embedEntry(),dims=Number(deps.env('ENTITY_EMBED_DIM'))||768;
  if(!Number.isInteger(dims)||dims<1||dims>entry.embed!.dims)throw Error('ENTITY_EMBED_DIM '+dims+' is not available from '+entry.id);
  const fn=((texts:string[],signal?:AbortSignal)=>embedWith(entry,dims,'embed',texts,signal)) as Embedder;
  fn.model=entry.id;fn.dims=dims;return fn;
 }
 // The site's question-matching vectors: fixed model and size (stored vectors depend on them).
 async function siteEmbed(texts:string[],signal?:AbortSignal){
  const c=catalog(),entry=c.models[c.siteEmbed.model];
  if(!entry?.embed)throw Error('AI_SETUP');
  if(!configured(entry))throw Error('AI_SETUP');
  return embedWith(entry,c.siteEmbed.dims,'site-embed',texts,signal);
 }
 // The scheduler right now: each configured model's slots and use, and the requests waiting per task class.
 function schedulerState(){
  const rates=tracker.snapshot() as Record<string,{active:number;today:number;cooldownUntil:string|null;cooldownReason:string|null}>;
  const models=Object.values(catalog().models).filter(m=>!m.embed&&configured(m)).map(m=>{const r=rates[m.id];return {id:m.id,provider:m.provider,slots:slotsOf(m)??null,active:r?.active||0,today:r?.today||0,cooldownUntil:r?.cooldownUntil||null,cooldownReason:r?.cooldownReason||null};});
  const byPrio=new Map<number,{n:number;oldest:number}>();for(const w of waiters){const x=byPrio.get(w.prio)??{n:0,oldest:w.at};x.n++;x.oldest=Math.min(x.oldest,w.at);byPrio.set(w.prio,x);}
  const classes=Object.entries(PRIORITY).map(([cls,p])=>({cls,priority:p!,chain:chain({class:cls as TaskClass}).map(e=>e.id),waiting:byPrio.get(p!)?.n||0,oldestWaitS:byPrio.has(p!)?Math.round((now()-byPrio.get(p!)!.oldest)/1000):0}));
  return {at:new Date(now()).toISOString(),models,classes,waiting:waiters.length};
 }
 return {respond,respondStream,embedder,siteEmbed,spend,chain,catalog,tracker,schedulerState};
}
// True when a completed web search is in the output: OpenAI's built-in search, or our
// web_search function tool, which the layer executes and reports as the same item type.
export function searched(response:{output?:{type:string;status?:string}[]}|undefined){
 return !!response?.output?.some(o=>o.type==='web_search_call'&&o.status==='completed');
}
