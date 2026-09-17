import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';
const source=readFileSync('app/context-files/upload.ts','utf8').replace(/^import .*;$/gm,'');
const {uploadPageFiles}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile(source,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
test('chat folder uploads retain paths and refresh page files even after a partial failure',async()=>{
 const originalFetch=globalThis.fetch,originalWindow=globalThis.window;const calls=[],events=[],saved=[];
 globalThis.window={dispatchEvent:e=>events.push(e)};
 globalThis.fetch=async(url,options)=>{calls.push({url,...options});return calls.length===1?Response.json({file:{id:'image1',name:'screen.png'}}):Response.json({error:'Storage unavailable'},{status:503});};
 const file=new File(['image'],'screen.png',{type:'image/png'});Object.defineProperty(file,'webkitRelativePath',{value:'design/mobile/screen.png'});
 try{
 await assert.rejects(()=>uploadPageFiles('page',[file,new File(['x'],'other.txt')],f=>saved.push(f)),/Storage unavailable/);
 assert.equal(calls[0].headers['X-Page-Id'],'page');assert.equal(decodeURIComponent(calls[0].headers['X-Folder-Path']),'design/mobile');assert.equal(calls[0].body,file);
 assert.deepEqual(saved.map(f=>f.id),['image1']);assert.equal(events.length,1);assert.equal(events[0].type,'page-files-changed');assert.equal(events[0].detail.pageId,'page');
 }finally{globalThis.fetch=originalFetch;globalThis.window=originalWindow;}
});
test('oversized upload batches fail before writing any files',async()=>{
 const original=globalThis.fetch;let called=false;globalThis.fetch=async()=>{called=true;};try{
 await assert.rejects(()=>uploadPageFiles('page',[{size:1},{size:10*1024*1024+1}]),/10 MB/);assert.equal(called,false);
 }finally{globalThis.fetch=original;}
});
