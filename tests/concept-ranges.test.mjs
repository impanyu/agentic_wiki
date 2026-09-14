import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';
const source=readFileSync('app/concepts/ranges.ts','utf8').replace(/^import.*$/gm,'');const {conceptRanges,availableConcepts}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile(source,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
test('concept phrases use exact source text and coordinates, including Chinese and repeated phrases',()=>{
 const nodes=new Map([['line0.0','中国西南部包括四川。四川位于中国西南部。'],['title','中国']]);
 const ranges=conceptRanges(nodes,[{node:'line0.0',text:'中国西南部'},{node:'line0.0',text:'四川'},{node:'line0.0',text:'invented'},{node:'title',text:'中国'}]);
 assert.equal(ranges.length,4);for(const r of ranges){const s=r.segments[0];assert.equal(nodes.get(s.node).slice(s.start,s.end),r.quote);}
});
test('saved underlines and manual highlights take precedence without being changed',()=>{
 const concept={quote:'northern China',segments:[{node:'line0.0',start:0,end:14}]},saved={quote:'China',segments:[{node:'line0.0',start:9,end:14}],id:'saved',targetId:'page',targetTitle:'China'};const before=JSON.stringify(saved);
 assert.deepEqual(availableConcepts([concept],[saved],[]),[]);assert.equal(JSON.stringify(saved),before);assert.deepEqual(availableConcepts([concept],[],[saved]),[]);assert.deepEqual(availableConcepts([concept],[],[]),[concept]);
});

test('overview concepts are included with exact coordinates',()=>{const nodes=new Map([['summary.0','A political party contests elections.']]);assert.deepEqual(conceptRanges(nodes,[{node:'summary.0',text:'political party'}]),[{quote:'political party',segments:[{node:'summary.0',start:2,end:17}]}]);});
test('dense concept indexes exceed the old limit and preserve word boundaries',()=>{
 const nodes=new Map(Array.from({length:350},(_,i)=>['line'+i+'.0','music and musician']));
 const ranges=conceptRanges(nodes,[...nodes.keys()].map(node=>({node,text:'music'})));
 assert.equal(ranges.length,350);assert.ok(ranges.every(r=>r.segments[0].start===0));
});
test('established compound names stay intact while adjacent concepts remain separate',()=>{
 const nodes=new Map([['line0.0','A political party discusses legal agreement or dispute.']]);
 const ranges=conceptRanges(nodes,['party','political party','legal agreement','dispute'].map(text=>({node:'line0.0',text})));
 assert.deepEqual(ranges.map(r=>r.quote).sort(),['dispute','legal agreement','political party']);
});
