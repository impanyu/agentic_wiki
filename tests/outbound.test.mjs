import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import ts from 'typescript';
const out=new URL('../node_modules/.cache/outbound-test/',import.meta.url);mkdirSync(out,{recursive:true});
const load=async(f,name)=>{writeFileSync(new URL(name,out),ts.transpileModule(readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);return import(new URL(name,out));};
const {outboundLinks}=await load('app/seo/outbound.ts','outbound.mjs');

test('outbound links: official site and purchase page first, then reference works; only web addresses',()=>{
 const l=outboundLinks({attributes:{region:'Europe',wikipedia:'https://en.wikipedia.org/wiki/Germany',website:'https://www.deutschland.de/',buy_url:'https://store.example.com/p/1',note:'javascript:alert(1)'},ids:{wikidata:'Q183',iso3:'DEU'}});
 assert.deepEqual(l.map(x=>[x.label,x.host,x.primary]),[['Official website','deutschland.de',true],['Buy','store.example.com',true],['Wikipedia','en.wikipedia.org',false],['Wikidata','wikidata.org',false]]);
 assert.deepEqual(outboundLinks({attributes:{},ids:{}}),[]);
});

test('source text links: dataset codes to their public pages, API addresses to the dataset site',async()=>{
 const src=readFileSync('app/workflows/viz/ranking-data.ts','utf8');
 const fn=src.slice(src.indexOf('// Known datasets named in source text'),src.indexOf('\n}\n',src.indexOf('export function linkParts'))+3);
 const {linkParts}=await (async()=>{writeFileSync(new URL('lp.mjs',out),ts.transpileModule(fn.replace('export function linkParts','export function linkParts'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);return import(new URL('lp.mjs',out));})();
 const p=linkParts('World Bank WDI SP.POP.TOTL; flags https://flagcdn.com.');
 assert.deepEqual(p.filter(x=>x.href).map(x=>[x.text,x.href]),[['World Bank WDI SP.POP.TOTL','https://data.worldbank.org/indicator/SP.POP.TOTL'],['https://flagcdn.com','https://flagcdn.com']]);
 assert.equal(p.map(x=>x.text).join(''),'World Bank WDI SP.POP.TOTL; flags https://flagcdn.com.','text is unchanged');
 assert.equal(linkParts('https://api.worldbank.org/v2/country')[0].href,'https://data.worldbank.org/country');
 assert.equal(linkParts('derived from World Bank WDI (GDP ÷ population)').find(x=>x.href).href,'https://databank.worldbank.org/source/world-development-indicators');
});
