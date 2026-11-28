import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';import {pathToFileURL} from 'node:url';import ts from 'typescript';
// The Sources layer: request outcomes per host (health), the register's status and access route (registry), and the
// automatic headless rendering of JavaScript-built pages (page-load).
const dir='node_modules/.cache/sources-layer-test';mkdirSync(dir,{recursive:true});
const emit=(f,out,fix=s=>s)=>writeFileSync(dir+'/'+out,fix(ts.transpile(readFileSync(f,'utf8'),{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})));
emit('app/sources/health.ts','health.mjs');
emit('app/sources/registry.ts','registry.mjs',s=>s.replace("from './health'","from './health.mjs'"));
emit('app/data-tools/page-load.ts','page-load.mjs',s=>s.replace(/import \{ ?sourceText ?\} from '@\/app\/url-content\/fetch';/,"const sourceText=h=>h.replace(/<script[\\s\\S]*?<\\/script>/gi,' ').replace(/<[^>]+>/g,' ');"));
const h=await import(pathToFileURL(dir+'/health.mjs').href),r=await import(pathToFileURL(dir+'/registry.mjs').href),p=await import(pathToFileURL(dir+'/page-load.mjs').href);
test('request outcomes by HTTP status and host',()=>{
 assert.equal(h.outcomeOf(200),'ok');assert.equal(h.outcomeOf(403),'denied');assert.equal(h.outcomeOf(401),'denied');
 assert.equal(h.outcomeOf(429),'limited');assert.equal(h.outcomeOf(500),'failed');assert.equal(h.outcomeOf(null),'failed');
 assert.equal(h.hostOf('https://www.Example.org/a?b=1'),'example.org');assert.equal(h.hostOf('nope'),'');
});
test('source status over 7 days',()=>{
 const s=(c,ok,d,l,f,rec=0,fail=0)=>r.statusOf({calls7:c,ok7:ok,denied7:d,limited7:l,failed7:f},rec,fail);
 assert.equal(s(10,9,1,0,0),'ok');assert.equal(s(10,2,8,0,0),'blocked');assert.equal(s(10,3,0,7,0),'limited');
 assert.equal(s(10,2,0,0,8),'down');assert.equal(s(10,5,2,0,3),'degraded');assert.equal(s(0,0,0,0,0,2,2),'failing');
 assert.equal(s(0,0,0,0,0,2,0),'idle');assert.equal(s(10,9,1,0,0,3,3),'failing');
});
test('access route of a source',()=>{
 assert.equal(r.accessOf('call_public_source',''),'api');
 assert.equal(r.accessOf('fetch_data','https://example.org/data/all.csv'),'bulk');
 assert.equal(r.accessOf('fetch_data','https://api.example.org/v2/items?format=json'),'api');
 assert.equal(r.accessOf('extract_tables','https://en.wikipedia.org/wiki/List'),'page');
 assert.equal(r.accessOf('extract_fields','https://shop.example/p/1',true),'render');
 assert.equal(r.accessOf('fetch_data','https://web.archive.org/web/2024/https://x.org'),'archive');
});
test('JavaScript-built pages are recognised as shells',()=>{
 assert.equal(p.jsShell('<html><body><div id="root"></div><script src=a.js></script></body></html>'),true);
 assert.equal(p.jsShell('<html><body><noscript>You need to enable JavaScript to run this app.</noscript><div id="x"></div><script></script></body></html>'),true);
 assert.equal(p.jsShell('<html><body><script></script><script></script><script></script><p>Loading</p></body></html>'),true);
 assert.equal(p.jsShell('<html><body><table>'+'<tr><td>Row with some words in it</td><td>123</td></tr>'.repeat(120)+'</table><script></script></body></html>'),false);
 assert.equal(p.jsShell(''),false);
 p.rememberRender('https://spa.example/x');assert.equal(p.hostNeedsRender('https://spa.example/other'),true);assert.equal(p.hostNeedsRender('https://plain.example/'),false);
});
