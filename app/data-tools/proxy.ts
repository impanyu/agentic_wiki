import {createServer,request as httpRequest,type Server} from 'node:http';
import {connect,isIP,type Socket} from 'node:net';
import {lookup} from 'node:dns/promises';
import {publicIPv4} from '@/app/url-content/fetch';
// A loopback-only forward proxy for the headless browser. Chromium sends every request through it
// (no local DNS), and the proxy resolves each host itself, refuses non-public addresses and
// connects to the address it checked — so redirects, subresources, WebSockets and DNS rebinding
// cannot reach private, loopback or link-local hosts. Like fetchSource, IPv4 only.
let started:Promise<string>|null=null;
export async function resolvePublic(host:string):Promise<string|null>{
 const h=host.replace(/^\[|\]$/g,'').toLowerCase();
 if(!h||h==='localhost'||/\.(localhost|local|internal)$/.test(h))return null;
 if(isIP(h))return isIP(h)===4&&publicIPv4(h)?h:null;
 try{const all=await lookup(h,{all:true,family:4});return all.length&&all.every(a=>publicIPv4(a.address))?all[0].address:null;}catch{return null;}
}
export function guardProxy():Promise<string>{
 if(started)return started;
 started=new Promise<string>((resolve,reject)=>{
  const server:Server=createServer(async(req,res)=>{
   let url:URL;try{url=new URL(req.url||'');}catch{res.writeHead(400).end();return;}
   if(url.protocol!=='http:'){res.writeHead(400).end();return;}
   const ip=await resolvePublic(url.hostname);if(!ip){res.writeHead(403,{'content-type':'text/plain'}).end('Blocked: not a public address');return;}
   const headers:Record<string,string|string[]|undefined>={...req.headers,host:url.host};delete headers['proxy-connection'];delete headers['proxy-authorization'];
   const up=httpRequest({host:ip,port:Number(url.port)||80,path:url.pathname+url.search,method:req.method,headers,setHost:false,timeout:30_000},r=>{res.writeHead(r.statusCode||502,r.headers);r.pipe(res);});
   up.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});up.on('timeout',()=>up.destroy());
   req.pipe(up);
  });
  server.on('connect',async(req,client:Socket,head:Buffer)=>{
   client.on('error',()=>{});
   const m=String(req.url||'').match(/^\[?([^\]]+?)\]?:(\d+)$/);
   const ip=m?await resolvePublic(m[1]):null;
   if(!m||!ip){client.end('HTTP/1.1 403 Forbidden\r\n\r\n');return;}
   const upstream=connect(Number(m[2]),ip,()=>{client.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)upstream.write(head);upstream.pipe(client);client.pipe(upstream);});
   upstream.setTimeout(60_000,()=>upstream.destroy());client.setTimeout(60_000,()=>client.destroy());
   upstream.on('error',()=>client.destroy());client.on('close',()=>upstream.destroy());
  });
  server.on('error',e=>{started=null;reject(e);});
  server.listen(0,'127.0.0.1',()=>{const a=server.address();server.unref();resolve('http://127.0.0.1:'+(typeof a==='object'&&a?a.port:0));});
 });
 return started;
}
