import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';
const fn=readFileSync('db/store.ts','utf8').split('\n').find(l=>l.startsWith('export function model('));
const source='const env={};const process={env:{}};\n'+fn;
const {model}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile(source,{module:ts.ModuleKind.ESNext})).toString('base64'));
test('generation and page agents use Terra while routing and simple tasks stay on mini',()=>{
 for(const role of ['content-generation','app-generation','page-backend-coding','comments:123','page:123'])assert.equal(model(role),'gpt-5.6-terra');
 for(const role of ['', 'app-routing','session-routing','wiki-routing','root-routing'])assert.equal(model(role),'gpt-5.4-mini');
});
const reasoningSource=readFileSync('app/agents/reasoning.ts','utf8');
const {reasoningOptions}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile('const process={env:{}};\n'+reasoningSource,{module:ts.ModuleKind.ESNext})).toString('base64'));
test('explicit reasoning defaults keep routine agents low and coding medium',()=>{
 assert.equal(reasoningOptions('gpt-5.6-terra','content-generation').reasoning.effort,'low');
 assert.equal(reasoningOptions('gpt-5.6-terra','page:p').reasoning.effort,'low');
 assert.equal(reasoningOptions('gpt-5.6-terra','page-backend-coding').reasoning.effort,'medium');
 assert.equal(reasoningOptions('gpt-5.4-mini','root-routing').reasoning.effort,'none');
 assert.equal(reasoningOptions('gpt-5.6-terra','content-generation','high').reasoning.effort,'high');
 assert.deepEqual(reasoningOptions('custom-model'),{});
 assert.throws(()=>reasoningOptions('gpt-5.4-mini','','max'),/does not support/);
});
