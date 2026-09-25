import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import ts from 'typescript';
import {SqliteDatabase} from '../server/sqlite.mjs';import {migrate} from '../scripts/migrate.mjs';

// The live agent service against a real migrated database, with the page chat turn stubbed.
const src=readFileSync('app/live-agent/service.ts','utf8').replace(/^import .*;$/gm,'').replace("await import('@/app/chat/page-turn')",'globalThis.__liveDeps.pageTurn');
const deps={};globalThis.__liveDeps={database:(...a)=>deps.database(...a),getPage:(...a)=>deps.getPage(...a),lock:(...a)=>deps.lock(...a),unlock:(...a)=>deps.unlock(...a),canWritePage:(...a)=>deps.canWritePage(...a),get pageTurn(){return deps.pageTurn;}};
const m=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile('const {database,getPage,lock,unlock,canWritePage}=globalThis.__liveDeps;\n'+src,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));

test('live agent: switch on, scheduled run saves a verified change with a snapshot, undo restores it',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'live-agent-'));
 try{
  const path=join(dir,'db.sqlite');migrate(path);const db=new SqliteDatabase(path);
  await db.prepare("INSERT INTO pages(id,owner_id,question,title,summary,body,kind,visibility,language,labels,sources,category,created_at,updated_at) VALUES('p1','alice','grant','Grant','old summary','Old body','static','private','en','{}','[]','History',?,?)").bind(new Date().toISOString(),new Date().toISOString()).run().catch(async e=>{throw Error('fixture: '+e.message);});
  const calls=[];let nextReply={reply:'Checked facts; fixed a date.',editDraft:{id:'d1'}};
  Object.assign(deps,{database:()=>db,lock:async()=>'lease',unlock:async()=>{},canWritePage:p=>p.ownerId==='alice'||p.owner_id==='alice',
   getPage:async(id,user)=>{const r=await db.prepare('SELECT * FROM pages WHERE id=?').bind(id).first();return r&&user==='alice'?{...r,ownerId:r.owner_id}:null;},
   pageTurn:{handlePost:async(request)=>{const body=JSON.parse(await request.text());calls.push({body,origin:request.headers.get('Origin')});
    if(body.saveDraftId){await db.prepare("UPDATE pages SET body='New body',summary='new summary' WHERE id='p1'").run();return new Response(JSON.stringify({reply:'Changes saved.'}));}
    return new Response(JSON.stringify(nextReply));}}});
  assert.equal(await m.liveAgentStatus('p1','bob'),null);
  await assert.rejects(()=>m.setLiveAgent('p1','bob',{enabled:true}),/Only people who can edit/);
  const on=await m.setLiveAgent('p1','alice',{enabled:true,intervalHours:6,focus:'keep dates exact'});
  assert.equal(on.enabled,true);assert.equal(on.intervalHours,6);assert.ok(on.nextRunAt>Date.now()&&on.nextRunAt<=Date.now()+31000);
  await assert.rejects(()=>m.setLiveAgent('p1','alice',{intervalHours:5}),/supported frequency/);
  assert.deepEqual(await m.dueLiveAgents(),[]);
  await db.prepare('UPDATE page_live_agents SET next_run_at=? WHERE page_id=?').bind(Date.now()-1,'p1').run();
  assert.deepEqual(await m.dueLiveAgents(),['p1']);
  assert.deepEqual(await m.runLiveAgent('p1'),{outcome:'updated'});
  assert.match(calls[0].body.message,/scheduled maintenance of this wiki page[\s\S]*keep dates exact/);assert.equal(calls[1].body.saveDraftId,'d1');
  let s=await m.liveAgentStatus('p1','alice');
  assert.equal(s.lastStatus,'updated');assert.equal(s.running,false);assert.equal(s.canRevert,true);assert.match(s.lastSummary,/fixed a date/);assert.ok(s.nextRunAt>Date.now()+5.9*3600000);
  assert.equal((await db.prepare("SELECT body FROM pages WHERE id='p1'").first()).body,'New body');
  s=await m.revertLiveAgentChange('p1','alice');
  assert.equal((await db.prepare("SELECT body FROM pages WHERE id='p1'").first()).body,'Old body');assert.equal(s.canRevert,false);assert.equal(s.lastStatus,'reverted');
  nextReply={reply:'Everything is current.',editDraft:null};calls.length=0;
  assert.deepEqual(await m.runLiveAgent('p1'),{outcome:'checked'});assert.equal(calls.length,1);
  assert.equal((await m.liveAgentStatus('p1','bob')),null);
  const off=await m.setLiveAgent('p1','alice',{enabled:false});assert.equal(off.enabled,false);assert.equal(off.nextRunAt,null);
  assert.deepEqual(await m.runLiveAgent('p1'),{skipped:'disabled'});
  db.close?.();
 }finally{await rm(dir,{recursive:true,force:true});}
});
