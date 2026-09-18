import test from 'node:test';import assert from 'node:assert/strict';import ts from 'typescript';import {readFileSync} from 'node:fs';
const m=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile(readFileSync('app/papers/source.ts','utf8'),{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
test('paper reader prefers a verified PDF source and derives arXiv PDFs',()=>{
 assert.equal(m.sourcePaperPdf([{title:'record',url:'https://example.org/paper'},{title:'PDF',url:'https://cse.unl.edu/paper/My%20Paper.pdf'}]),'https://cse.unl.edu/paper/My%20Paper.pdf');
 assert.equal(m.sourcePaperPdf([{title:'arXiv',url:'https://arxiv.org/abs/2411.00188'}]),'https://arxiv.org/pdf/2411.00188');
 assert.equal(m.sourcePaperPdf([{title:'arXiv HTML',url:'https://arxiv.org/html/1706.03762v7'}]),'https://arxiv.org/pdf/1706.03762');
 assert.equal(m.sourcePaperPdf([{title:'unsafe',url:'http://example.org/paper.pdf'}]),'');
});

test('paper resources classify verified research artifacts without duplicating references',()=>{
 const resources=m.paperResources([{title:'Official code repository',url:'https://github.com/org/project'},{title:'Training dataset',url:'https://zenodo.org/records/123'},{title:'Paper',url:'https://arxiv.org/abs/1234.5678'},{title:'Official code repository',url:'https://github.com/org/project'}]);
 assert.deepEqual(resources.map(x=>x.kind),['code','dataset']);
 assert.equal(resources.length,2);
});
