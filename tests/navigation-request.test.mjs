import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
const source=ts.transpile(readFileSync('app/navigation-request.ts','utf8'),{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022});
const {navigationRequest}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
test('a transient fetch failure retries the exact saved destination',async()=>{
 const original=globalThis.fetch;let calls=[];
 globalThis.fetch=async(url,init)=>{calls.push([url,init.method]);if(calls.length===1)throw new TypeError('Load failed');return new Response('{}');};
 try{assert.equal((await navigationRequest('/api/pages/saved')).status,200);assert.deepEqual(calls,[['/api/pages/saved',undefined],['/api/pages/saved',undefined]]);}finally{globalThis.fetch=original;}
});
test('permission failures are not retried',async()=>{
 const original=globalThis.fetch;let count=0;globalThis.fetch=async()=>{count++;return new Response('{}',{status:404});};
 try{assert.equal((await navigationRequest('/api/pages/private')).status,404);assert.equal(count,1);}finally{globalThis.fetch=original;}
});
test('cancelling navigation cancels the pending retry',async()=>{
 const original=globalThis.fetch,controller=new AbortController();let count=0;
 globalThis.fetch=async()=>{count++;controller.abort();throw new TypeError('Load failed');};
 try{await assert.rejects(navigationRequest('/api/pages/saved',{signal:controller.signal}));assert.equal(count,1);}finally{globalThis.fetch=original;}
});
