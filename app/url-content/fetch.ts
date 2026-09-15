import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {request as httpRequest} from 'node:http';
import {request as httpsRequest} from 'node:https';
import {gunzipSync,inflateSync,brotliDecompressSync} from 'node:zlib';
const limit=6*1024*1024;
export function publicIPv4(address:string){
 if(isIP(address)!==4)return false;
 const [a,b,c]=address.split('.').map(Number);
 return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===2)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113);
}
export function sourceUrl(input:string):URL|null{
 const text=input.trim();
 if(!/^(?:https?:\/\/|www\.)\S+$/i.test(text)){
  if(/^[a-z][a-z\d+.-]*:\/\//i.test(text))throw Error('URL_INVALID');
  return null;
 }
 let url:URL;try{url=new URL(/^www\./i.test(text)?'https://'+text:text);}catch{throw Error('URL_INVALID');}
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.port&&!['80','443'].includes(url.port))throw Error('URL_INVALID');
 const host=url.hostname.toLowerCase();
 if(host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.endsWith('.internal')||!host.includes('.')||isIP(host)&&!publicIPv4(host)||host.startsWith('['))throw Error('URL_PRIVATE');
 url.hash='';
 return url;
}
export async function fetchSource(url:URL,signal:AbortSignal){
 const deadline=AbortSignal.any([signal,AbortSignal.timeout(25000)]);
 for(let redirects=0;redirects<=5;redirects++){
  deadline.throwIfAborted();
  // Pin the validated address on the socket: a second DNS lookup cannot rebind to an internal host.
  const addresses=await new Promise<{address:string;family:number}[]>((resolve,reject)=>{
   const aborted=()=>reject(deadline.reason);deadline.addEventListener('abort',aborted,{once:true});
   lookup(url.hostname,{all:true,family:4}).then(resolve,reject).finally(()=>deadline.removeEventListener('abort',aborted));
   if(deadline.aborted)aborted();
  });
  if(!addresses.length||addresses.some(a=>!publicIPv4(a.address)))throw Error('URL_PRIVATE');
  const result=await new Promise<{status:number;location?:string;type:string;charset?:string;bytes:Buffer}>((resolve,reject)=>{
   const req=(url.protocol==='https:'?httpsRequest:httpRequest)(url,{method:'GET',agent:false,family:4,signal:deadline,lookup:(_host,_options,callback)=>callback(null,addresses[0].address,4),headers:{Accept:'text/html,application/pdf,text/plain,application/json','Accept-Encoding':'identity','User-Agent':'AgenticWiki/1.0 (page reader)'}},res=>{
    const status=res.statusCode||0;
    if(status>=300&&status<400){res.destroy();resolve({status,location:res.headers.location,type:'',bytes:Buffer.alloc(0)});return;}
    if(status<200||status>=300){res.destroy();reject(Error('URL_UNAVAILABLE'));return;}
    const contentType=String(res.headers['content-type']||'').toLowerCase(),type=contentType.split(';')[0].trim(),charset=contentType.match(/charset=["']?([a-z0-9_-]+)/)?.[1];
    if(!['text/html','application/xhtml+xml','text/plain','text/markdown','application/json','application/pdf'].includes(type)){res.destroy();reject(Error('URL_UNSUPPORTED'));return;}
    let size=0;const chunks:Buffer[]=[];
    res.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>limit){res.destroy(Error('URL_TOO_LARGE'));return;}chunks.push(chunk);});
    res.on('error',reject);
    res.on('end',()=>{try{
     let bytes=Buffer.concat(chunks);const encoding=res.headers['content-encoding'];
     if(encoding==='gzip')bytes=gunzipSync(bytes,{maxOutputLength:limit});
     else if(encoding==='deflate')bytes=inflateSync(bytes,{maxOutputLength:limit});
     else if(encoding==='br')bytes=brotliDecompressSync(bytes,{maxOutputLength:limit});
     else if(encoding&&encoding!=='identity')throw Error('URL_UNSUPPORTED');
     if(bytes.length>limit)throw Error('URL_TOO_LARGE');resolve({status,type,charset,bytes});
    }catch{reject(Error('URL_TOO_LARGE'));}});
   });req.on('error',reject);req.end();
  });
  if(result.status>=300&&result.status<400){
   if(!result.location||redirects===5)throw Error('URL_UNAVAILABLE');
   const next=sourceUrl(new URL(result.location,url).href);if(!next)throw Error('URL_INVALID');url=next;continue;
  }
  return {...result,url:url.href};
 }
 throw Error('URL_UNAVAILABLE');
}
export function sourceText(html:string){
 const entities:Record<string,string>={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
 return html.replace(/<!--[\s\S]*?-->/g,' ').replace(/<(script|style|noscript|svg|nav|footer|header|form)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ')
  .replace(/<[^>]+>/g,' ').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(_,entity:string)=>{
   if(entity[0]!=='#')return entities[entity.toLowerCase()]||' ';
   const number=entity[1].toLowerCase()==='x'?parseInt(entity.slice(2),16):parseInt(entity.slice(1),10);
   return number>0&&number<=0x10ffff?String.fromCodePoint(number):' ';
  }).replace(/\s+/g,' ').trim();
}
