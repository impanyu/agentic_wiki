import {lookup} from 'node:dns/promises';
import {request} from 'node:https';
import {gunzipSync,inflateSync,brotliDecompressSync} from 'node:zlib';
import {sourceUrl,publicIPv4} from '@/app/url-content/fetch';
import type {Transport} from '@/app/public-data/fetcher';
// HTTPS GET for the public data sources, with the same guarantees as connectors/http.ts
// remoteRequest (public DNS pinned on the TLS socket, every redirect re-validated, no
// credentials sent across hosts) plus what these APIs need: the HTTP status for retries,
// compressed bodies (Stack Exchange always compresses) and responses up to 8 MB.
const MAX_BYTES=8*1024*1024;
export const httpsTransport:Transport=async(input,{headers,signal,timeoutMs})=>{
 const deadline=AbortSignal.any([AbortSignal.timeout(timeoutMs),...(signal?[signal]:[])]);
 let url=new URL(input);const origin=url.origin;
 for(let redirects=0;redirects<=3;redirects++){
  const checked=sourceUrl(url.href);if(!checked||checked.protocol!=='https:'||url.port&&url.port!=='443')throw Error('Public sources use public HTTPS endpoints only.');
  const addresses=await lookup(url.hostname,{all:true,family:4});deadline.throwIfAborted();
  if(!addresses.length||addresses.some(a=>!publicIPv4(a.address)))throw Error('The endpoint must be public.');
  // Headers that carry a server credential are only sent to the original host.
  const sent=url.origin===origin?headers:Object.fromEntries(Object.entries(headers).filter(([k])=>!/^(authorization|x-[a-z-]*key|x-cg-[a-z-]*)$/i.test(k)));
  const res=await new Promise<{status:number;headers:Record<string,string|string[]|undefined>;text:string}>((resolve,reject)=>{
   const req=request(url,{method:'GET',agent:false,family:4,signal:deadline,lookup:(_h,_o,cb)=>cb(null,addresses[0].address,4),headers:{'Accept-Encoding':'gzip, deflate, br',...sent}},r=>{
    const status=r.statusCode||0;
    if(status>=300&&status<400){r.resume();resolve({status,headers:r.headers,text:''});return;}
    let size=0;const chunks:Buffer[]=[];
    r.on('data',(c:Buffer)=>{size+=c.length;if(size>MAX_BYTES){r.destroy(Error('The response is larger than 8 MB; ask for fewer rows.'));return;}chunks.push(c);});
    r.on('error',reject);
    r.on('end',()=>{try{
     let bytes=Buffer.concat(chunks);const enc=String(r.headers['content-encoding']||'identity');
     if(enc==='gzip')bytes=gunzipSync(bytes,{maxOutputLength:MAX_BYTES*4});else if(enc==='deflate')bytes=inflateSync(bytes,{maxOutputLength:MAX_BYTES*4});else if(enc==='br')bytes=brotliDecompressSync(bytes,{maxOutputLength:MAX_BYTES*4});
     resolve({status,headers:r.headers,text:bytes.toString('utf8')});
    }catch{reject(Error('The response could not be decoded or is too large.'));}});
   });
   req.on('error',reject);req.end();
  });
  if(res.status>=300&&res.status<400&&res.headers.location){url=new URL(String(res.headers.location),url);continue;}
  return res;
 }
 throw Error('Too many redirects.');
};
