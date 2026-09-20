import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,readdirSync} from 'node:fs';import ts from 'typescript';import {DatabaseSync} from 'node:sqlite';import {z} from 'zod';
const source=p=>readFileSync(p,'utf8').replace(/^import .*;$/gm,'');
const load=async s=>import('data:text/javascript;base64,'+Buffer.from(ts.transpile(s,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
const {runToolLoop}=await load(source('app/agents/loop.ts'));
const call=(id,name='lookup',args='{}')=>({type:'function_call',call_id:id,name,arguments:args});
const done={status:'completed',output:[{type:'message',content:[{type:'output_text',text:'Done'}]}]};
test('loop retains reasoning and every call/result, recovers tool errors and exceeds old five-round cap',async()=>{
 let round=0;const events=[];
 const result=await runToolLoop({payload:{input:'Task'},request:async p=>{if(round){const outputs=p.input.filter(i=>i.type==='function_call_output');assert.equal(outputs.length,round*2);assert.ok(p.input.some(i=>i.type==='reasoning'));}return round++<9?{output:[{type:'reasoning',id:'r'+round},call('a'+round),call('b'+round,'failing')]}:done;},execute:async n=>{if(n==='failing')throw Error('try another query');return {data:{found:true}};},event:async e=>events.push(e)});
 assert.equal(round,10);assert.equal(result.limited,false);assert.equal(events.filter(e=>e.kind==='tool_finished').length,18);
});
test('repeated call IDs do not repeat external effects and conflicting IDs fail closed',async()=>{
 let executed=0,round=0;await runToolLoop({payload:{input:[]},request:async()=>round++<2?{output:[call('same')]}:done,execute:async()=>({data:++executed})});assert.equal(executed,1);
 round=0;await assert.rejects(runToolLoop({payload:{input:[]},request:async()=>({output:[call('same','write',round++?' {"x":1}':'{}')]}),execute:async()=>({data:true})}),/CALL_ID_CONFLICT/);
});
test('tool budget requires a final response and does not execute excess calls',async()=>{
 let count=0,round=0;const r=await runToolLoop({maxCalls:1,payload:{input:'x'},request:async p=>{if(round++){assert.equal(p.tool_choice,'none');return done;}return {output:[call('1'),call('2')]};},execute:async()=>({data:++count})});assert.equal(count,1);assert.equal(r.limited,true);
});
test('a caller can grant a bounded larger context budget for data-heavy page work',async()=>{
 let round=0;const r=await runToolLoop({maxInputChars:300000,payload:{input:'x'.repeat(190000)},request:async p=>round++?done:{output:[call('1')]},execute:async()=>({data:true})});
 assert.equal(r.limited,false);assert.equal(round,2);
});
test('approval is persisted as pending, journal failure prevents a retry, cancellation stops execution',async()=>{
 let round=0;const r=await runToolLoop({payload:{input:[]},request:async()=>round++?done:{output:[call('1')]},execute:async()=>({data:{confirmationRequired:true,actionId:'a'}})});assert.equal(r.waiting,true);
 let count=0;await assert.rejects(runToolLoop({payload:{input:[]},request:async()=>({output:[call('1')]}),execute:async()=>({data:++count}),event:async e=>{if(e.kind==='tool_finished')throw Error('disk failure');}}),/disk failure/);assert.equal(count,1);
 const control=new AbortController();control.abort();await assert.rejects(runToolLoop({payload:{input:[]},signal:control.signal,request:async()=>{throw Error('must not call');},execute:async()=>({data:++count})}));assert.equal(count,1);
});
test('durable memory, notes and tool journals are isolated and old actions stay searchable after compaction',async()=>{
 const db=new DatabaseSync(':memory:');for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('drizzle/'+f,'utf8'));
 const database=()=>({prepare(sql){return {bind(...args){return {first:async()=>db.prepare(sql).get(...args),all:async()=>({results:db.prepare(sql).all(...args)}),run:async()=>db.prepare(sql).run(...args)};}};},batch:async statements=>Promise.all(statements.map(s=>s.run()))});
 db.exec("INSERT INTO agent_instances VALUES('a','page:p','alice',NULL,'now'),('b','page:p','bob',NULL,'now')");
 globalThis.agentSessionTest={database,model:()=>'',api:async()=>({}),output:()=> 'First goal and unfinished tasks.',z};
 const m=await load('const {database,model,api,output,z}=globalThis.agentSessionTest;\n'+source('app/agents/session.ts'));
 const a={id:'a',ownerId:'alice',role:'page:p'},b={id:'b',ownerId:'bob',role:'page:p'};
 for(let i=1;i<=65;i++)db.prepare('INSERT INTO agent_memory(agent_id,action,result,created_at) VALUES(?,?,?,?)').run('a','action '+i,'result '+i,'now');
 await m.compactSession(a);assert.equal(db.prepare('SELECT count(*) n FROM agent_memory').get().n,65);
 assert.match((await m.sessionContext(a)).summary,/First goal/);
 const old=await m.sessionTool(a,'search_session_memory',{source:'actions',query:'action 1',before:null});assert.ok(old.records.some(r=>r.action==='action 1'));
 assert.equal((await m.sessionTool(b,'search_session_memory',{source:'actions',query:'',before:null})).records.length,0);
 await assert.rejects(m.sessionContext({...a,ownerId:'bob'}),/OWNER_MISMATCH/);
 await m.sessionTool(a,'update_session_note',{key:'language',value:'Chinese'});assert.equal((await m.sessionContext(a)).notes.language,'Chinese');assert.deepEqual((await m.sessionContext(b)).notes,{});
 await m.sessionTool(a,'update_task_plan',{steps:[{task:'Check result',status:'blocked'}]});assert.equal((await m.sessionContext(a)).plan[0].status,'blocked');
 const journal=m.runJournal(a);await journal({kind:'tool_started',data:{callId:'c',tool:'write'}});await journal({kind:'tool_finished',data:{callId:'c',result:{confirmationRequired:true}}});
 assert.equal((await m.sessionTool(a,'search_session_memory',{source:'tools',query:'c',before:null})).records.length,2);
 assert.ok(!m.safeMemory({api_key:'sensitive',authorization:'Bearer example'}).includes('sensitive'));
 db.close();delete globalThis.agentSessionTest;
});
test('final validation feedback stays in the same loop and the agent can choose another tool',async()=>{
 let turn=0;const events=[];
 const result=await runToolLoop({payload:{model:'test',reasoning:{effort:'low'},input:'task'},request:async p=>{
  turn++;if(turn===1)return {...done,invalid:true};
  assert.ok(p.input.some(i=>typeof i.content==='string'&&i.content.includes('Draft validation failed')));
  return turn===2?{output:[call('repair','lookup')]}:done;
 },execute:async()=>({data:'needed evidence'}),validateFinal:async r=>r.invalid?'Missing required evidence':undefined,event:async e=>events.push(e)});
 assert.equal(turn,3);assert.equal(result.limited,false);assert.equal(events.filter(e=>e.kind==='validation_failed').length,1);assert.equal(events.filter(e=>e.kind==='model_finished').length,3);assert.ok(events.filter(e=>e.kind==='model_finished').every(e=>e.data.durationMs>=0));
});
test('an incomplete model response is retried once before the agent fails',async()=>{
 let requests=0;const events=[];
 const result=await runToolLoop({payload:{input:'Task'},request:async()=>++requests===1?{status:'incomplete',output:[]}:done,execute:async()=>({data:true}),event:async e=>events.push(e)});
 assert.equal(requests,2);assert.equal(result.response.status,'completed');assert.deepEqual(events.filter(e=>e.kind==='model_finished').map(e=>e.data.attempt),[1,2]);
 requests=0;
 await assert.rejects(runToolLoop({payload:{input:'Task'},request:async()=>{requests++;return {status:'incomplete',output:[]};},execute:async()=>({data:true})}),/AGENT_RESPONSE_INCOMPLETE/);
 assert.equal(requests,2);
});
