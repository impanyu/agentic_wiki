import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';
const source=readFileSync('app/storage/adapters.ts','utf8').replace(/^import.*$/gm,'');const {providerOperation}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile(source,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
test('storage providers use fixed endpoints, bounded listings and no credential redirects',async()=>{
 for(const provider of ['google','dropbox','onedrive']){let seen;const result=await providerOperation({provider,operation:'list',args:{parent:'root'}},'test-token',async(url,opts)=>{seen={url,opts};return Response.json(provider==='google'?{files:[]}:provider==='dropbox'?{entries:[]}:{value:[]});});assert.deepEqual(result.items,[]);assert.equal(seen.opts.redirect,'error');assert.equal(seen.opts.headers.Authorization,'Bearer test-token');if(provider==='dropbox')assert.equal(JSON.parse(seen.opts.body).path,'');}
 let calls=0;await assert.rejects(providerOperation({provider:'onedrive',operation:'list',args:{cursor:'https://attacker.example/v1.0/me/drive/files'}},'secret',async()=>{calls++;}));assert.equal(calls,0);
});
test('Dropbox validates names and permits root destination; provider errors redact bodies',async()=>{
 await assert.rejects(providerOperation({provider:'dropbox',operation:'upload',args:{}},'secret',async()=>{throw Error('Must not send');}),/ARGUMENT_REQUIRED/);
 let payload;await providerOperation({provider:'dropbox',operation:'move',args:{id:'/folder/file',parent:'root'}},'secret',async(_u,o)=>{payload=JSON.parse(o.body);return Response.json({metadata:{path_lower:'/file',name:'file'}});});assert.equal(payload.to_path,'/file');
 await assert.rejects(providerOperation({provider:'google',operation:'list',args:{}},'secret',async()=>new Response('secret token',{status:500})),e=>e.message==='STORAGE_OPERATION_FAILED');
});
