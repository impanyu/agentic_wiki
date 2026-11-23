import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {sourceUrl,fetchSource,publicIPv4} from '@/app/url-content/fetch';
// Server-side HTTP for the data tools: every request goes through fetchSource (public-address
// pinning, redirect re-checks, size limit, no cookies or credentials).
export const DATA_TYPES=/^(text\/(html|plain|csv|tab-separated-values|xml|markdown)|application\/([\w.+-]*json|[\w.+-]*xml|xhtml\+xml|csv|x-ndjson|jsonl|vnd\.ms-excel)|text\/x-csv)$/;
export function publicUrl(input:string):URL{
 let url:URL|null;
 try{url=sourceUrl(String(input||''));}catch(e){throw Error((e as Error).message==='URL_PRIVATE'?'Only public internet addresses can be fetched.':'This is not a valid http(s) address.');}
 if(!url)throw Error('Give a full web address (https://…).');
 return url;
}
export function friendlyError(e:unknown,url:string):Error{
 const m=(e as Error)?.message||String(e);
 const known:Record<string,string>={URL_PRIVATE:'Only public internet addresses can be fetched.',URL_INVALID:'This is not a valid http(s) address.',URL_TOO_LARGE:'The response is too large (limit 20 MB); ask the API for fewer rows or columns.',URL_UNSUPPORTED:'The response is not a data format these tools read (JSON, CSV/TSV, XML, HTML).',URL_UNAVAILABLE:'The address could not be fetched (HTTP error, login wall, access challenge or too many redirects): '+url+'. Do not try to get around it: read its archived copy (call_public_source archive.wayback_fetch, or archive.commoncrawl_index + commoncrawl_fetch; extract_tables, browse_page and crawl_pages do this automatically), or use the platform\'s official API or a data dump.'};
 if(known[m])return Error(known[m]);
 if(/abort|timeout/i.test(m))return Error('The request timed out: '+url);
 if(/ENOTFOUND|EAI_AGAIN/.test(m))return Error('The host does not exist: '+new URL(url).hostname);
 return e instanceof Error?e:Error(m);
}
export async function fetchText(input:string|URL,signal:AbortSignal,options:{accept?:string;anyType?:boolean;maxBytes?:number;headers?:Record<string,string>}={}){
 const url=typeof input==='string'?publicUrl(input):input;
 try{
  const r=await fetchSource(url,signal,{headers:options.headers,maxBytes:options.maxBytes||20*1024*1024,accept:options.accept||'application/json,text/csv,application/xml,text/xml,text/html;q=0.9,*/*;q=0.5',allowType:t=>options.anyType?!/^(image|video|audio|font)\/|zip|pdf/.test(t):DATA_TYPES.test(t)});
  return {url:r.url,type:r.type,text:new TextDecoder(r.charset||'utf-8').decode(r.bytes)};
 }catch(e){const {redactSecrets}=await import('./secrets');const f=friendlyError(e,url.href);throw Error(redactSecrets(f.message));}
}
// For the browser: a request may go out only when its host resolves to public IPv4 addresses.
const dnsCache=new Map<string,{at:number;ok:boolean}>();
export async function publicHost(hostname:string):Promise<boolean>{
 const host=hostname.toLowerCase().replace(/^\[|\]$/g,'');
 if(!host||host==='localhost'||/\.(localhost|local|internal|home|lan|corp)$/.test(host)||!host.includes('.'))return false;
 if(isIP(host))return publicIPv4(host);
 const hit=dnsCache.get(host);if(hit&&Date.now()-hit.at<60_000)return hit.ok;
 let ok=false;
 try{const all=await lookup(host,{all:true});ok=all.length>0&&all.every(a=>a.family===4?publicIPv4(a.address):publicIPv6(a.address));}catch{ok=false;}
 dnsCache.set(host,{at:Date.now(),ok});if(dnsCache.size>2000)dnsCache.delete(dnsCache.keys().next().value!);
 return ok;
}
// Global unicast IPv6 only (2000::/3), excluding mapped/documentation ranges handled conservatively.
export function publicIPv6(address:string){
 const a=address.toLowerCase();
 if(a.startsWith('::ffff:'))return publicIPv4(a.slice(7));
 return /^[23][0-9a-f]{3}:/.test(a)&&!a.startsWith('2001:db8')&&!a.startsWith('2002:');
}
export async function allowedRequestUrl(raw:string):Promise<boolean>{
 let u:URL;try{u=new URL(raw);}catch{return false;}
 if(u.protocol==='data:'||u.protocol==='blob:'||u.protocol==='about:')return true;
 if(!/^(https?|wss?):$/.test(u.protocol)||u.username||u.password)return false;
 return publicHost(u.hostname);
}
