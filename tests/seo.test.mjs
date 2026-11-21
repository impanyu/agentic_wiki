import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';import ts from 'typescript';
// Canonical page addresses (/p/<id>/<slug>) and /?ask= link parsing used by the crawlable pages.
const out=new URL('../node_modules/.cache/seo-test/',import.meta.url);mkdirSync(out,{recursive:true});
writeFileSync(new URL('urls.mjs',out),ts.transpileModule(readFileSync(new URL('../app/seo/urls.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
const u=await import(new URL('urls.mjs',out));
test('slugs: readable, stable, unicode kept',()=>{
 assert.equal(u.slugify('U.S. State Rankings'),'u-s-state-rankings');
 assert.equal(u.slugify("Côte d'Ivoire"),'côte-divoire');
 assert.equal(u.slugify('国家排行榜'),'国家排行榜');
 assert.equal(u.slugify('  --  '),'page');
 assert.ok(u.slugify('x'.repeat(300)).length<=90);
 assert.equal(u.pagePath('abc','Chanel No. 5'),'/p/abc/chanel-no-5');
});
test('ask links: parsed from site links only; question keys ignore case and spacing',()=>{
 assert.equal(u.askOf('/?ask=Country%20Rankings'),'Country Rankings');
 assert.equal(u.askOf('/?ask=a+b&rank=x'),'a b');
 assert.equal(u.askOf('https://example.com/?ask=x'),null);
 assert.equal(u.askOf('/?ask='),null);
 assert.equal(u.questionKey('  Country   RANKINGS '),u.questionKey('country rankings'));
});
