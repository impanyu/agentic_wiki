import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {readFileSync} from 'node:fs';import ts from 'typescript';
const load=async(source)=>import('data:text/javascript;base64,'+Buffer.from(ts.transpile(source,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
const sources=await load(readFileSync('app/tools/sources.ts','utf8').replace(/^import .*;$/gm,''));
globalThis.nativePageDeps={createHash,nativeApps:sources.nativeApps,zh:JSON.parse(readFileSync('app/i18n/zh-pairs.json','utf8')),pageAddress:(id,parameters)=>'/?'+new URLSearchParams({page:id,inputs:JSON.stringify(parameters)})};
const pages=await load('const {createHash,nativeApps,zh,pageAddress}=globalThis.nativePageDeps;\n'+readFileSync('app/tools/pages.ts','utf8').replace(/^import .*;$/gm,''));
test('built-in native pages have stable identities and correct registered templates',()=>{
 const hub=pages.nativePageDefinition('hub');assert.equal(hub.id,pages.nativePageDefinition('hub').id);assert.equal(pages.nativePageDefinition('unknown').id,hub.id);assert.equal(hub.config.nativeApp,'hub');assert.equal(hub.config.template,'native-app-v1');assert.notEqual(hub.id,pages.nativePageDefinition('map').id);assert.equal(pages.nativePageDefinition('map').labels.templateId,'geo-v1');assert.notEqual(hub.id,pages.nativePageDefinition('hub','zh').id);assert.equal(pages.nativePageDefinition('hub','zh').title,'原生应用');assert.equal(pages.nativePageDefinition('hub','bad/locale').language,'en');
});
test('source references survive native page navigation without becoming shared page data',()=>{
 const id=pages.nativePageDefinition('table').id,query={page:'source-page',file:'file-id',connector:'account-id',name:'points.csv',token:'not-allowed',app:'table'};
 const url=new URL(pages.nativePageAddress(id,query),'https://wiki.aisoup.net'),parameters=JSON.parse(url.searchParams.get('inputs'));
 assert.equal(url.searchParams.get('page'),id);assert.deepEqual(parameters,{sourcePage:'source-page',file:'file-id',connector:'account-id',name:'points.csv'});
 const source=sources.nativePageSource({id,language:'en',parameters});assert.deepEqual(source,{page:'source-page',file:'file-id',connector:'account-id',name:'points.csv',language:'en'});
 assert.equal(sources.nativePageSource({id,language:'en'}).page,id);assert.equal(pages.nativePageDefinition('table').config.sourcePage,undefined);
 assert.deepEqual(JSON.parse(new URL(pages.nativePageAddress(id,{page:['a','b'],file:'x'.repeat(201)}),'https://wiki.aisoup.net').searchParams.get('inputs')),{});
});

test('GIS links retain each repository identity and folders never open as maps',()=>{
 for(const space of ['page','adma','google','dropbox','onedrive']){
 const resource={space,id:'/folder/field.geojson',name:'field.geojson',kind:'file',...(space==='adma'?{connectorId:'account'}:{})};
 const url=new URL(sources.geoFileHref('context',resource,'en'),'https://wiki.aisoup.net');
 assert.equal(url.pathname,'/maps');assert.equal(url.searchParams.get('space'),space);assert.equal(url.searchParams.get('file'),resource.id);
 const parameters=JSON.parse(new URL(pages.nativePageAddress('map',Object.fromEntries(url.searchParams)),'https://wiki.aisoup.net').searchParams.get('inputs'));
 assert.equal(sources.nativePageSource({id:'map',parameters}).space,space);
 assert.equal(sources.geoFileHref('context',{...resource,kind:'folder'}),undefined);
 }
 assert.equal(sources.isGeoFile('FIELD.KML'),true);assert.equal(sources.isGeoFile('report.pdf'),false);
});
test('cloud GIS loading uses authenticated resource reads and surfaces access errors',async()=>{
 const original=globalThis.fetch;try{
 let requested;globalThis.fetch=async url=>{requested=url;return new Response('{"type":"FeatureCollection","features":[]}');};
 const file=await sources.readSourceFile({page:'p',file:'f',space:'dropbox',name:'field.geojson'});
 assert.equal(file.name,'field.geojson');assert.equal(JSON.parse(new URL(requested,'https://wiki.aisoup.net').searchParams.get('resource')).space,'dropbox');
 globalThis.fetch=async()=>new Response(JSON.stringify({error:'Enable read'}),{status:400});
 await assert.rejects(()=>sources.readSourceFile({page:'p',file:'f',space:'google'}),/Enable read/);
 }finally{globalThis.fetch=original;}
});
