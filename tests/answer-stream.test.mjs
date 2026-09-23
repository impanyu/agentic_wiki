import test from 'node:test';import assert from 'node:assert/strict';import ts from 'typescript';import {readFileSync} from 'node:fs';
const moduleUrl=source=>'data:text/javascript;base64,'+Buffer.from(ts.transpile(source,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64');
const events=moduleUrl(readFileSync('app/event-stream.ts','utf8'));
const {answerStream}=await import(moduleUrl(readFileSync('app/answer-stream.ts','utf8').replace("'./event-stream'",JSON.stringify(events))));
const {readEvents}=await import(events);
test('status arrives before routing resolves, then cached page completes',async()=>{
 let resolve;const pending=new Promise(r=>resolve=r),controller=new AbortController();
 const response=answerStream(()=>pending,controller.signal),reader=readEvents(response.body);
 assert.equal((await reader.next()).value.type,'status');
 resolve(Response.json({page:{id:'saved'}}));
 const done=await reader.next();assert.equal(done.value.type,'done');assert.equal(done.value.page.id,'saved');assert.equal((await reader.next()).done,true);
});
test('relays split article events and stops at saved completion',async()=>{
 const encoder=new TextEncoder();let cancelled=false;
 const body=new ReadableStream({start(c){c.enqueue(encoder.encode('data: {"type":"del'));c.enqueue(encoder.encode('ta","text":"中国"}\n\ndata: {"type":"done","page":{"id":"saved"}}\n\n'));},cancel(){cancelled=true;}});
 const output=[];for await(const event of readEvents(answerStream(async()=>new Response(body,{headers:{'Content-Type':'text/event-stream'}}),new AbortController().signal).body))output.push(event);
 assert.deepEqual(output.map(e=>e.type),['status','delta','done']);assert.equal(output[1].text,'中国');assert.equal(cancelled,true);
});
test('permission and validation failures remain errors, not saved pages',async()=>{
 const output=[];for await(const event of readEvents(answerStream(async()=>Response.json({error:'Private page'},{status:403}),new AbortController().signal).body))output.push(event);
 assert.equal(output.at(-1).type,'error');assert.equal(output.at(-1).message,'Private page');
});
test('a client disconnect stops writes but the generation still completes and records progress',async()=>{
 const encoder=new TextEncoder(),client=new AbortController(),recorded=[];let release;const gate=new Promise(r=>release=r);
 const body=new ReadableStream({async start(c){c.enqueue(encoder.encode('data: {"type":"delta","text":"a"}\n\n'));await gate;c.enqueue(encoder.encode('data: {"type":"done","page":{"id":"saved"}}\n\n'));c.close();}});
 let runSignal;const response=answerStream(signal=>{runSignal=signal;return Promise.resolve(new Response(body,{headers:{'Content-Type':'text/event-stream'}}));},client.signal,'Finding…',{event:e=>recorded.push(e.type),finish:async()=>{}});
 const reader=readEvents(response.body);assert.equal((await reader.next()).value.type,'status');
 client.abort();await response.body.cancel().catch(()=>{});
 release();await new Promise(r=>setTimeout(r,50));
 assert.equal(runSignal.aborted,false,'generation keeps running after the client leaves');
 assert.ok(recorded.includes('done'),'progress records the saved page for later recovery');
});
