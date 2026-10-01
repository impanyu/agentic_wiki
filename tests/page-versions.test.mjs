import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import ts from 'typescript';
import {SqliteDatabase} from '../server/sqlite.mjs';import {migrate} from '../scripts/migrate.mjs';
// Versions: the original is kept on the first change, each saved state is numbered, unchanged
// saves add nothing, and switching to an old version only moves the current mark.
const deps={};globalThis.__versions={database:()=>deps.db,getPage:async(id,u)=>deps.page(id,u),lock:async()=>'lease',unlock:async()=>{},canWritePage:p=>!!p?.editable};
const m=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile('const {database,getPage,lock,unlock,canWritePage}=globalThis.__versions;\n'+readFileSync('app/versions/service.ts','utf8').replace(/^import .*;$/gm,''),{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
test('page versions: original, numbered changes, preview and undoable restore',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'versions-'));
 try{
  const path=join(dir,'db.sqlite');migrate(path);const db=new SqliteDatabase(path);deps.db=db;deps.page=(id,u)=>u==='alice'?{id,editable:true}:u==='bob'?{id,editable:false}:null;
  const now=new Date().toISOString();
  await db.prepare("INSERT INTO pages(id,owner_id,question,title,summary,body,kind,visibility,language,labels,sources,category,created_at,updated_at) VALUES('p1','alice','q','Title v1','s','Body one','static','private','en','{}','[]','',?,?)").bind(now,now).run();
  const set=async body=>db.prepare("UPDATE pages SET body=? WHERE id='p1'").bind(body).run();
  await m.versioned('p1','alice','agent-edit','First edit',()=>set('Body two'));
  await m.versioned('p1','alice','editor','No-op',async()=>{});
  await m.versioned('p1','alice','app-revision','Second edit',()=>set('Body three'));
  let list=(await m.listVersions('p1','alice')).versions;
  assert.deepEqual(list.map(v=>[v.number,v.source,v.current]),[[3,'app-revision',true],[2,'agent-edit',false],[1,'original',false]]);
  const original=list.find(v=>v.number===1);assert.equal((await m.readVersion('p1','alice',original.id)).body,'Body one');
  await assert.rejects(()=>m.listVersions('p1','bob'),/Only people who can edit/);
  list=(await m.restoreVersion('p1','alice',original.id)).versions;
  assert.equal((await db.prepare("SELECT body FROM pages WHERE id='p1'").first()).body,'Body one');
  // Switching adds no entry; the current mark moves to the version shown.
  assert.deepEqual(list.map(v=>[v.number,v.current]),[[3,false],[2,false],[1,true]]);
  await m.versioned('p1','alice','editor','Edit after switching',()=>set('Body four'));
  list=(await m.listVersions('p1','alice')).versions;assert.deepEqual(list.map(v=>[v.number,v.current]),[[4,true],[3,false],[2,false],[1,false]]);
  db.close?.();
 }finally{await rm(dir,{recursive:true,force:true});}
});
