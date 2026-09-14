import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,readdirSync} from 'node:fs';import {DatabaseSync} from 'node:sqlite';import ts from 'typescript';
const strip=p=>readFileSync(p,'utf8').replace(/^import .*;$/gm,'');const load=async s=>import('data:text/javascript;base64,'+Buffer.from(ts.transpile(s,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
test('page context searches all historical comments and isolates app sessions and selected files',async()=>{
 const db=new DatabaseSync(':memory:');for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('drizzle/'+f,'utf8'));
 db.exec("INSERT INTO pages(id,owner_id,question,title,summary,body,category,sources,visibility,created_at) VALUES('p','alice','India','India','Summary','Body','Country','[]','private','now');INSERT INTO agent_instances VALUES('a','page:p','alice',NULL,'now'),('b','page:p','bob',NULL,'now')");
 for(let i=0;i<75;i++)db.prepare('INSERT INTO wiki_comments(page_id,session_id,author_name,message,reply,created_at) VALUES(?,?,?,?,?,?)').run('p','a','Alice',i===0?'old detail':'message '+i,'reply','now');
 for(const [id,text] of [['a','alice private'],['b','bob private']])db.prepare('INSERT INTO page_chat_turns(session_id,message,reply,created_at) VALUES(?,?,?,?)').run(id,text,'reply','now');
 let kind='static',selected;
 globalThis.contextToolsTest={database:()=>({prepare:sql=>({bind:(...args)=>({all:async()=>({results:db.prepare(sql).all(...args)})})})}),getPage:async(id,owner)=>id==='p'&&owner==='alice'?{id,kind,dynamic:null}:null,getComponent:async()=>{},fileContext:async(p,u,ids)=>{selected=ids;return {metadata:[],parts:[]}},listContextFiles:async()=>[]};
 const {readPageContext}=await load('const {database,getPage,getComponent,fileContext,listContextFiles}=globalThis.contextToolsTest;\n'+strip('app/chat/context-tools.ts'));
 const agent={role:'comments:p',ownerId:'alice'};const old=await readPageContext(agent,{resource:'history',query:'old detail'});assert.equal(old.data.messages.length,1);
 const first=await readPageContext(agent,{resource:'history'});assert.equal(first.data.messages.length,30);assert.ok(first.data.before);const second=await readPageContext(agent,{resource:'history',before:first.data.before});assert.equal(second.data.messages.length,30);
 kind='dynamic';const app=await readPageContext({...agent,role:'page:p'},{resource:'history'});assert.deepEqual(app.data.messages.map(x=>x.message),['alice private']);
 await assert.rejects(()=>readPageContext({...agent,ownerId:'eve'},{resource:'history'}),/inaccessible/);
 await readPageContext(agent,{resource:'file',fileId:'older-file'});assert.deepEqual(selected,['older-file']);db.close();
});
test('dedicated agent executes context tool calls before producing its final reply',async()=>{
 let calls=0,read=false;
 globalThis.agentLoopTest={database:()=>({prepare:()=>({bind:()=>({all:async()=>({results:[]})})}),batch:async()=>[]}),model:()=> 'test',partialReply:()=>'',output:r=>r.output.filter(o=>o.type==='message').flatMap(o=>o.content).map(c=>c.text).join(''),api:async(path,payload)=>{if(++calls===1)return {output:[{type:'function_call',name:'read_page_context',arguments:JSON.stringify({resource:'history',query:'earlier',before:null,fileId:null}),call_id:'call1'}]};assert.ok(payload.input.some(i=>i.type==='function_call_output'&&i.output.includes('earlier detail')));return {output:[{type:'message',content:[{type:'output_text',text:'{"reply":"Found earlier detail"}'}]}]};},streamArticle:async()=>{},scoped:{pageContextTool:{},pageTaskTool:{},readPageContext:async()=>{read=true;return {data:'earlier detail'}}}};
 const code=strip('app/components-registry/agents.ts').replace("await import('@/app/chat/context-tools')",'globalThis.agentLoopTest.scoped');
 const {askAgent}=await load('const {database,model,partialReply,output,api,streamArticle}=globalThis.agentLoopTest;\n'+code);
 const result=await askAgent({id:'a',role:'page:p',ownerId:'alice'},'answer',{},{});assert.equal(result.reply,'Found earlier detail');assert.ok(read);assert.equal(calls,2);
});
