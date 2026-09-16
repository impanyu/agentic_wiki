import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { migrate } from './migrate.mjs';
import { SqliteDatabase } from '../server/sqlite.mjs';
import {readEvents} from '../app/event-stream.ts';
const dir=await mkdtemp(join(tmpdir(),'agenticwiki-live-'));
const listener=createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
const origin='http://localhost:'+port,path=join(dir,'agenticwiki.sqlite');migrate(path);
const db=new SqliteDatabase(path),session=randomBytes(32).toString('base64url');
await db.prepare('INSERT INTO auth_sessions VALUES(?,?,?)').bind(createHash('sha256').update(session).digest('hex'),JSON.stringify({userId:'google:smoke',email:'smoke@example.com',displayName:'Smoke',fullName:'Smoke'}),Date.now()+600000).run();
const child=spawn(process.execPath,[resolve('.next/standalone/server.js')],{env:{...process.env,NODE_ENV:'production',HOSTNAME:'127.0.0.1',PORT:String(port),APP_URL:origin,DATA_DIR:dir,GOOGLE_CLIENT_ID:'',GOOGLE_CLIENT_SECRET:''},stdio:['ignore','pipe','pipe']});
let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
try{
 let ready=false;for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error('Server stopped: '+logs);try{if((await fetch(origin+'/api/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(ready,'Server readiness timed out');

 const headers={origin,'Content-Type':'application/json',cookie:'agenticwiki_session='+session};
 const started=Date.now();
 const response=await fetch(origin+'/api/ask',{method:'POST',headers,body:JSON.stringify({question:'Build a percentage change calculator with before and after inputs',fresh:true}),signal:AbortSignal.timeout(240000)});
 const result=await response.json();
 assert.equal(response.status,200,JSON.stringify(result));
 const creationMs=Date.now()-started;const page=result.page;assert.ok(page?.id,JSON.stringify(result));
 assert.ok(page.dynamic,'Expected a calculator web app');
 const reply=await fetch(origin+'/api/pages/'+page.id+'/chat',{method:'POST',headers,body:JSON.stringify({message:'Use this calculator for before=80 and after=100 and tell me the percentage change.',parameters:{before:80,after:100}}),signal:AbortSignal.timeout(180000)});
 const chat=await reply.json();assert.equal(reply.status,200,JSON.stringify(chat));assert.match(chat.reply,/25/);
 const events=(await db.prepare("SELECT data FROM agent_run_events WHERE kind='tool_finished'").all()).results.map(e=>JSON.parse(e.data));
 assert.ok(events.some(e=>e.tool==='run_current_app'&&!e.result?.error&&/25/.test(JSON.stringify(e.result))), 'The in-page agent must obtain 25 from actual app execution');
 const appAndChatMs=Date.now()-started;
 const version=Number((await readFile('app/api/ask/ai.ts','utf8')).match(/MATCH_VERSION=(\d+)/)[1]);
 const now=new Date().toISOString(),question='Speed cache verification';
 await db.prepare("INSERT INTO pages(id,owner_id,question,title,summary,body,category,sources,labels,visibility,created_at,language) VALUES('speed-article','google:smoke',?,?,?,'Saved content','Test','[]','{}','private',?,'en')").bind(question,question,'Summary',now).run();
 await db.prepare("INSERT INTO questions(id,page_id,normalized,question,embedding,created_at,match_version,routing_scope,parameters) VALUES('speed-question','speed-article','speed cache verification',?,'[]',?,?,'wiki','{}')").bind(question,now,version).run();
 await db.prepare("INSERT INTO root_routes(id,owner_id,question,normalized,language,embedding,target_type,intent,created_at) VALUES('speed-route','google:smoke',?,'speed cache verification','en','[]','wiki_router',?,?)").bind(question,JSON.stringify({fresh:false}),now).run();
 const before=(await db.prepare('SELECT count(*) n FROM agent_instances').first()).n,cacheStart=Date.now();
 const cached=await (await fetch(origin+'/api/ask',{method:'POST',headers,body:JSON.stringify({question})})).json();
 const exactMs=Date.now()-cacheStart;assert.equal(cached.page.id,'speed-article');assert.equal((await db.prepare('SELECT count(*) n FROM agent_instances').first()).n,before);
 await db.prepare("INSERT INTO pages(id,owner_id,question,title,summary,body,category,sources,labels,visibility,created_at,language,kind,dynamic_config) VALUES('speed-app','google:smoke','App','App','','','Test','[]','{}','private',?,'en','dynamic',?)").bind(now,JSON.stringify({template:'page-program-v1',executor:'isolated-page-program-v1',version:1,capability:'application',labels:{invalid:'Invalid'}})).run();
 const loadStart=Date.now(),shell=await (await fetch(origin+'/api/pages/speed-app?defer=1',{headers})).json(),shellMs=Date.now()-loadStart;
 assert.equal(shell.page.runtimePending,true);assert.equal(shell.page.runtimeError,undefined);
 const streamStart=Date.now();let firstContentMs,streamDone=false;
 const streamed=await fetch(origin+'/api/ask',{method:'POST',headers:{...headers,Accept:'text/event-stream'},body:JSON.stringify({question:'Explain photosynthesis in about 120 words.'}),signal:AbortSignal.timeout(240000)});
 assert.ok(streamed.ok);
 for await(const event of readEvents(streamed.body)){
  if(event.type==='replace'&&event.text?.length>20&&firstContentMs===undefined)firstContentMs=Date.now()-streamStart;
  if(event.type==='error')throw Error(event.message);
  if(event.type==='done'){streamDone=true;break;}
 }
 assert.ok(streamDone);assert.ok(firstContentMs!==undefined);
 const articleMs=Date.now()-streamStart;
 console.log(JSON.stringify({performanceCheck:true,creationMs,appAndChatMs,exactMs,shellMs,firstContentMs,articleMs}));
 const roles=await db.prepare('SELECT role FROM agent_instances').all();
 console.log(JSON.stringify({passed:true,title:page.title,template:page.dynamic.template,durationMs:Date.now()-started,roles:roles.results}));
}catch(error){console.error(logs);console.error(JSON.stringify((await db.prepare('SELECT a.role,e.kind,e.data FROM agent_run_events e JOIN agent_instances a ON a.id=e.agent_id ORDER BY e.sequence DESC LIMIT 12').all()).results));throw error;}
finally{child.kill('SIGTERM');await new Promise(r=>{if(child.exitCode!==null)r();else child.once('exit',r);});db.close();await rm(dir,{recursive:true,force:true});}
