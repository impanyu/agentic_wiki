import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,readdirSync} from 'node:fs';import {DatabaseSync} from 'node:sqlite';import ts from 'typescript';
test('draft snapshots grow before completion and remain isolated by owner',async()=>{
 const db=new DatabaseSync(':memory:');for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('drizzle/'+f,'utf8'));
 globalThis.progressDb=()=>({prepare:sql=>({bind:(...args)=>({run:async()=>db.prepare(sql).run(...args)})})});
 const code=readFileSync('app/generation-progress.ts','utf8').replace(/^import .*;$/gm,'');const {generationProgress}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile('const database=globalThis.progressDb;'+code,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
 const p=generationProgress('request','alice');p.event({type:'start',question:'Topic',language:'en'});p.event({type:'delta',text:'First paragraph'});await p.finish();
 const read=()=>JSON.parse(db.prepare('SELECT data FROM generation_progress WHERE id=? AND owner_id=?').get('request','alice').data);assert.equal(read().body,'First paragraph');assert.equal(read().done,undefined);
 const wrong=generationProgress('request','bob');wrong.event({type:'delta',text:'wrong'});await wrong.finish();assert.equal(read().body,'First paragraph');
 p.event({type:'delta',text:' and more'});p.event({type:'done'});await p.finish();assert.equal(read().body,'First paragraph and more');assert.equal(read().done,true);db.close();
});
