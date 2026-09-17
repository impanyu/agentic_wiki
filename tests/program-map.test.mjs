import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';import {z} from 'zod';
const strip=p=>readFileSync(p,'utf8').replace(/^import .*;$/gm,'');
const load=async s=>import('data:text/javascript;base64,'+Buffer.from(ts.transpile(s,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
globalThis.mapZ=z;
const geo=await load(strip('app/geo/data.ts'));globalThis.mapNormalize=geo.normalizeGeoJSON;
const {viewSchema}=await load('const z=globalThis.mapZ,normalizeGeoJSON=globalThis.mapNormalize,formSchema=z.unknown(),chartSchema=z.unknown();'+strip('app/page-programs/contracts.ts'));
const feature={type:'Feature',geometry:{type:'Point',coordinates:[-93.6,42.0]},properties:{name:'Fixture station',source:'Connector fixture'}};
const view={templateId:'dashboard-v1',title:'Locations',summary:'Authorized fixture',map:{title:'Stations',geojson:{type:'FeatureCollection',features:[feature]}}};
test('program maps retain connector coordinates and attributes alongside other UI',()=>{
 const result=viewSchema.parse({...view,results:{stations:1}});assert.deepEqual(result.map.geojson.features[0],feature);assert.equal(result.results.stations,1);
 const polygon={...feature,geometry:{type:'Polygon',coordinates:[[[-93,42],[-92,42],[-92,43],[-93,42]]]}};
 assert.equal(viewSchema.parse({...view,map:{title:'Fields',geojson:{type:'FeatureCollection',features:[polygon]}}}).map.geojson.features[0].geometry.type,'Polygon');
});
test('program maps reject missing, invalid and non-WGS84 geometry',()=>{
 for(const geojson of [{type:'FeatureCollection',features:[]},{...feature,geometry:{type:'Point',coordinates:[200,42]}},{...feature,crs:{name:'EPSG:3857'}}])assert.equal(viewSchema.safeParse({...view,map:{title:'Invalid',geojson}}).success,false);
});
