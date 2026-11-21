import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';import ts from 'typescript';
// Declarative field extraction (app/data-tools/extract-fields.ts) on a sample page; network modules stubbed.
const out=new URL('../node_modules/.cache/extract-fields-test/',import.meta.url);mkdirSync(out,{recursive:true});
writeFileSync(new URL('stub.mjs',out),'export const fetchText=()=>{throw Error("no network")};export const publicUrl=u=>new URL(u);export const saveDataset=async()=>({});export const loadDataset=async()=>({columns:[],rows:[]});export const linkMatcher=p=>u=>u.includes(p);');
let js=ts.transpileModule(readFileSync('app/data-tools/extract-fields.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
js=js.replace(/from\s*'\.\/(net|datasets|robots)'/g,"from './stub.mjs'");writeFileSync(new URL('extract-fields.mjs',out),js);
const m=await import(new URL('extract-fields.mjs',out));
const html=`<html><head><title>Chanel No 5 – Perfumes</title>
<meta property="og:title" content="Chanel No 5"><meta name="description" content="A floral aldehyde.">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Product","name":"Chanel N°5","brand":{"@type":"Brand","name":"Chanel"},
 "aggregateRating":{"@type":"AggregateRating","ratingValue":"4.21","ratingCount":"21,503"},"offers":[{"@type":"Offer","price":"135.00","priceCurrency":"USD"},{"@type":"Offer","price":"98"}]},{"@type":"BreadcrumbList","itemListElement":[]}]}</script>
<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"perfume":{"year":1921,"notes":{"top":["Aldehydes","Neroli"]}}}}}</script>
<script>window.__STATE__ = {"stock":{"inStock":true,"label":"In {stock}"}};</script>
</head><body><h1 class="pf-title">Chanel N°5</h1>
<span itemprop="ratingValue" content="4.2">4.2 / 5</span>
<dl><dt>Perfumer</dt><dd class="perfumer"><a href="/noses/ernest-beaux">Ernest Beaux</a></dd><dt>Size</dt><dd class="size">100 ml</dd></dl>
<ul class="notes"><li><a href="/notes/rose">Rose</a></li><li><a href="/notes/jasmine">Jasmine</a></li></ul>
<a href="/perfume/chanel/coco-1.html">Coco</a><a href="/perfume/chanel/allure-2.html">Allure</a><a href="/news/x">x</a></body></html>`;
const p=m.readPage('https://fragrances.example/perfume/chanel/no5-40.html',html);
test('rules: jsonld (with @graph, nested, arrays), microdata, meta, embedded json and window state, css text/attr/all, regex, numbers',()=>{
 const f=m.parseFields(JSON.stringify({name:'jsonld:Product.name',brand:'jsonld:Product.brand.name',rating:{jsonld:'Product.aggregateRating.ratingValue',number:true},
  votes:{jsonld:'Product.aggregateRating.ratingCount',number:true},prices:{jsonld:'Product.offers.price',all:true},md:'microdata:ratingValue',og:'meta:og:title',
  year:'json:__NEXT_DATA__.props.pageProps.perfume.year',top:{json:'__NEXT_DATA__.props.pageProps.perfume.notes.top',all:true,join:', '},stock:'json:__STATE__.stock.inStock',
  title:'css:h1.pf-title',perfumerUrl:'css:dd.perfumer a@href',notes:{css:'.notes a',all:true},ml:{css:'dd.size',regex:'(\\d+) ?ml',number:true},missing:{css:'.nope',default:'n/a'}}));
 const row=Object.fromEntries(Object.entries(f).map(([k,r])=>[k,m.extractField(p,r)]));
 assert.deepEqual(row,{name:'Chanel N°5',brand:'Chanel',rating:4.21,votes:21503,prices:'135.00; 98',md:'4.2',og:'Chanel No 5',year:1921,top:'Aldehydes, Neroli',stock:true,
  title:'Chanel N°5',perfumerUrl:'https://fragrances.example/noses/ernest-beaux',notes:'Rose; Jasmine',ml:100,missing:'n/a'});
});
test('bad rules are rejected with a clear message',()=>{
 assert.throws(()=>m.parseRule('xpath://h1'),/A field rule is/);assert.throws(()=>m.parseRule({attr:'href'}),/names one of/);
 assert.throws(()=>m.parseFields('{"bad name":"css:h1"}'),/identifiers/);assert.throws(()=>m.parseRule({css:'a',regex:'('}),/Invalid regex/);
});
test('numbers in many notations',()=>{
 assert.equal(m.numberOf('21,503'),21503);assert.equal(m.numberOf('1.234,5'),1234.5);assert.equal(m.numberOf('€ 98,00'),98);assert.equal(m.numberOf('$1,200.50'),1200.5);assert.equal(m.numberOf('4.2 / 5'),4.2);assert.equal(m.numberOf('n/a'),null);
});
test('inspect_page lists ready rules, label/value pairs with selectors, and link patterns',()=>{
 const r=m.inspectPage(p);
 assert.ok(r.jsonld.find(x=>x.type==='Product').fields.some(f=>f.rule==='jsonld:Product.aggregateRating.ratingValue'&&f.value==='4.21'));
 assert.ok(r.embedded.some(f=>f.rule==='json:__NEXT_DATA__.props.pageProps.perfume.year'));
 assert.ok(r.labelled.some(x=>x.label==='Perfumer'&&x.rule==='css:dd.perfumer'&&x.value==='Ernest Beaux'));
 assert.ok(r.links.some(l=>l.linkPattern==='/perfume/chanel/'&&l.count===2));
 assert.ok(r.meta.some(x=>x.rule==='meta:og:title'));
});
