import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';
// Pure helpers behind the diagram/math/code/compare/carousel components.
const m=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile(readFileSync('app/workflows/viz/rich-helpers.ts','utf8'),{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));

test('image URLs must be https or same-site paths',()=>{
 assert.equal(m.safeImageUrl('https://example.org/a.png'),'https://example.org/a.png');
 assert.equal(m.safeImageUrl(' /api/files/x.png '),'/api/files/x.png');
 for(const bad of ['http://example.org/a.png','//evil.com/a.png','/\\evil.com','javascript:alert(1)','data:image/png;base64,AA','',null,42,{src:'/a'}])assert.equal(m.safeImageUrl(bad),null,String(bad));
});

test('percentages are clamped with a fallback',()=>{
 assert.equal(m.clampPercent(30,50),30);assert.equal(m.clampPercent('75',50),75);
 assert.equal(m.clampPercent(-4,50),0);assert.equal(m.clampPercent(140,50),100);
 for(const bad of [undefined,null,'',' ','abc',NaN,Infinity,{}])assert.equal(m.clampPercent(bad,50),50);
 assert.equal(m.positiveNumber('420',1),420);assert.equal(m.positiveNumber(-3,1),1);assert.equal(m.positiveNumber('x',7),7);
});

test('slide indexes wrap around',()=>{
 assert.equal(m.wrapIndex(-1,4),3);assert.equal(m.wrapIndex(4,4),0);assert.equal(m.wrapIndex(9,4),1);assert.equal(m.wrapIndex(2,0),0);
});

test('carousel items are normalized and unsafe ones dropped',()=>{
 assert.deepEqual(m.normalizeSlides(['/a.png',{src:'https://x.org/b.jpg',caption:'B',credit:'  '},{src:'http://x.org/c.jpg'},{url:'/d.png',credit:'NASA'},null,7]),
  [{src:'/a.png'},{src:'https://x.org/b.jpg',caption:'B'},{src:'/d.png',credit:'NASA'}]);
 assert.deepEqual(m.normalizeSlides({src:'/one.png'}),[{src:'/one.png'}]);
 assert.deepEqual(m.normalizeSlides(undefined),[]);
});

test('highlight line lists accept numbers, strings and ranges',()=>{
 assert.deepEqual([...m.lineSet([1,'3','5-7','x',' 9 '])].sort((a,b)=>a-b),[1,3,5,6,7,9]);
 assert.equal(m.lineSet(undefined).size,0);assert.deepEqual([...m.lineSet(4)],[4]);
});

test('highlighted HTML splits into well-formed lines',()=>{
 const html='<span class="hljs-comment">/* a\nb */</span> x\n<span class="hljs-string">&quot;s&quot;</span>';
 assert.deepEqual(m.splitHighlightedLines(html),[
  '<span class="hljs-comment">/* a</span>',
  '<span class="hljs-comment">b */</span> x',
  '<span class="hljs-string">&quot;s&quot;</span>']);
 assert.deepEqual(m.splitHighlightedLines('a\n\nb'),['a','','b']);
 const nested=m.splitHighlightedLines('<span class="a"><span class="b">1\n2</span>3</span>');
 assert.deepEqual(nested,['<span class="a"><span class="b">1</span></span>','<span class="a"><span class="b">2</span>3</span>']);
});
