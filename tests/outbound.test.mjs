import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import ts from 'typescript';
const out=new URL('../node_modules/.cache/outbound-test/',import.meta.url);mkdirSync(out,{recursive:true});
const load=async(f,name)=>{writeFileSync(new URL(name,out),ts.transpileModule(readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);return import(new URL(name,out));};
const {outboundLinks}=await load('app/seo/outbound.ts','outbound.mjs');

test('outbound links: the 1–3 a reader needs first, chosen by kind of entity; only web addresses',()=>{
 const country=outboundLinks({type:'country',attributes:{region:'Europe',wikipedia:'https://en.wikipedia.org/wiki/Germany',website:'https://www.deutschland.de/',lat:51,lon:10,note:'javascript:alert(1)'},ids:{wikidata:'Q183',iso3:'DEU'}});
 assert.deepEqual(country.map(x=>[x.label,x.host,x.primary]),[['Official website','deutschland.de',true],['Wikipedia','en.wikipedia.org',false],['Map','openstreetmap.org',false]]);
 const product=outboundLinks({type:'smartphone',attributes:{product_url:'https://www.apple.com/iphone-17/',buy_url:['https://www.amazon.com/dp/X','https://www.jd.com/1.html','https://www.amazon.com/dp/Y'],wikipedia:'https://en.wikipedia.org/wiki/IPhone_17'},ids:{}});
 assert.deepEqual(product.map(x=>x.label),['Product page','Wikipedia','Amazon'],'its own page, then Wikipedia, then a store');
 const person=outboundLinks({type:'football_player',attributes:{wikipedia:'https://en.wikipedia.org/wiki/X',instagram:'https://www.instagram.com/x/',website:'https://x.example/'},ids:{wikidata:'Q1'}});
 assert.deepEqual(person.map(x=>x.label),['Official website','Wikipedia','Instagram']);
 assert.deepEqual(outboundLinks({type:'city',attributes:{},ids:{wikidata:'Q64'}}).map(x=>x.href),['https://www.wikidata.org/wiki/Special:GoToLinkedPage/enwiki/Q64'],'a Wikidata id leads to the Wikipedia article');
 assert.deepEqual(outboundLinks({attributes:{},ids:{}}),[],'nothing at all and no name: nothing');
 // Identifiers name public pages: a researcher's OpenAlex and ORCID profiles.
 assert.deepEqual(outboundLinks({type:'researcher',name:'A B',attributes:{},ids:{openalex:'https://openalex.org/A123',orcid:'https://orcid.org/0000-0002-9322-3515'}}).map(x=>x.label),['OpenAlex profile','ORCID']);
 // Every named entity has at least one link: Wikipedia's search, which opens the article of that name.
 assert.deepEqual(outboundLinks({type:'gadget',name:'Widget X',attributes:{},ids:{}}).map(x=>x.href),['https://en.wikipedia.org/w/index.php?search=Widget%20X&go=Go']);
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

test('packed ranking rows expand back to exactly the rows (values rounded to 7 significant digits)',async()=>{
 const {packRows,unpackRows,isPacked}=await load('app/seo/pack-rows.ts','pack.mjs');
 const rows=[{entity_id:'a',name:'A',region:'X',period:'2020',pop:1,gdp:1.23456789},{entity_id:'a',name:'A',region:'X',period:'2021',pop:2},
  {entity_id:'b',name:'B',region:'Y',period:'2021',pop:3,gdp:4}];
 const p=packRows(rows);assert.ok(isPacked(p));assert.deepEqual([...p.keys].sort(),['gdp','period','pop']);assert.equal(p.entities.length,2);
 assert.deepEqual(unpackRows(p),[{entity_id:'a',name:'A',region:'X',period:'2020',pop:1,gdp:1.234568},{entity_id:'a',name:'A',region:'X',period:'2021',pop:2},{entity_id:'b',name:'B',region:'Y',period:'2021',pop:3,gdp:4}]);
});
