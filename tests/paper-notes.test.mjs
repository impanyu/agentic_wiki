import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import ts from 'typescript';import {z} from 'zod';
import {SqliteDatabase} from '../server/sqlite.mjs';import {migrate} from '../scripts/migrate.mjs';

// Paper highlights belong to one reader, page and document, and survive across visits.
const deps={};globalThis.__notes={z,database:()=>deps.db,getPage:async(id,user)=>deps.readable(id,user)};
const m=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile('const {z,database,getPage}=globalThis.__notes;\n'+readFileSync('app/papers/notes.ts','utf8').replace(/^import .*;$/gm,''),{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));

test('paper notes: create, list per reader and document, recolor, annotate, delete',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'paper-notes-'));
 try{
  const path=join(dir,'db.sqlite');migrate(path);deps.db=new SqliteDatabase(path);deps.readable=(id,user)=>id==='p1'&&user!=='stranger'?{id}:null;
  const rects=[{x:0.1,y:0.2,w:0.5,h:0.02}];
  const a=await m.addNote('p1','alice',{document:'source',page:1,color:'yellow',quote:'Attention Is All You Need',rects});
  await m.addNote('p1','alice',{document:'file:abc-123',page:2,color:'green',quote:'other doc',rects});
  await m.addNote('p1','bob',{document:'source',page:1,color:'blue',quote:'bob only',rects});
  let list=await m.listNotes('p1','alice','source');assert.equal(list.length,1);assert.equal(list[0].quote,'Attention Is All You Need');assert.deepEqual(list[0].rects,rects);
  await m.changeNote('p1','alice',{id:a.id,color:'pink',note:'Key paper'});
  list=await m.listNotes('p1','alice','source');assert.equal(list[0].color,'pink');assert.equal(list[0].note,'Key paper');
  await assert.rejects(()=>m.changeNote('p1','bob',{id:a.id,note:'x'}),/NOT_FOUND/);
  await m.removeNote('p1','bob',a.id);assert.equal((await m.listNotes('p1','alice','source')).length,1);
  await m.removeNote('p1','alice',a.id);assert.equal((await m.listNotes('p1','alice','source')).length,0);
  await assert.rejects(()=>m.listNotes('p1','stranger','source'),/NOT_FOUND/);
  await assert.rejects(()=>m.addNote('p1','alice',{document:'../etc',page:1,color:'yellow',quote:'x',rects}));
  await assert.rejects(()=>m.addNote('p1','alice',{document:'source',page:1,color:'purple',quote:'x',rects}));
  await assert.rejects(()=>m.addNote('p1','alice',{document:'source',page:1,color:'yellow',quote:'x',rects:[{x:2,y:0,w:0,h:0}]}));
  deps.db.close?.();
 }finally{await rm(dir,{recursive:true,force:true});}
});
