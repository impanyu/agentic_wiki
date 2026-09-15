import {lookup} from 'node:dns/promises';
import {request} from 'node:https';
import {sourceUrl,publicIPv4} from '@/app/url-content/fetch';
export function connectorUrl(input:string){const url=sourceUrl(input);if(!url||url.protocol!=='https:'||url.search||url.port&&url.port!=='443')throw Error('Use a public HTTPS endpoint without query parameters.');return url;}
// Pin public DNS on the actual TLS socket; never forward credentials across redirects.
export async function remoteRequest(endpoint:string,headers:Record<string,string>,body:unknown,signal?:AbortSignal,method='POST',allowQuery=false){
 const parsed=new URL(endpoint),url=connectorUrl(allowQuery?parsed.origin+parsed.pathname:endpoint);if(allowQuery)url.search=parsed.search;const deadline=AbortSignal.any([AbortSignal.timeout(30000),...(signal?[signal]:[])]);
 const addresses=await lookup(url.hostname,{all:true,family:4});deadline.throwIfAborted();
 if(!addresses.length||addresses.some(a=>!publicIPv4(a.address)))throw Error('Connector endpoint must be public.');
 return new Promise<{headers:Record<string,string|string[]|undefined>;data:any}>((resolve,reject)=>{
  let size=0,text='',done=false;const id=body&&typeof body==='object'&&'id'in body?body.id:undefined;
  const req=request(url,{method,agent:false,family:4,signal:deadline,lookup:(_h,_o,cb)=>cb(null,addresses[0].address,4),headers:{Accept:'application/json, text/event-stream','Content-Type':'application/json','Accept-Encoding':'identity',...headers}},res=>{
   if((res.statusCode||0)<200||(res.statusCode||0)>=300){res.resume();reject(Error('Connector request failed (HTTP '+res.statusCode+').'));return;}
   const finish=(data:any)=>{if(done)return;done=true;resolve({headers:res.headers,data});res.destroy();};
   const match=(data:any)=>{const items=Array.isArray(data)?data:[data];return items.find(x=>x&&x.id===id&&(x.result!==undefined||x.error));};
   res.setEncoding('utf8');res.on('data',(chunk:string)=>{size+=Buffer.byteLength(chunk);if(size>1024*1024){res.destroy(Error('Connector response is too large.'));return;}text+=chunk;
    if(String(res.headers['content-type']).includes('text/event-stream')){text=text.replace(/\r\n/g,'\n');let end;while((end=text.indexOf('\n\n'))>=0){const event=text.slice(0,end);text=text.slice(end+2);const data=event.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');if(data){try{const found=match(JSON.parse(data));if(found)finish(found);}catch{}}}}
   });res.on('error',e=>{if(!done)reject(e);});res.on('end',()=>{if(done)return;try{finish(text.trim()?JSON.parse(text):null);}catch{reject(Error('Invalid connector response.'));}});
  });req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
 });
}
