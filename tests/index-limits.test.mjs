import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';
const source=readFileSync('app/disambiguation/limits.ts','utf8');
const {checkIndexPath}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile(source,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
const node=(id,entries=[],aliases=[id])=>({id,entries,aliases});
test('three index pages are allowed but a fourth is rejected from either end',()=>{
 const chain=[node('A',['B']),node('B',['C']),node('C',['Concrete article'])];
 assert.equal(checkIndexPath(chain,'A'),3);assert.equal(checkIndexPath(chain,'C'),3);
 const long=[...chain.slice(0,2),node('C',['D']),node('D',['Concrete article'])];
 for(const id of ['A','B','C','D'])assert.throws(()=>checkIndexPath(long,id),/INDEX_DEPTH_LIMIT/);
});
test('saved aliases and normalized questions cannot create cycles',()=>{
 assert.throws(()=>checkIndexPath([node('A',['B']),node('B',['  FIRST  INDEX ']),node('unused')].map(n=>n.id==='A'?{...n,aliases:['A','First Index']}:n),'B'),/INDEX_CYCLE/);
 assert.throws(()=>checkIndexPath([node('A',['A'])],'A'),/INDEX_CYCLE/);
});
test('branch depth uses the longest path and unrelated broken graphs do not block new pages',()=>{
 const nodes=[node('A',['B','C']),node('B',['D']),node('C'),node('D'),node('X',['X'])];
 assert.equal(checkIndexPath(nodes,'C'),2);assert.equal(checkIndexPath(nodes,'A'),3);
 assert.equal(checkIndexPath([...nodes,node('New')],'New'),1);
});
