import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';
// Recipe checks (app/teams/recipes.ts, pure parts; tool imports stripped).
const src=readFileSync('app/teams/recipes.ts','utf8').replace(/^import .*;$/gm,'');
const m=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile(src,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
const fetch=(id)=>({id,tool:'call_public_source',args:{sourceId:'worldbank',tool:'indicator'}});
test('a recipe must load every dataset it fetches, and load something',()=>{
 const steps=m.parseSteps([fetch('gdp'),fetch('pop'),{id:'load',tool:'entity_upsert',args:{datasetId:'$gdp'}}]);
 const p=m.checkRecipe(steps);assert.equal(p.length,1);assert.match(p[0],/"pop".*no later step uses/);
 assert.deepEqual(m.checkRecipe(m.parseSteps([fetch('a'),{id:'j',tool:'query_data',args:{inputs:{a:'$a'},expression:'a'}},{id:'l',tool:'entity_upsert',args:{datasetId:'$j'}}])),[]);
 assert.match(m.checkRecipe(m.parseSteps([fetch('a'),{id:'d',tool:'describe_data',args:{datasetId:'$a'}}])).join(' '),/never loads anything/);
});
test('steps are validated: ids, allowed tools',()=>{
 assert.throws(()=>m.parseSteps([]),/non-empty/);
 assert.throws(()=>m.parseSteps([{id:'x',tool:'execute_code',args:{}}]),/tool must be one of/);
 assert.throws(()=>m.parseSteps([fetch('a'),fetch('a')]),/Duplicate step id/);
});
