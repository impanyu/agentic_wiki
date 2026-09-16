import test from 'node:test';import assert from 'node:assert/strict';import ts from 'typescript';import {readFileSync} from 'node:fs';import {parse} from 'csv-parse/sync';import {deflateRawSync} from 'node:zlib';
globalThis.nativeParse=parse;
const load=async path=>import('data:text/javascript;base64,'+Buffer.from(ts.transpile(readFileSync(path,'utf8').replace(/^import .*;$/gm,'const parse=globalThis.nativeParse;'),{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
const data=await load('app/tools/data.ts'),geo=await load('app/geo/data.ts'),links=await load('app/tools/sources.ts');
test('tables preserve quoted cells, reject malformed records and neutralize spreadsheet formulas',()=>{
 const table=data.csvTable('name,value\r\n"a,b","line1\nline2"\r\nx,=HYPERLINK(""x"")'.replace('=HYPERLINK(""x"")','=1+1'));
 assert.deepEqual(table.rows[0],['a,b','line1\nline2']);assert.match(data.csvExport(table),/'=1\+1/);assert.throws(()=>data.csvTable('a,b\n1'));
 assert.deepEqual(data.jsonTable([{a:1},{b:{x:2}}]),{columns:['a','b'],rows:[['1',''],['','{"x":2}']]});assert.throws(()=>data.jsonTable([1]));
});
test('geographic inputs validate coordinates and reject non-geographic JSON',()=>{
 const points=geo.csvGeoJSON('name,latitude,longitude\n"a,b",42,-93');assert.deepEqual(points.features[0].geometry.coordinates,[-93,42]);
 for(const text of ['lat,lon\n,2','lat,lon\n100,2','lat,lon\nx,2'])assert.throws(()=>geo.csvGeoJSON(text));
 assert.throws(()=>geo.normalizeGeoJSON({data:[]}));assert.throws(()=>geo.normalizeGeoJSON({type:'Point',coordinates:[200,42]}));assert.throws(()=>geo.normalizeGeoJSON({type:'Point',coordinates:[0,0],crs:'EPSG:3857'}));
 assert.equal(geo.publicLayerUrl('https://example.org/data.geojson'),'https://example.org/data.geojson');for(const url of ['http://example.org','https://127.0.0.1/a','https://10.0.0.1/a','https://x.local/a','https://a:b@example.org/a','https://example.org/a?token=x'])assert.throws(()=>geo.publicLayerUrl(url));
});
function zipFixture(name='data.txt',text='hello',method=8){const raw=Buffer.from(text),compressed=method===8?deflateRawSync(raw):raw;let crc=0xffffffff;for(const b of raw){crc^=b;for(let j=0;j<8;j++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}crc=(crc^0xffffffff)>>>0;const n=Buffer.from(name),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(method,8);local.writeUInt16LE(n.length,26);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(method,10);central.writeUInt32LE(crc,16);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(raw.length,24);central.writeUInt16LE(n.length,28);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+n.length,12);end.writeUInt32LE(local.length+n.length+compressed.length,16);return Buffer.concat([local,n,compressed,central,n,end]);}
test('ZIP extraction verifies integrity and blocks dangerous paths and expansion',async()=>{
 for(const method of [0,8]){const bytes=zipFixture('data.txt','hello',method),[entry]=data.zipEntries(bytes);assert.equal(new TextDecoder().decode(await data.extractZip(bytes,entry)),'hello');await assert.rejects(()=>data.extractZip(bytes,{...entry,crc:0}),/checksum/);}
 assert.throws(()=>data.zipEntries(zipFixture('../escape')),/Unsafe/);assert.throws(()=>data.zipEntries(new Uint8Array([1,2,3])),/Invalid/);
 const bytes=zipFixture();const central=bytes.readUInt32LE(bytes.length-6);bytes.writeUInt32LE(11*1024*1024,central+24);assert.throws(()=>data.zipEntries(bytes),/limit/);
});
test('native app hyperlinks retain opaque source references without changing hosts',()=>{
 const source={page:'p',file:'f',connector:'c',name:'a & b.csv',language:'zh'};const u=new URL(links.toolHref('map',source),'https://wiki.aisoup.net');assert.equal(u.pathname,'/maps');for(const [k,v] of Object.entries(source))assert.equal(u.searchParams.get(k),v);assert.equal(new URL(links.toolHref('table',source),'https://wiki.aisoup.net').searchParams.get('app'),'table');
});
