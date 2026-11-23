import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';import ts from 'typescript';
// Model extraction (app/data-tools/llm-extract.ts): the program, not the model, decides what is kept.
const cheerio=pathToFileURL(createRequire(import.meta.url).resolve('cheerio')).href;
const load=async(file,prelude)=>import('data:text/javascript;base64,'+Buffer.from(prelude+ts.transpile(readFileSync(file,'utf8').replace(/^import .*;$/gm,''),{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
const ef=await load('app/data-tools/extract-fields.ts',`import {load} from '${cheerio}';\n`);
globalThis.__numberOf=ef.numberOf;
const m=await load('app/data-tools/llm-extract.ts',`import {load} from '${cheerio}';import {createHash} from 'node:crypto';const numberOf=globalThis.__numberOf;\n`);

const page=`Tsinghua University was established in 1911 in Beijing.
It enrolls about 53,302 students. In 2023 its research income reached 5.2 billion yuan.
清华大学现有在校生约5.3万人。`;
test('a value is kept only when its quoted passage is in the page and states that value',()=>{
 const n={type:'number',description:'research income in 2023'},y={type:'year',description:'founding year'},s={type:'string',description:'city of the campus'};
 assert.deepEqual(m.verify(n,{value:5.2,scale:'billion',unit:'yuan',quote:'its research income reached 5.2 billion yuan'},page),{ok:true,value:5.2e9,unit:'yuan',quote:'its research income reached 5.2 billion yuan'});
 assert.equal(m.verify({type:'integer',description:'students'},{value:53302,scale:'',unit:'',quote:'enrolls about 53,302 students'},page).value,53302);
 assert.equal(m.verify({type:'number',description:'students (zh)'},{value:5.3,scale:'万',unit:'人',quote:'在校生约5.3万人'},page).value,53000);
 assert.equal(m.verify(y,{value:1911,quote:'was established in 1911 in Beijing'},page).value,1911);
 assert.equal(m.verify(s,{value:'Beijing',quote:'established in 1911 in Beijing'},page).value,'Beijing');
 // Invented, altered or unsupported values are rejected.
 assert.equal(m.verify(n,{value:6.1,scale:'billion',unit:'yuan',quote:'its research income reached 5.2 billion yuan'},page).reason,'number not in the quote');
 assert.equal(m.verify(n,{value:5.2,scale:'billion',unit:'yuan',quote:'research income reached 5.2 billion yuan in 2024'},page).reason,'quote not in the page');
 assert.equal(m.verify(n,{value:5.2,scale:'million',unit:'yuan',quote:'its research income reached 5.2 billion yuan'},page).reason,'scale word not in the quote');
 assert.equal(m.verify(y,{value:1912,quote:'was established in 1911 in Beijing'},page).reason,'year not in the quote');
 assert.equal(m.verify(s,{value:'Shanghai',quote:'established in 1911 in Beijing'},page).reason,'value not in the quote');
 assert.equal(m.verify(n,{value:5.2,scale:'',unit:'',quote:''},page).reason,'no quote');
 assert.equal(m.verify(n,{value:null,quote:''},page),null);
 // Typography differences between the page and the copy do not matter.
 assert.equal(m.verify(y,{value:1911,quote:'Tsinghua  University was\nestablished in 1911'},page).ok,true);
});
test('pages become readable text without navigation, and long text is read in chunks',()=>{
 const t=m.readableText(`<html><body><nav>Home | About</nav><main><h1>Tsinghua</h1><p>Founded in <b>1911</b>.</p><script>x=1</script><table><tr><th>Students</th><td>53,302</td></tr></table>${'<p>filler text for length. </p>'.repeat(20)}</main><footer>© site</footer></body></html>`);
 assert.match(t,/Founded in 1911\./);assert.match(t,/Students \| 53,302/);assert.doesNotMatch(t,/Home \| About|x=1|© site/);
 const c=m.chunks(Array.from({length:100},(_,i)=>'line '+i+' '+'x'.repeat(50)).join('\n'),1000,3);
 assert.equal(c.length,3);assert.ok(c.every(x=>x.length<=1000));assert.match(c[1],/^line \d+ /);
});
test('a document is read chunk by chunk until every field is found; rejected reads are reported',async()=>{
 const spec={founded:{type:'year',description:'founding year'},students:{type:'integer',description:'students'}};
 const asked=[];
 const reader=async(text,subject,fields)=>{asked.push(Object.keys(fields));
  if(text.includes('1911'))return {model:'pool:local',cached:false,fields:{founded:{value:1911,scale:'',unit:'',quote:'established in 1911'},students:{value:99999,scale:'',unit:'',quote:'established in 1911'}}};
  return {model:'pool:local',cached:true,fields:{students:{value:53302,scale:'',unit:'',quote:'about 53,302 students'}}};};
 const text='Tsinghua was established in 1911.\n'+'filler '.repeat(2000)+'\nIt has about 53,302 students.';
 const r=await m.extractDocument(text,'the university',spec,reader,AbortSignal.timeout(5000));
 assert.equal(r.found.founded.value,1911);assert.equal(r.found.students.value,53302);
 assert.deepEqual(asked,[['founded','students'],['students'],['students']]);assert.deepEqual(r.rejected,{});assert.equal(r.calls,1);assert.equal(r.cached,2);
 const bad=await m.extractDocument('Tsinghua was established in 1911.','the university',spec,reader,AbortSignal.timeout(5000));
 assert.equal(bad.found.students,undefined);assert.equal(bad.rejected.students,'number not in the quote');
});
test('field specs must say exactly what to read',()=>{
 assert.throws(()=>m.parseSpec('{"x":{"type":"number","description":"rev"}}'),/describe exactly/);
 assert.throws(()=>m.parseSpec('{"x":{"type":"money","description":"revenue in 2023"}}'),/type is one of/);
 assert.deepEqual(m.parseSpec({rev:{type:'number',description:'revenue in 2023',unit:'USD'}}),{rev:{type:'number',description:'revenue in 2023',unit:'USD'}});
 assert.notEqual(m.cacheKey('a','s',{}),m.cacheKey('b','s',{}));
});
