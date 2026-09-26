import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';
const m=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile(readFileSync('app/agents/json-args.ts','utf8'),{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
test('agent JSON arguments: raw newlines and tabs inside strings are repaired',()=>{
 const raw='{"kind":"code","code":{"frontend":{"javascript":"const a=1;\n\tif(a){go();}\n"}}}';
 assert.throws(()=>JSON.parse(raw));
 assert.equal(m.parseToolJson(raw,'changeJson').code.frontend.javascript,'const a=1;\n\tif(a){go();}\n');
 assert.deepEqual(m.parseToolJson('{"a":"x\\"y"}'),{a:'x"y'});
 assert.deepEqual(m.parseToolJson('{"kind":"program","inputFields":[{"name":"a"}]}}'),{kind:'program',inputFields:[{name:'a'}]});
 assert.throws(()=>m.parseToolJson('{"a":1} trailing'),/not valid JSON/);
});
test('agent JSON arguments: other errors name the spot and the likely cause',()=>{
 assert.throws(()=>m.parseToolJson('{"html":"<div class="x">hi</div>"}','changeJson'),e=>/changeJson is not valid JSON/.test(e.message)&&/⟵HERE⟶/.test(e.message)&&/not escaped/.test(e.message));
 assert.throws(()=>m.parseToolJson(undefined,'draftJson'),/must be a JSON-encoded string/);
});
