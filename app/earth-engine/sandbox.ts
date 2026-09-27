import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp,writeFile,readFile,rm,copyFile,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

// Runs agent-written Earth Engine JavaScript with the official client library, but offline: the
// script runs in the same locked-down child process as page programs (no network namespace, Node's
// permission model, 256 MB heap, 20 s), and every Earth Engine API request the library makes is
// answered from `responses` or recorded as pending. The server executes pending requests with its
// own credentials and runs the script again with the answers (a deterministic replay), so the
// sandbox never holds a token and can only ask for requests the server then vets.
export type EeRequest={method:string;url:string;body:string};
export type EeResponse={status:number;text:string};
export type SandboxOutcome={ok:boolean;result:unknown;logs:string[];pending:EeRequest[];error:string};
export const requestKey=(r:EeRequest)=>r.method+' '+r.url+'\n'+r.body;
export const libraryPath=()=>resolve(process.cwd(),'vendor/earthengine/ee.cjs');

let isolated:boolean|undefined;
function canIsolate(){if(isolated===undefined){try{isolated=spawnSync('unshare',['-rn','true'],{timeout:5000}).status===0;}catch{isolated=false;}}return isolated;}

const RUNNER=`'use strict';
const fs=require('node:fs');
const job=JSON.parse(fs.readFileSync(__dirname+'/job.json','utf8'));
const ee=require('./ee.cjs');
const pending=new Map(),logs=[];
const text=v=>{try{return typeof v==='string'?v:JSON.stringify(v);}catch{return String(v);}};
const print=(...a)=>{if(logs.length<200)logs.push(a.map(text).join(' ').slice(0,4000));};
const answer=(url,method,data)=>{
 const request={method:String(method||'GET'),url:String(url),body:typeof data==='string'?data:''};
 if(/\\/algorithms(\\?|$)/.test(request.url)&&request.method==='GET')return {status:200,text:job.algorithms,contentType:'application/json'};
 const key=request.method+' '+request.url+'\\n'+request.body,known=job.responses[key];
 if(known)return {status:known.status,text:known.text,contentType:'application/json'};
 pending.set(key,request);
 return {status:503,text:JSON.stringify({error:{code:503,message:'__EE_PENDING__ (answered on the next pass)',status:'UNAVAILABLE'}}),contentType:'application/json'};
};
ee.data.setupMockSend(new Proxy({},{has:()=>true,get:()=>answer}));
const finish=(out)=>{fs.writeFileSync(__dirname+'/out.json',JSON.stringify({...out,logs,pending:[...pending.values()]}));process.exit(0);};
const plain=v=>{if(v instanceof ee.ComputedObject)throw Error('Return plain values: call .getInfo() on Earth Engine objects (or getThumbURL / getMapId) before returning them.');return v;};
ee.initialize(null,null,async()=>{
 try{
  const main=require('./script.cjs');
  const result=await main(ee,print);
  finish({ok:true,result:JSON.parse(JSON.stringify(result===undefined?null:result,(k,v)=>plain(v)))});
 }catch(e){finish({ok:false,error:String(e&&e.stack||e).slice(0,4000)});}
},e=>finish({ok:false,error:'Earth Engine initialization failed: '+text(e)}),null,job.project);
`;

export async function runEeScript(code:string,project:string,algorithms:string,responses:Record<string,EeResponse>):Promise<SandboxOutcome>{
 // The real path: the permission model checks resolved paths (macOS temp folders are symlinks).
 const dir=await realpath(await mkdtemp(join(tmpdir(),'agenticwiki-ee-')));
 try{
  await copyFile(libraryPath(),join(dir,'ee.cjs'));
  await writeFile(join(dir,'job.json'),JSON.stringify({project,algorithms,responses}));
  await writeFile(join(dir,'script.cjs'),'module.exports=async function(ee,print){\n'+code+'\n};\n');
  await writeFile(join(dir,'run.cjs'),RUNNER);
  const node=[process.execPath,'--permission','--allow-fs-read='+dir,'--allow-fs-write='+dir,'--max-old-space-size=256','--disallow-code-generation-from-strings',join(dir,'run.cjs')];
  // Production servers isolate the network with a user namespace; a development machine without
  // one still gets Node's permission model, and the library itself has no network transport.
  const [cmd,args]=canIsolate()?['unshare',['-rn',...node]]:process.env.NODE_ENV==='production'?['','']:[node[0],node.slice(1)];
  if(!cmd)return {ok:false,result:null,logs:[],pending:[],error:'The Earth Engine sandbox is unavailable on this server.'};
  const {code:status,stderr}=await new Promise<{code:number|null;stderr:string}>(done=>{
   const child=spawn(cmd,args as string[],{cwd:dir,env:{PATH:process.env.PATH||'/usr/bin:/bin',NODE_ENV:'production'},stdio:['ignore','ignore','pipe']});
   let err='';child.stderr.on('data',c=>{err=(err+c.toString()).slice(-8000);});
   const timer=setTimeout(()=>{child.kill('SIGKILL');err+='\nThe script exceeded its 20-second limit.';},20000);
   child.on('close',s=>{clearTimeout(timer);done({code:s,stderr:err});});
   child.on('error',e=>{clearTimeout(timer);done({code:-1,stderr:err+'\n'+e.message});});
  });
  const text=await readFile(join(dir,'out.json'),'utf8').catch(()=> '');
  if(!text)return {ok:false,result:null,logs:[],pending:[],error:(stderr||'The script stopped without a result (exit '+status+').').trim().slice(-4000)};
  if(text.length>4_000_000)return {ok:false,result:null,logs:[],pending:[],error:'The script result exceeds 4 MB; return a smaller summary.'};
  const out=JSON.parse(text);return {ok:!!out.ok,result:out.result??null,logs:out.logs||[],pending:out.pending||[],error:out.error||''};
 }finally{await rm(dir,{recursive:true,force:true}).catch(()=>{});}
}
