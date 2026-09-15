import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';
const fn=readFileSync('db/store.ts','utf8').split('\n').find(l=>l.startsWith('export function model('));
const source='const env={};const process={env:{}};\n'+fn;
const {model}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile(source,{module:ts.ModuleKind.ESNext})).toString('base64'));
test('generation and page agents use Terra while routing and simple tasks stay on mini',()=>{
 for(const role of ['content-generation','app-generation','page-backend-coding','comments:123','page:123'])assert.equal(model(role),'gpt-5.6-terra');
 for(const role of ['', 'app-routing','session-routing','wiki-routing','root-routing'])assert.equal(model(role),'gpt-5.4-mini');
});
