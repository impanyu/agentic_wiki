import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';import ts from 'typescript';
// The collectors' world directory of public data sources: well-formed, and findSources matches by subject and
// country (codes exactly, names by substring, worldwide sources everywhere).
const out=new URL('../node_modules/.cache/source-dir-test/',import.meta.url);mkdirSync(out,{recursive:true});
const dir=new URL('../app/public-data/directory.json',import.meta.url).pathname;
let js=ts.transpileModule(readFileSync(new URL('../app/teams/sources.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
js=js.replace("import('@/app/public-data/directory.json')",`import(${JSON.stringify(dir)},{with:{type:'json'}})`).replace(/import \{\s*webSearch\s*\}[^\n]*\n/,'const webSearch=null;\n');
writeFileSync(new URL('sources.mjs',out),js);
const m=await import(new URL('sources.mjs',out));
const entries=JSON.parse(readFileSync(dir,'utf8'));

test('directory entries are well formed and unique',()=>{
 assert.ok(entries.length>=300);
 const ids=new Set();for(const e of entries){assert.match(e.id,/^[a-z0-9][a-z0-9._-]*$/);assert.ok(!ids.has(e.id),e.id);ids.add(e.id);assert.ok(e.name&&e.url&&/^https?:\/\//.test(e.url),e.id);assert.ok(Array.isArray(e.countries)&&e.countries.length,e.id);}
});
test('findSources: local sources for a country code, not substring accidents',async()=>{
 const r=await m.findSources('tractor sales','IN');
 assert.ok(r.sources.some(s=>/SIAM|VAHAN|Tractor/i.test(s.name)),r.sources.map(s=>s.name).join('; '));
 assert.ok(!r.sources.some(s=>/\(UK\)|SMMT/.test(s.name)),'UK sources must not match IN');
 const jp=await m.findSources('drug','JP');assert.ok(jp.sources.some(s=>/PMDA/.test(s.name)));
 const ng=await m.findSources('statistics','Nigeria');assert.ok(ng.sources.some(s=>/Nigeria/i.test(s.name+s.scope)));
});
