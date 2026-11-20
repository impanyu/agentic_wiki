// HTTP layer shared by the built-in public data sources: a per-host rate limiter, a small
// in-memory LRU cache of GET responses and retries with backoff on 429/5xx. The network
// transport is injected (transport.ts on the server, a stub in tests), so this file stays pure.
export const USER_AGENT='rankwiki-bot/1.0 (+https://rankwiki.aisoup.net)';
export type TransportResponse={status:number;headers:Record<string,string|string[]|undefined>;text:string};
export type Transport=(url:string,init:{headers:Record<string,string>;signal?:AbortSignal;timeoutMs:number})=>Promise<TransportResponse>;
export type JsonOptions={headers?:Record<string,string>;timeoutMs?:number;cacheMs?:number;noCache?:boolean;retries?:number};
export type Http={json(url:string,options?:JsonOptions):Promise<any>};
export class PublicHttpError extends Error{
 constructor(public status:number,public host:string,detail=''){super('HTTP '+status+' from '+host+(detail?': '+detail:''));this.name='PublicHttpError';}
}
export const sleepFor=(ms:number,signal?:AbortSignal)=>new Promise<void>((resolve,reject)=>{
 if(signal?.aborted){reject(signal.reason);return;}
 const t=setTimeout(()=>{signal?.removeEventListener('abort',stop);resolve();},ms);
 const stop=()=>{clearTimeout(t);reject(signal!.reason);};signal?.addEventListener('abort',stop,{once:true});
});
// Spaces requests to the same host at least `interval(host)` ms apart. Slots are reserved in
// call order, so concurrent callers queue instead of bursting.
export class HostLimiter{
 private next=new Map<string,number>();
 constructor(private interval:(host:string)=>number,private now:()=>number=()=>Date.now(),private sleep:(ms:number,signal?:AbortSignal)=>Promise<void>=sleepFor,private maxWaitMs=60_000){}
 async wait(host:string,signal?:AbortSignal){
  const now=this.now(),at=Math.max(now,this.next.get(host)||0);
  if(at-now>this.maxWaitMs)throw Error(host+' is busy (too many queued requests); try again in a minute.');
  this.next.set(host,at+this.interval(host));
  if(this.next.size>500)for(const [h,t] of this.next)if(t<now)this.next.delete(h);
  if(at>now)await this.sleep(at-now,signal);
 }
}
// Least-recently-used cache with a time-to-live per entry and caps on entries and total size.
export class TtlLru<V>{
 private map=new Map<string,{at:number;ttl:number;size:number;value:V}>();private total=0;
 constructor(private maxEntries=200,private maxBytes=40*1024*1024,private now:()=>number=()=>Date.now()){}
 get(key:string):V|undefined{
  const e=this.map.get(key);if(!e)return undefined;
  if(this.now()-e.at>e.ttl){this.delete(key);return undefined;}
  this.map.delete(key);this.map.set(key,e);return e.value;
 }
 set(key:string,value:V,size:number,ttl:number){
  if(size>this.maxBytes/4)return;
  this.delete(key);this.map.set(key,{at:this.now(),ttl,size,value});this.total+=size;
  while(this.map.size>this.maxEntries||this.total>this.maxBytes){const oldest=this.map.keys().next().value as string;this.delete(oldest);}
 }
 delete(key:string){const e=this.map.get(key);if(e){this.total-=e.size;this.map.delete(key);}}
 get size(){return this.map.size;}
}
// Minimum spacing per host, from the providers' published usage policies.
export const HOST_INTERVALS:Record<string,number>={
 'nominatim.openstreetmap.org':1100,'overpass.private.coffee':1000,'maps.mail.ru':1000,'musicbrainz.org':1100,'overpass-api.de':1000,'api.coingecko.com':2500,
 'query.wikidata.org':250,'steamspy.com':1100,'store.steampowered.com':400,'api.github.com':250,'api.stackexchange.com':150,
 'crates.io':1000,'pypistats.org':500,'openlibrary.org':300,'api.openalex.org':120,
};
const errorDetail=(text:string)=>{
 let detail=text;
 try{const j=JSON.parse(text);const m=j?.error?.message||j?.message||j?.error_message||j?.errors?.[0]?.message||j?.error||j?.status?.error_message;if(m)detail=typeof m==='string'?m:JSON.stringify(m);}catch{
  const line=text.split('\n').find(l=>/Exception|Error|Encountered|Lexical|Parse/i.test(l));if(line)detail=line;
 }
 return detail.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0,400);
};
const retryAfter=(headers:TransportResponse['headers'])=>{const v=Number(String(headers['retry-after']||''));return Number.isFinite(v)&&v>0?Math.min(v*1000,10_000):0;};
export function createFetcher(options:{transport:Transport;intervals?:Record<string,number>;defaultIntervalMs?:number;cacheMs?:number;retries?:number;now?:()=>number;sleep?:(ms:number,signal?:AbortSignal)=>Promise<void>;cache?:TtlLru<unknown>;limiter?:HostLimiter}){
 const now=options.now||(()=>Date.now()),sleep=options.sleep||sleepFor,retries=options.retries??2,intervals={...HOST_INTERVALS,...options.intervals};
 const limiter=options.limiter||new HostLimiter(h=>intervals[h]??options.defaultIntervalMs??100,now,sleep);
 const cache=options.cache||new TtlLru<unknown>(200,40*1024*1024,now);
 const defaultCache=options.cacheMs??600_000;
 async function json(url:string,o:JsonOptions={},signal?:AbortSignal):Promise<any>{
  const host=new URL(url).hostname;
  if(!o.noCache){const hit=cache.get(url);if(hit!==undefined)return hit;}
  let last:unknown;
  const tries=o.retries??retries;
  for(let attempt=0;attempt<=tries;attempt++){
   signal?.throwIfAborted();
   if(attempt)await sleep(Math.max(1000*3**(attempt-1),last instanceof RetryLater?last.after:0),signal);
   await limiter.wait(host,signal);
   let res:TransportResponse;
   try{res=await options.transport(url,{headers:{'User-Agent':USER_AGENT,Accept:'application/json',...o.headers},signal,timeoutMs:o.timeoutMs||30_000});}
   catch(e){if(signal?.aborted)throw e;last=e;continue;}
   if(res.status===429||res.status>=500){last=new RetryLater(res.status,host,errorDetail(res.text),retryAfter(res.headers));continue;}
   if(res.status<200||res.status>=300)throw new PublicHttpError(res.status,host,errorDetail(res.text));
   let data:unknown;try{data=res.text.trim()?JSON.parse(res.text):null;}catch{throw Error('Invalid JSON from '+host+'.');}
   if(!o.noCache)cache.set(url,data,res.text.length,o.cacheMs??defaultCache);
   return data;
  }
  if(last instanceof RetryLater)throw new PublicHttpError(last.status,host,(last.status===429?'rate limited; try again later':'service unavailable')+(last.detail?' ('+last.detail+')':''));
  throw Error('Request to '+host+' failed: '+(last instanceof Error?last.message:String(last)));
 }
 return {json,cache,limiter,bind:(signal?:AbortSignal):Http=>({json:(url,o)=>json(url,o,signal)})};
}
class RetryLater extends PublicHttpError{constructor(status:number,host:string,public detail:string,public after:number){super(status,host,detail);}}
