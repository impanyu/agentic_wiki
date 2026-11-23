import {lookup} from 'node:dns/promises';
import {request as httpRequest,type IncomingMessage} from 'node:http';
import {request as httpsRequest} from 'node:https';
import {createGunzip,createInflate,createBrotliDecompress} from 'node:zlib';
import type {Readable} from 'node:stream';
import {publicIPv4,sourceUrl} from '@/app/url-content/fetch';
// Streaming download for bulk data files (dumps of millions of rows): the same public-address pinning and
// redirect re-checks as fetchSource, but no size limit and no overall deadline — only an idle timeout.
// gzip is undone on the fly (a ".gz" file or a gzip content-encoding).
export async function openStream(input:string,signal:AbortSignal,{idleMs=120_000}:{idleMs?:number}={}):Promise<{url:string;type:string;body:Readable}>{
 const {resolveSecrets}=await import('./secrets');
 let url=sourceUrl(resolveSecrets(input));if(!url)throw Error('This is not a valid public http(s) address.');
 for(let redirects=0;redirects<=5;redirects++){
  signal.throwIfAborted();
  const addresses=await lookup(url.hostname,{all:true,family:4});
  if(!addresses.length||addresses.some(a=>!publicIPv4(a.address)))throw Error('Only public internet addresses can be fetched.');
  const res=await new Promise<IncomingMessage>((resolve,reject)=>{
   const req=(url!.protocol==='https:'?httpsRequest:httpRequest)(url!,{method:'GET',agent:false,family:4,signal,lookup:(_h,_o,cb)=>cb(null,addresses[0].address,4),
    headers:{Accept:'*/*','Accept-Encoding':'gzip','User-Agent':'RankWiki/1.0 (bulk data loader)'}},resolve);
   req.setTimeout(idleMs,()=>req.destroy(Error('The download stalled: '+input)));
   req.on('error',reject);req.end();
  });
  const status=res.statusCode||0;
  if(status>=300&&status<400){res.resume();const loc=res.headers.location;if(!loc)break;const next=sourceUrl(new URL(loc,url).href);if(!next)throw Error('Redirect to a non-public address.');url=next;continue;}
  if(status<200||status>=300){res.resume();const {redactSecrets}=await import('./secrets');throw Error('HTTP '+status+' for '+redactSecrets(url.href));}
  const type=String(res.headers['content-type']||'').split(';')[0].trim().toLowerCase();
  if(/^(image|video|audio|font)\//.test(type)||/zip|pdf/.test(type)&&!/gzip/.test(type))throw Error('Not a data file ('+type+'): '+url.href);
  res.setTimeout(idleMs,()=>res.destroy(Error('The download stalled: '+url!.href)));
  const enc=String(res.headers['content-encoding']||'');
  let body:Readable=res;
  if(enc==='gzip'||enc==='x-gzip')body=body.pipe(createGunzip());else if(enc==='deflate')body=body.pipe(createInflate());else if(enc==='br')body=body.pipe(createBrotliDecompress());
  if(/\.gz$/i.test(url.pathname)||type==='application/gzip'||type==='application/x-gzip')body=body.pipe(createGunzip());
  return {url:url.href,type,body};
 }
 throw Error('Too many redirects: '+input);
}
// Lines of a stream (UTF-8), without the newline.
export async function* lines(body:Readable):AsyncGenerator<string>{
 const dec=new TextDecoder('utf-8');let rest='';
 for await(const chunk of body){
  rest+=dec.decode(chunk as Buffer,{stream:true});
  let i:number;while((i=rest.indexOf('\n'))>=0){yield rest.slice(0,i).replace(/\r$/,'');rest=rest.slice(i+1);}
 }
 rest+=dec.decode();if(rest)yield rest.replace(/\r$/,'');
}
// Records of a CSV/TSV line stream: quoted fields may hold the delimiter, quotes ("") and newlines.
export async function* delimitedRecords(src:AsyncIterable<string>,delim:string):AsyncGenerator<string[]>{
 let fields:string[]=[],field='',quoted=false,started=false;
 for await(const line of src){
  for(let i=0;i<line.length;i++){
   const c=line[i];
   if(quoted){if(c==='"'){if(line[i+1]==='"'){field+='"';i++;}else quoted=false;}else field+=c;}
   else if(c==='"'&&field==='')quoted=true;
   else if(c===delim){fields.push(field);field='';}
   else field+=c;
  }
  started=true;
  if(quoted){field+='\n';continue;}
  fields.push(field);yield fields;fields=[];field='';started=false;
 }
 if(started){fields.push(field);yield fields;}
}
