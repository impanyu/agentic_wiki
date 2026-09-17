import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';import {z} from 'zod';
const strip=p=>readFileSync(p,'utf8').replace(/^import .*;$/gm,'');const load=async s=>import('data:text/javascript;base64,'+Buffer.from(ts.transpile(s,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
globalThis.processingZ=z;
const catalog=await load(strip('app/adma/processing-catalog.ts'));globalThis.processingCatalog=catalog;
const contract=await load('const z=globalThis.processingZ;const {processingCatalog,processingRunName}=globalThis.processingCatalog;'+strip('app/adma/processing.ts'));
const file='11111111-1111-4111-8111-111111111111',op='22222222-2222-4222-8222-222222222222',task='33333333-3333-4333-8333-333333333333';
test('five run contracts classify writes and validate exact task arguments',()=>{
 assert.equal(contract.processingTools.filter(t=>t.name.startsWith('run_')).length,5);
 assert.ok(contract.processingTools.filter(t=>t.name.startsWith('run_')).every(t=>t.annotations.readOnlyHint===false&&t.inputSchema.required.includes('operation_id')));
 assert.deepEqual(contract.processingInput('shape-to-json',{file_id:file}),{file_id:file});
 assert.throws(()=>contract.processingInput('shape-to-json',{file_id:file,requesting_user_id:123}));
 assert.throws(()=>contract.processingInput('shape-to-json',{file_id:'../private'}));
 assert.throws(()=>contract.processingInput('si-tool',{workflow:'sbf_satellite',buffer_shp_id:file,csv_file_id:file}),/Missing SI input/);
 assert.throws(()=>contract.processingInput('valid-yield-extractor',{plots_file_id:file,app_file_id:file,harv_file_id:file,rate_tolerance:2}),/tolerance/);
});
test('processing jobs are scoped, checked before writes and deduplicated',async()=>{
 const vault=new Map(),calls=[];let isPublic=false,fail=false;
 globalThis.processingDeps={z,...catalog,...contract,lock:async()=> 'lease',unlock:async()=>{},vaultPath:async(u,n)=>u+'/'+n,vaultRead:async p=>vault.get(p),vaultWrite:async(p,v)=>vault.set(p,v),remoteRequest:async(url,headers,body,signal,method)=>{calls.push({url,body,method});assert.equal(headers.Authorization,'Token test');if(url.includes('/metadata/')||url.includes('/info/'))return {data:{is_public:isPublic}};if(url.endsWith('/run/')){if(fail)throw Error('network lost');return {data:{success:true,task_id:task}};}return {data:{status:'SUCCESS',result:{success:true,files:[{id:file,name:'result.geojson'}]}}};}};
 const m=await load('const {'+Object.keys(globalThis.processingDeps).join(',')+'}=globalThis.processingDeps;'+strip('app/adma/processing-server.ts'));
 const args={operation_id:op,file_id:file};isPublic=true;await assert.rejects(m.executeProcessing('alice','c','test','run_shape_to_json',args),/private input/);assert.ok(!calls.some(c=>c.method==='POST'));
 isPublic=false;const r=await m.executeProcessing('alice','c','test','run_shape_to_json',args);assert.equal(r.task_id,task);assert.deepEqual(calls.find(c=>c.method==='POST').body,{file_id:file});
 await m.executeProcessing('alice','c','test','run_shape_to_json',args);assert.equal(calls.filter(c=>c.method==='POST').length,1);
 await assert.rejects(m.executeProcessing('alice','c','test','run_seeding_tool',args),/different inputs/);
 assert.equal((await m.executeProcessing('alice','c','test','processing_status',{task_id:task})).status,'SUCCESS');
 await assert.rejects(m.executeProcessing('bob','c','test','processing_status',{task_id:task}),/not registered/);
 await assert.rejects(m.executeProcessing('alice','other','test','processing_status',{task_id:task}),/not registered/);
 fail=true;const retry={...args,operation_id:'44444444-4444-4444-8444-444444444444'};await assert.rejects(m.executeProcessing('alice','c','test','run_shape_to_json',retry),/network lost/);const before=calls.length;await assert.rejects(m.executeProcessing('alice','c','test','run_shape_to_json',retry),/uncertain/);assert.equal(calls.length,before);
});
