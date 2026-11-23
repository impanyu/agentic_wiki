// Provider-agnostic router. Pure: every dependency (env, fetch, clock, usage store) is injected,
// so tests run it with fakes. app/llm/index.ts wires it to the app.
import {loadCatalog,type Catalog,type ModelEntry} from './catalog';
import {costUsd,chatCostUsd} from './prices';
import {RateTracker,monthKey,nextMonth,retryAfterMs,type Block} from './limits';
import {toChat,fromChat,forOpenAI,requirements,inputItems,syntheticId} from './translate';
import {schemaErrors,extractJson} from './schema';
import {webSearch,searchConfigured} from './search';
import type {LLMRequest,LLMResponse,OutputItem,StreamHandlers,TaskClass,InputItem,CallInfo} from './types';

export type UsageRow={createdAt:string;month:string;class:TaskClass;provider:string;model:string;status:string;latencyMs:number;inputTokens:number;cachedTokens:number;outputTokens:number;costUsd:number;webSearches:number;fallbackReason:string|null};
export type UsageStore={record(row:UsageRow):Promise<void>;monthSpend(month:string):Promise<number>;daySpend?(day:string,provider:string):Promise<number>};
export type Deps={
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
 const configured=(entry:ModelEntry)=>!!key(entry);

 // ---------- budget ----------
 let spendCache:{month:string;value:number;loadedAt:number}|null=null;
 const budget=()=>{const raw=deps.env('LLM_MONTHLY_BUDGET_USD'),v=raw?Number(raw):NaN;return Number.isFinite(v)&&v>=0?v:300;};
 const dayCache={day:'',at:0,value:0};
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
   const avoid=familyOf(request.avoidModel),base=c.chains.agent;
   ids.push(...base.filter(id=>c.models[id]&&c.models[id].family!==avoid),...base);
  }else if(cls==='agent'||cls==='fast'||cls==='vision'||cls==='translate'||cls==='instant')ids.push(...c.chains[cls]);
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
  const model=openaiModel(request.class,request),body=forOpenAI({...(deps.openaiDefaults?.({...request,model})||{}),...request,model});
  const response=await post(catalog().providers.openai.base+'/responses',{Authorization:'Bearer '+key(entry)},body,entry.timeoutMs||65000,signal);
  const data=await response.json() as LLMResponse;if(!data.model)data.model=model;return data;
 }
 async function chatOnce(entry:ModelEntry,body:LLMRequest,webSearchEnabled:boolean,signal?:AbortSignal){
  const provider=catalog().providers[entry.provider];
  const response=await post(provider.base+'/chat/completions',{Authorization:'Bearer '+key(entry),...(provider.headers||{})},toChat(body,entry,{webSearch:webSearchEnabled}),entry.timeoutMs||120000,signal);
  let data:any;try{data=await response.json();}catch{throw new ProviderError('server','invalid JSON body');}
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

 // ---------- routing ----------
 async function route<T>(request:LLMRequest,signal:AbortSignal|undefined,run:(entry:ModelEntry,fallbacks:CallInfo['fallbacks'])=>Promise<{result:T;info:Omit<CallInfo,'fallbacks'|'class'>;usage?:any}>,canFallBack:()=>boolean=()=>true):Promise<T>{
  const cls=request.class,entries=chain(request),fallbacks:CallInfo['fallbacks']=[],tokens=estimate(request);
  if(!entries.length){
   const any=Object.values(catalog().models).some(configured);
   throw Error(any?'AI_UNAVAILABLE':'AI_SETUP');
  }
  const failed=new Set<string>();let lastKind='';const started=now();
  while(true){
   let waitUntil=Infinity;
   for(const entry of entries){
    if(failed.has(entry.id))continue;
    // A paid chat provider has a daily cap (<PROVIDER>_DAILY_USD, default $10): once today's spend reaches it, the
    // chain moves on to the free models until midnight UTC.
    if(entry.provider==='deepseek'){
     const cap=Number(deps.env('DEEPSEEK_DAILY_USD')??10),day=new Date(now()).toISOString().slice(0,10);
     const spent=dayCache.day===day&&now()-dayCache.at<60_000?dayCache.value:await (deps.usage.daySpend?.(day,'deepseek')??Promise.resolve(0)).then(v=>{dayCache.day=day;dayCache.at=now();dayCache.value=v;return v;}).catch(()=>dayCache.value);
     if(!(spent<cap)){if(!fallbacks.some(f=>f.model===entry.id))fallbacks.push({model:entry.id,reason:'daily_cap'});failed.add(entry.id);continue;}
    }
    if(entry.provider==='openai'&&cls!=='site-embed'&&cls!=='embed'){
     const s=await spend();
     if(s.overBudget){if(!fallbacks.some(f=>f.model===entry.id))fallbacks.push({model:entry.id,reason:'over_budget'});failed.add(entry.id);lastKind=lastKind||'budget';continue;}
    }
    const block:Block|null=tracker.blocked(entry,tokens);
    if(block){
     if(!fallbacks.some(f=>f.model===entry.id&&f.reason===block.reason))fallbacks.push({model:entry.id,reason:block.reason});
     if(block.reason==='rpd'||block.reason.startsWith('cooldown'))failed.add(entry.id);
     waitUntil=Math.min(waitUntil,block.retryAt);continue;
    }
    for(let attempt=0;attempt<2;attempt++){
     const release=tracker.acquire(entry,tokens),t0=now();
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
      await record({class:cls,provider:entry.provider,model:entry.provider==='openai'?openaiModel(cls,request):entry.model,status:'error:'+e.kind+(e.status?':'+e.status:''),latencyMs:now()-t0,inputTokens:0,cachedTokens:0,outputTokens:0,costUsd:0,webSearches:0,fallbackReason:null});
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
   // Everything usable is only briefly rate-limited: wait for the earliest slot.
   const waiting=entries.some(e=>!failed.has(e.id));
   if(waiting&&Number.isFinite(waitUntil)&&waitUntil-now()<=MAX_WAIT_MS&&now()-started<MAX_WAIT_MS){await sleep(Math.max(50,waitUntil-now()));signal?.throwIfAborted();continue;}
   if(lastKind==='budget')log('LLM monthly budget exhausted and no free model could serve the request',{class:cls});
   throw Error(waiting||lastKind==='rate'||lastKind==='daily'||lastKind==='budget'?'AI_LIMIT':'AI_UNAVAILABLE');
  }
 }

 async function respond(request:LLMRequest,signal?:AbortSignal):Promise<LLMResponse>{
  return route<LLMResponse>(request,signal,async entry=>{
   const t0=now();
   if(entry.provider==='openai'){
    const result=await callOpenAI(entry,request,signal),searches=(result.output||[]).filter(o=>o.type==='web_search_call').length,model=String(result.model||openaiModel(request.class,request));
    return {result,usage:result.usage,info:{provider:'openai',model,catalogId:entry.id,latencyMs:now()-t0,costUsd:costUsd(model,result.usage,searches),webSearches:searches}};
   }
   const {webSearches,...result}=await callChat(entry,request,signal);
   const cost=chatCostUsd(entry.model,result.usage);if(cost&&dayCache.day===new Date(now()).toISOString().slice(0,10))dayCache.value+=cost;
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
    return {result,usage:result.usage,info:{provider:entry.provider,model:entry.model,catalogId:entry.id,latencyMs:now()-t0,costUsd:chatCostUsd(entry.model,result.usage),webSearches}};
   }
   if(!deps.readEvents)throw Error('LLM streaming is not configured.');
   const model=openaiModel(request.class,request),body=forOpenAI({...(deps.openaiDefaults?.({...request,model})||{}),...request,model,stream:true});
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
 return {respond,respondStream,embedder,siteEmbed,spend,chain,catalog,tracker};
}
// True when a completed web search is in the output: OpenAI's built-in search, or our
// web_search function tool, which the layer executes and reports as the same item type.
export function searched(response:{output?:{type:string;status?:string}[]}|undefined){
 return !!response?.output?.some(o=>o.type==='web_search_call'&&o.status==='completed');
}
