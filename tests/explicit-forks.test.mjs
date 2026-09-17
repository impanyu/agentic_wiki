import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {readFileSync,readdirSync} from 'node:fs';import ts from 'typescript';
const load=async s=>import('data:text/javascript;base64,'+Buffer.from(ts.transpile(s,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));const strip=p=>readFileSync(p,'utf8').replace(/^import .*;$/gm,'');
test('explicit forks obey visibility and allow owner-only removal',async()=>{
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('drizzle/'+f,'utf8'));
 const {pageForksSql}=await load(strip('db/page-forks.ts'));
 const database=()=>({prepare(sql){return {bind(...args){return {sql,args,first:async()=>db.prepare(sql).get(...args),all:async()=>({results:db.prepare(sql).all(...args)}),run:async()=>db.prepare(sql).run(...args)}}}},batch:async statements=>{db.exec('BEGIN');try{const results=statements.map(s=>({meta:db.prepare(s.sql).run(...s.args)}));db.exec('COMMIT');return results;}catch(e){db.exec('ROLLBACK');throw e;}}});
 const getPage=async(id,uid)=>{const p=db.prepare("SELECT * FROM pages WHERE id=? AND (owner_id=? OR visibility='public')").get(id,uid);return p?{...p,owned:p.owner_id===uid,links:[],forks:db.prepare(pageForksSql).all(uid,id,uid,uid)}:null;};
 const ensurePageSession=async(id,uid)=>{const agent={id:uid+':'+id};db.prepare('INSERT OR IGNORE INTO agent_instances VALUES(?,?,?,NULL,?)').run(agent.id,'page:'+id,uid,'now');return agent;};
 globalThis.forkTest={database,getPage,ensurePageSession,lock:async()=> 'lease',unlock:async()=>{},importLegacyComments:async()=>{}};
 const {forkContext,removeFork}=await load('const {database,getPage,ensurePageSession,lock,unlock,importLegacyComments}=globalThis.forkTest;\n'+strip('app/chat/fork-context.ts'));
 db.exec("INSERT INTO pages(id,owner_id,question,title,summary,body,category,sources,language,visibility,created_at) VALUES('root','alice','china','China','Summary','Country article','Country','[]','en','public','2026-01-01'),('duplicate','alice','china','China','Index','Other content','Index','[]','en','public','2026-01-02');INSERT INTO questions(id,page_id,normalized,question,embedding,created_at) VALUES('q','root','china','china','[]','now'),('q2','duplicate','china','china','[]','now');INSERT INTO agent_instances VALUES('a','comments:root','alice',NULL,'now');INSERT INTO wiki_comments(page_id,session_id,author_name,message,reply,created_at) VALUES('root','a','Alice','Add a map','Proposed','now')");
 assert.equal((await getPage('root','alice')).forks.length,0);
 db.exec("INSERT INTO pages(id,owner_id,question,title,summary,body,category,sources,language,visibility,created_at) VALUES('fork1','alice','china','China','Fresh','New research','Country','[]','en','private','2026-01-03'),('fork2','bob','china','China','Fresh','Independent','Country','[]','en','private','2026-01-04');INSERT INTO page_forks VALUES('root','root',NULL,'2026-01-01'),('fork1','root','root','2026-01-03'),('fork2','root','root','2026-01-04')");
 assert.deepEqual((await getPage('root','bob')).forks.map(p=>p.id),['root','fork2']);
 await assert.rejects(()=>removeFork('fork2','alice'),/creator/);

 await removeFork('fork1','alice');assert.ok(await getPage('root','alice'));assert.ok(await getPage('fork2','bob'));assert.equal(await getPage('fork1','alice'),null);
 await removeFork('root','alice');assert.ok(await getPage('fork2','bob'));
 const last=await removeFork('fork2','bob');assert.equal(last.nextPageId,null);
 const standalone=await removeFork('duplicate','alice');assert.equal(standalone.nextPageId,null);assert.equal(await getPage('duplicate','alice'),null);
 db.close();delete globalThis.forkTest;
});
test('only the generator decides ambiguity after page reuse misses',()=>{const source=readFileSync('app/api/ask/route.ts','utf8');assert.doesNotMatch(source,/assessAmbiguity|needsDisambiguation/);const generation=readFileSync('app/page-programs/generate-context.ts','utf8');assert.match(generation,/validateGenerationDraft/);assert.doesNotMatch(generation,/analyzeGenerationIntent|useNotebook|reviewGeneratedDefinition/);});

test('forks generate from the question, bypass both matches and do not replace routing aliases',()=>{const s=readFileSync('app/api/ask/route.ts','utf8');assert.match(s,/matched=fork\?null:rootRoute.pageId/);assert.match(s,/existing=fork\?null:await findMatch/);assert.match(s,/\(fork\?\[\]:entries\)/);assert.match(s,/uid,rootRouter,request.signal,!!fork/);assert.match(s,/generateContext\(\{question:destination/);assert.doesNotMatch(s,/source\.body|source\.dynamic|source\.links/);});
