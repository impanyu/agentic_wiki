import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';import {z} from 'zod';
test('routing corrects field definitions rather than rejecting a successfully generated page',async()=>{
 globalThis.inputFixture={z,parametersSchema:z.record(z.union([z.string(),z.number(),z.boolean()])),output:r=>r.text,askAgent:async(a,i,t,s,signal,onReply,files,options)=>{
  assert.match(await options.validateFinal({text:JSON.stringify({inputJson:JSON.stringify({fields:t.fields})})}),/flat JSON/);
  assert.equal(await options.validateFinal({text:JSON.stringify({inputJson:'{}'})}),undefined);
  return {inputJson:'{}'};
 }};
 const source=readFileSync('app/page-programs/inputs.ts','utf8').replace(/^import .*;$/gm,'');
 const code='const {'+Object.keys(globalThis.inputFixture).join(',')+'}=globalThis.inputFixture;'+source;
 const m=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile(code,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
 const result=await m.routeInputs('Build a calculator',{title:'Calculator',dynamic:{inputFields:[{name:'before',type:'number',required:true,description:'Original value'}]}},{});
 assert.deepEqual(result,{query:'Build a calculator'});delete globalThis.inputFixture;
});
