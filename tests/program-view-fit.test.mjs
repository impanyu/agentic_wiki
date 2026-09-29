import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';import {z} from 'zod';
// A program view with a long reply or a huge file list is shortened, not rejected.
globalThis.__viewDeps={z,resourceSchema:z.any(),normalizeGeoJSON:x=>x,chartSchema:z.any(),programFormSchema:z.any()};
const src=readFileSync('app/page-programs/contracts.ts','utf8').replace(/^import .*;$/gm,'');
const m=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile('const {z,resourceSchema,normalizeGeoJSON,chartSchema,programFormSchema}=globalThis.__viewDeps;\n'+src,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
test('long program views are shortened with a note instead of failing',()=>{
 const view=m.viewSchema.parse({templateId:'files-v1',title:'ADAPT',summary:'Folder',reply:'x'.repeat(20000),files:Array.from({length:700},(_,i)=>({id:String(i),name:'f'+i,kind:'file'}))});
 assert.equal(view.files.length,500);assert.ok(view.reply.length<=12000);assert.match(view.reply,/shortened/);
 assert.equal(m.viewSchema.parse({templateId:'wiki-v1',title:'t',summary:'s',reply:'short'}).reply,'short');
});
test('a JSON reply used as data is kept whole; data carries structured results',()=>{
 const items=Array.from({length:600},(_,i)=>({name:'file'+i,size:i}));const reply=JSON.stringify({items});
 const view=m.viewSchema.parse({templateId:'files-v1',title:'ADAPT',summary:'Folder',reply,files:Array.from({length:700},(_,i)=>({id:String(i),name:'f'+i,kind:'file'}))});
 assert.deepEqual(JSON.parse(view.reply),{items});assert.match(view.summary,/first 500 of 700/);
 assert.equal(m.viewSchema.parse({templateId:'files-v1',title:'t',summary:'s',data:{items}}).data.items.length,600);
});
