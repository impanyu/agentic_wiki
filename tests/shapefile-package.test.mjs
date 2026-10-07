import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';import JSZip from 'jszip';
// Publishing a .shp or a folder packages the shapefile's companion files into one ZIP.
const files={'/data/roads.shp':'S','/data/roads.shx':'X','/data/roads.dbf':'D','/data/roads.prj':'P','/data/rivers.shp':'S2','/data/notes.txt':'N','/one/a.shp':'1','/one/a.shx':'2'};
const listing=dir=>Object.keys(files).filter(p=>p.slice(0,p.lastIndexOf('/'))===dir).map(p=>({space:'hcc',connectorId:'c',id:p,name:p.split('/').pop(),kind:'file'}));
globalThis.__shp={JSZip,browseResources:async(_p,_u,folder)=>({items:listing(folder.id),next:null}),readFile:async(_p,_u,r)=>({name:r.name,bytes:new TextEncoder().encode(files[r.id])}),listContextFiles:async()=>[]};
const m=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile('const {JSZip,browseResources,readFile,listContextFiles}=globalThis.__shp;\n'+readFileSync('app/arcgis-connector/shapefile.ts','utf8').replace(/^import .*;$/gm,''),{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
test('a .shp is zipped with its companion files from the same folder',async()=>{
 const out=await m.packageShapefile('p','u',{space:'hcc',connectorId:'c',id:'/data/roads.shp',name:'roads.shp',kind:'file'});
 assert.equal(out.name,'roads.zip');const zip=await JSZip.loadAsync(out.bytes);
 assert.deepEqual(Object.keys(zip.files).sort(),['roads.dbf','roads.prj','roads.shp','roads.shx']);
 assert.equal(await zip.file('roads.dbf').async('string'),'D');
});
test('folders and incomplete shapefiles are explained',async()=>{
 await assert.rejects(()=>m.packageShapefile('p','u',{space:'hcc',connectorId:'c',id:'/data',name:'data',kind:'folder'}),/several shapefiles/);
 await assert.rejects(()=>m.packageShapefile('p','u',{space:'hcc',connectorId:'c',id:'/one/a.shp',name:'a.shp',kind:'file'}),/\.dbf is missing/);
 await assert.rejects(()=>m.packageShapefile('p','u',{space:'google',id:'x',name:'a.shp',kind:'file'}),/choose the folder/);
 assert.equal(m.needsPackaging({name:'a.geojson',kind:'file'}),false);assert.equal(m.needsPackaging({name:'a.SHP',kind:'file'}),true);
});
