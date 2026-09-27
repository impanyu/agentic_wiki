import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {mkdtemp,rm,readdir} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import ts from 'typescript';
import * as childProcess from 'node:child_process';import * as fsp from 'node:fs/promises';import * as os from 'node:os';import * as path from 'node:path';

// Earth Engine scripts run offline with the real client library; the server answers their
// requests pass by pass. Google's API is replaced by a fake here.
const load=async(file,prelude)=>import('data:text/javascript;base64,'+Buffer.from(ts.transpile(prelude+readFileSync(file,'utf8').replace(/^import .*;$/gm,''),{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
globalThis.__ee={childProcess,fsp,os,path};
const sandbox=await load('app/earth-engine/sandbox.ts',"const {spawn,spawnSync}=globalThis.__ee.childProcess;const {mkdtemp,writeFile,readFile,rm,copyFile,realpath}=globalThis.__ee.fsp;const {tmpdir}=globalThis.__ee.os;const {join,resolve}=globalThis.__ee.path;\n");
const ALG=JSON.stringify({algorithms:[
 {name:'algorithms/Image.load',description:'',returnType:'Image',arguments:[{argumentName:'id',type:'String'},{argumentName:'version',type:'Long',optional:true}]},
 {name:'algorithms/Image.bandNames',description:'',returnType:'List',arguments:[{argumentName:'image',type:'Image'}]},
 {name:'algorithms/Image.select',description:'',returnType:'Image',arguments:[{argumentName:'input',type:'Image'},{argumentName:'bandSelectors',type:'List'},{argumentName:'newNames',type:'List',optional:true}]},
]});

test('sandbox records the requests an Earth Engine script makes and replays answers',async()=>{
 const code="const names=ee.Image('USGS/SRTMGL1_003').bandNames().getInfo();print('bands',names);return {names};";
 const first=await sandbox.runEeScript(code,'demo-project',ALG,{});
 assert.equal(first.pending.length,1);assert.equal(first.pending[0].method,'POST');
 assert.equal(first.pending[0].url,'https://earthengine.googleapis.com/v1/projects/demo-project/value:compute');
 assert.match(first.pending[0].body,/Image\.bandNames[\s\S]*USGS\/SRTMGL1_003|USGS\/SRTMGL1_003[\s\S]*Image\.bandNames/);
 const second=await sandbox.runEeScript(code,'demo-project',ALG,{[sandbox.requestKey(first.pending[0])]:{status:200,text:JSON.stringify({result:['elevation']})}});
 assert.equal(second.ok,true);assert.deepEqual(second.result,{names:['elevation']});assert.deepEqual(second.pending,[]);assert.deepEqual(second.logs,['bands ["elevation"]']);
 const bad=await sandbox.runEeScript("return ee.Image('X');",'demo-project',ALG,{});
 assert.equal(bad.ok,false);assert.match(bad.error,/plain values/);
 // Network isolation comes from a user namespace, present on the Linux servers.
 if(childProcess.spawnSync('unshare',['-rn','true']).status===0){const net=await sandbox.runEeScript("const r=await fetch('https://example.com');return r.status;",'demo-project',ALG,{});assert.equal(net.ok,false);}
});

test('service vets requests, counts quota, keeps thumbnails and proxies tiles',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ee-svc-'));process.env.DATA_DIR=dir;process.env.APP_URL='https://wiki.example';
 const usage=[],maps=[];
 globalThis.__eeSvc={mkdir:fsp.mkdir,readFile:fsp.readFile,writeFile:fsp.writeFile,stat:fsp.stat,resolve:path.resolve,join:path.join,runEeScript:sandbox.runEeScript,requestKey:sandbox.requestKey,
  lock:async()=>'l',unlock:async()=>{},
  database:()=>({prepare:sql=>({bind:(...a)=>({first:async()=>/SUM/.test(sql)?{n:0}:null,run:async()=>{if(/earth_engine_usage/.test(sql))usage.push(a);if(/earth_engine_maps/.test(sql))maps.push(a);}})})}),
  platformStatus:async()=>({configured:true,project:'demo-project'}),userConnection:async()=>null,
  platformAccount:async u=>({kind:'platform',project:'demo-project',ownerId:u,token:async()=>'tok'}),userAccount:async()=>{throw Error('no');}};
 const svc=await load('app/earth-engine/service.ts',"const {mkdir,readFile,writeFile,stat,resolve,join,runEeScript,requestKey,lock,unlock,database,platformStatus,userConnection,platformAccount,userAccount}=globalThis.__eeSvc;\n");
 assert.equal(svc.vetRequest({method:'POST',url:'https://earthengine.googleapis.com/v1/projects/demo-project/image:export',body:''},'demo-project')?.includes('Exports'),true);
 assert.equal(svc.vetRequest({method:'POST',url:'https://earthengine.googleapis.com/v1/projects/other/value:compute',body:''},'demo-project')?.includes('account project'),true);
 assert.equal(svc.vetRequest({method:'POST',url:'https://earthengine.googleapis.com/v1/projects/demo-project/value:compute',body:''},'demo-project'),null);
 const calls=[];const realFetch=globalThis.fetch;
 globalThis.fetch=async(url,init={})=>{calls.push({url:String(url),auth:init.headers?.Authorization});
  if(/\/algorithms/.test(url))return new Response(ALG,{status:200});
  if(/value:compute/.test(url))return new Response(JSON.stringify({result:['elevation']}),{status:200});
  if(/\/thumbnails$|\/thumbnails\?/.test(url))return new Response(JSON.stringify({name:'projects/demo-project/thumbnails/abc123'}),{status:200});
  if(/:getPixels/.test(url))return new Response(new Uint8Array([137,80,78,71]),{status:200,headers:{'content-type':'image/png'}});
  return new Response('{}',{status:404});};
 try{
  const out=await svc.runEarthEngine({code:"const n=ee.Image('USGS/SRTMGL1_003').bandNames().getInfo();return {n,thumb:'https://earthengine.googleapis.com/v1/projects/demo-project/thumbnails/abc123:getPixels',tiles:'https://earthengine.googleapis.com/v1/projects/demo-project/maps/m1/tiles/{z}/{x}/{y}'};"},'alice');
  assert.equal(out.ok,true,out.error);assert.equal(out.account,'platform');assert.equal(out.requests,1);
  assert.deepEqual(out.result.n,['elevation']);
  assert.match(out.result.thumb,/^https:\/\/wiki\.example\/api\/earth-engine\/thumbnails\/[a-f0-9]{32}\.png$/);assert.equal(out.images.length,1);
  assert.match(out.result.tiles,/^https:\/\/wiki\.example\/api\/earth-engine\/tiles\/[a-f0-9]{32}\/\{z\}\/\{x\}\/\{y\}$/);assert.equal(maps[0][4],'projects/demo-project/maps/m1');
  assert.ok(calls.every(c=>c.auth==='Bearer tok'));assert.equal(usage.length,1);
  const id=out.result.thumb.split('/').pop();assert.deepEqual([...(await svc.thumbnailFile(id)).bytes],[137,80,78,71]);assert.equal(await svc.thumbnailFile('../x'),null);
  await assert.rejects(()=>svc.runEarthEngine({code:'return 1;'},'guest:x'),/Sign in/);
 }finally{globalThis.fetch=realFetch;await rm(dir,{recursive:true,force:true});}
});
