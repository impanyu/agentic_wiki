import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';import {z} from 'zod';
const load=async s=>import('data:text/javascript;base64,'+Buffer.from(ts.transpile(readFileSync('app/page-permissions.ts','utf8').replace(/import [\s\S]*?from ['"][^'"]+['"];?/g,'')+'\n'+s,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
const strip=p=>readFileSync(p,'utf8').replace(/import [\s\S]*?from ['"][^'"]+['"];?/g,'');
test('saved page backend reuses tool results and renders per-user data without changing mapping',async()=>{
 let count=0,configured=true,repeat=false;const view={templateId:'files-v1',title:'My files',summary:'Live files',files:[]};
 globalThis.programTest={getPage:async()=>({owned:true}),sandboxContextFiles:async()=>({uploads:[],metadata:[]}),fileContext:async()=>({parts:[]}),runProgram:async(_p,{input,results},{userId})=>{assert.equal(userId,'alice');assert.equal(JSON.stringify({input,results}).includes('secret-token'),false);return {ok:true,result:!results.list||repeat?{call:{id:'list',tool:'storage.execute',args:{provider:'google',operation:'list',args:{}}}}:{view}};},sandboxStatus:()=>({configured,allowed:true}),getComponent:async(_ref,{userId})=>{assert.equal(userId,'alice');return {payload:'{}'};},executeApi:async()=>{},storageStatus:async()=>[],executeStorage:async(_args,uid)=>{assert.equal(uid,'alice');count++;return {items:[]};},listDataFiles:async()=>[],api:async()=>{},output:()=>'',model:()=>'',programOutput:{parse:x=>x},validateChartData:()=>{}};
 const names=Object.keys(globalThis.programTest).join(',');const m=await load('const {'+names+'}=globalThis.programTest;\n'+strip('app/page-programs/runtime.ts'));const page={id:'stable-page',title:'Saved',summary:'Definition',dynamic:{components:{backend:{id:'b',version:1}}},labels:{}};
 const result=await m.runPageProgram(page,{},'alice');assert.equal(result.id,page.id);assert.equal(result.title,'My files');assert.equal(page.title,'Saved');assert.equal(count,1);assert.equal(result.runtimeError,undefined);
 repeat=true;const failure=await m.runPageProgram(page,{},'alice');assert.ok(failure.runtimeError);assert.equal(failure.id,page.id);
 configured=false;const missing=await m.runPageProgram(page,{},'alice');assert.match(missing.runtimeError,/execution sandbox/);delete globalThis.programTest;
});
test('storage writes are private proposals until explicitly approved, with replay protection',async()=>{
 const saved=new Map();let calls=0;const path=async(u,id)=>u+'/'+id;
 globalThis.storageTest={storageRequest:{parse:x=>x},isMutation:op=>op!=='list'&&op!=='read',storageToken:async()=> 'secret-token',providerOperation:async()=>{calls++;return {ok:true};},vaultPath:path,vaultRead:async p=>saved.get(p),vaultWrite:async(p,v)=>saved.set(p,v),signedIn:u=>{if(u.startsWith('guest:'))throw Error('guest');},lock:async()=> 'lease',unlock:async()=>{}};
 const m=await load('const {'+Object.keys(globalThis.storageTest).join(',')+'}=globalThis.storageTest;\n'+strip('app/storage/service.ts'));
 const p=await m.executeStorage({provider:'google',operation:'trash',args:{id:'file'}},'alice');assert.equal(calls,0);assert.ok(p.confirmationRequired);await assert.rejects(m.approveStorage(p.actionId,'bob'));assert.equal(calls,0);
 await m.approveStorage(p.actionId,'alice');await m.approveStorage(p.actionId,'alice');assert.equal(calls,1);delete globalThis.storageTest;
});
