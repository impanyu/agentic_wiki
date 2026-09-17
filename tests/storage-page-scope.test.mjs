import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const catalog=readFileSync('app/connectors/catalog.ts','utf8');
const source=catalog+'\n'+"const providers=['google','dropbox','onedrive'];\n"+readFileSync('app/storage/page-scope.ts','utf8').replace(/^import .*;$/gm,'');
const {pageStorageProviders,storagePageMismatch,nativeWorkspaceApp}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile(source,{module:ts.ModuleKind.ESNext})).toString('base64'));
test('named storage pages stay focused, while multi-provider tasks retain requested services',()=>{
 assert.deepEqual(pageStorageProviders('list my google drive'),['google']);
 assert.deepEqual(pageStorageProviders('list my adma files'),[]);
 assert.deepEqual(pageStorageProviders('list my Notion files'),[]);
 assert.deepEqual(pageStorageProviders('列出谷歌云盘文件'),['google']);
 assert.deepEqual(pageStorageProviders('copy from Google Drive to Dropbox'),['google','dropbox']);
 assert.deepEqual(pageStorageProviders('browse files',{provider:'onedrive'}),['onedrive']);
 assert.deepEqual(pageStorageProviders('list my google drive',{provider:'dropbox'}),['google']);
});

test('rejects cross-service reuse and unsupported saved file browsers',()=>{assert.equal(storagePageMismatch('list my adma files',{question:'list my google drive',title:'Drive'}),true);assert.equal(storagePageMismatch('list my adma files',{question:'list my adma files',title:'ADMA',dynamic:{template:'file-browser-v1'}}),false);assert.equal(storagePageMismatch('list my google drive',{question:'list my google drive',title:'Drive',dynamic:{template:'file-browser-v1'}}),false);});

test('analytical output requests cannot reuse storage browsers, including old ADMA programs',()=>{
 const query='the temperature plot 9/1/2026 on adma realm5';
 for(const template of ['file-browser-v1','page-program-v1','agent-chat-v1'])assert.equal(storagePageMismatch(query,{question:'list my adma files',title:'ADMA',dynamic:{template}}),true);
 assert.equal(storagePageMismatch('分析谷歌云盘的数据并绘图',{title:'Drive',dynamic:{template:'file-browser-v1'}}),true);
 assert.equal(storagePageMismatch(query,{question:query,title:'Realm5 temperature',dynamic:{template:'component-chart-v1'}}),false);
 assert.equal(storagePageMismatch(query,{question:query,title:'Realm5 temperature',dynamic:{template:'page-program-v1'}}),false);
 assert.equal(storagePageMismatch('browse realm5 folders on adma',{question:'list my adma files',title:'ADMA',dynamic:{template:'file-browser-v1'}}),false);
});

test('ADMA and Google names cannot override a chart, custom app, or chat renderer',()=>{
 for(const question of ['temperature plot on ADMA Realm5','chart my Google Drive data']){
  for(const template of ['component-chart-v1','page-program-v1','agent-chat-v1','component-form-v1'])assert.equal(nativeWorkspaceApp({kind:'dynamic',question,title:question,dynamic:{template}}),null);
 }
 assert.equal(nativeWorkspaceApp({kind:'dynamic',question:'list my ADMA files',title:'Files',dynamic:{template:'file-browser-v1'}}),'adma');
 assert.equal(nativeWorkspaceApp({kind:'dynamic',question:'list my Google Drive files',title:'Files',dynamic:{template:'file-browser-v1'}}),'drive');
});

test('location map requests cannot reuse a generic connector file browser',()=>{
 for(const question of ['map ADMA Realm5 locations','画出adma上realm5数据的位置','John Deere农场的地图'])assert.equal(storagePageMismatch(question,{question:'list my adma files',title:'Files',dynamic:{template:'file-browser-v1'}}),true);
});
