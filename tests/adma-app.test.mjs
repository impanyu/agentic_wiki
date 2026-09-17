import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {z} from 'zod';
globalThis.admaZ=z;
const source=readFileSync('app/connectors/adapters.ts','utf8').replace(/^import .*;$/gm,'');
const {apiOperation,apiTools}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile('const z=globalThis.admaZ,processingTools=[];\n'+source,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
test('ADMA mutations match server routes, default private, and reject injected identifiers',()=>{
 const create=apiOperation('adma','create_folder',{name:'Research',parent_id:'parent-id'});
 assert.equal(create.method,'POST');assert.equal(new URL(create.url).pathname,'/api/v1/folders/create/');assert.deepEqual(create.body,{name:'Research',parent_id:'parent-id',is_public:false});
 for(const kind of ['file','folder']){const update=apiOperation('adma','update_'+kind,{id:'item-id',name:'New',is_public:true});assert.equal(update.method,'PATCH');assert.equal(new URL(update.url).pathname,`/api/v1/${kind}s/item-id/update/`);assert.equal(update.body.is_public,true);assert.equal(apiOperation('adma','delete_'+kind,{id:'item-id'}).method,'DELETE');assert.throws(()=>apiOperation('adma','delete_'+kind,{id:'../other'}));assert.throws(()=>apiOperation('adma','update_'+kind,{id:'item-id'}));assert.equal(apiTools.adma.find(t=>t.name==='delete_'+kind).annotations.readOnlyHint,false);}
 assert.equal(apiTools.adma.find(t=>t.name==='file_metadata').annotations.readOnlyHint,true);
 assert.throws(()=>apiOperation('adma','create_folder',{name:'Research',is_public:true}));
});

test('basic saved ADMA browsers adopt native UI while custom workflows retain their program',async()=>{
 const source=readFileSync('app/page-programs/deferred.ts','utf8').replace(/^import .*;$/gm,'');
 const {deferPageExecution}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile(source,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
 const page={question:'list my adma files',labels:{},dynamic:{template:'page-program-v1'}};
 assert.equal(deferPageExecution(page).dynamic.template,'file-browser-v1');
 assert.equal(deferPageExecution(page).runtimePending,false);
 assert.equal(deferPageExecution({...page,question:'Analyze rainfall in my ADMA files'}).dynamic.template,'page-program-v1');
 assert.equal(deferPageExecution({...page,question:'list my google drive files'}).dynamic.template,'file-browser-v1');
});

test('basic Google Drive dashboards reuse the native browser without changing custom analytics',async()=>{
 const source=readFileSync('app/page-programs/deferred.ts','utf8').replace(/^import .*;$/gm,'');
 const {deferPageExecution}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile(source,{module:ts.ModuleKind.ESNext})).toString('base64'));
 const page={id:'drive',question:'Google Drive dashboard',labels:{templateId:'dashboard-v1'},dynamic:{template:'page-program-v1'},runtimePending:true};
 const result=deferPageExecution(page,{search:'reports'});assert.equal(result.dynamic.template,'file-browser-v1');assert.equal(result.runtimePending,false);assert.equal(result.parameters.search,'reports');
 for(const question of ['ADMA + Google Drive dashboard','analyze spending in Google Drive','Google Drive dashboard with monthly revenue chart'])assert.equal(deferPageExecution({...page,question}).dynamic.template,'page-program-v1');
});
