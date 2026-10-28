import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const catalog=readFileSync('app/connectors/catalog.ts','utf8');
const source=catalog+'\n'+"const providers=['google','dropbox','onedrive'];\n"+readFileSync('app/storage/page-scope.ts','utf8').replace(/^import .*;$/gm,'');
const {pageStorageProviders,storagePageMismatch,nativeWorkspaceApp}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile(source,{module:ts.ModuleKind.ESNext})).toString('base64'));
test('named storage pages stay focused, while multi-provider tasks retain requested services',()=>{
 assert.deepEqual(pageStorageProviders('list my google drive'),['google']);
 assert.deepEqual(pageStorageProviders('list my Slack messages'),[]);
 assert.deepEqual(pageStorageProviders('list my Notion files'),[]);
 assert.deepEqual(pageStorageProviders('列出谷歌云盘文件'),['google']);
 assert.deepEqual(pageStorageProviders('copy from Google Drive to Dropbox'),['google','dropbox']);
 assert.deepEqual(pageStorageProviders('browse files',{provider:'onedrive'}),['onedrive']);
 assert.deepEqual(pageStorageProviders('list my google drive',{provider:'dropbox'}),['google']);
});

test('rejects cross-service reuse and unsupported saved file browsers',()=>{assert.equal(storagePageMismatch('list my dropbox files',{question:'list my google drive',title:'Drive'}),true);assert.equal(storagePageMismatch('list my dropbox files',{question:'list my dropbox files',title:'Dropbox',dynamic:{template:'file-browser-v1'}}),false);assert.equal(storagePageMismatch('list my google drive',{question:'list my google drive',title:'Drive',dynamic:{template:'file-browser-v1'}}),false);assert.equal(storagePageMismatch('list my notion pages',{question:'list my notion pages',title:'Notion',dynamic:{template:'file-browser-v1'}}),true);});

test('analytical output requests cannot reuse storage browsers',()=>{
 const query='the temperature plot 9/1/2026 from my dropbox weather csv';
 for(const template of ['file-browser-v1','agent-chat-v1'])assert.equal(storagePageMismatch(query,{question:'list my dropbox files',title:'Dropbox',dynamic:{template}}),true);
 assert.equal(storagePageMismatch('分析谷歌云盘的数据并绘图',{title:'Drive',dynamic:{template:'file-browser-v1'}}),true);
 assert.equal(storagePageMismatch(query,{question:query,title:'Temperature',dynamic:{template:'component-chart-v1'}}),false);
 assert.equal(storagePageMismatch(query,{question:query,title:'Temperature',dynamic:{template:'page-program-v1'}}),false);
 assert.equal(storagePageMismatch('browse weather folders on dropbox',{question:'list my dropbox files',title:'Dropbox',dynamic:{template:'file-browser-v1'}}),false);
});

test('storage names cannot override a chart, custom app, or chat renderer',()=>{
 for(const question of ['temperature plot from my Dropbox csv','chart my Google Drive data']){
  for(const template of ['component-chart-v1','page-program-v1','agent-chat-v1','component-form-v1'])assert.equal(nativeWorkspaceApp({kind:'dynamic',question,title:question,dynamic:{template}}),null);
 }
 assert.equal(nativeWorkspaceApp({kind:'dynamic',question:'list my Dropbox files',title:'Files',dynamic:{template:'file-browser-v1'}}),null);
 assert.equal(nativeWorkspaceApp({kind:'dynamic',question:'list my Google Drive files',title:'Files',dynamic:{template:'file-browser-v1'}}),'drive');
});

test('location map requests cannot reuse a generic connector file browser',()=>{
 for(const question of ['map Dropbox station locations','画出dropbox上气象站数据的位置','John Deere农场的地图'])assert.equal(storagePageMismatch(question,{question:'list my dropbox files',title:'Files',dynamic:{template:'file-browser-v1'}}),true);
});

test('explicit combined repository requests cannot reuse an index offering separate services',()=>{
 const index={question:'dropbox dashboard and my google drive',title:'Dropbox and Google Drive',kind:'static',labels:{templateId:'disambiguation-v1'}};
 assert.equal(storagePageMismatch('Create a combined Dropbox and Google Drive dashboard',index),true);
 assert.equal(storagePageMismatch('Use both Dropbox and Google Drive',index),true);
 assert.equal(storagePageMismatch('Create a combined Dropbox and Google Drive dashboard',{...index,labels:{},dynamic:{template:'file-browser-v1'}}),false);
});
