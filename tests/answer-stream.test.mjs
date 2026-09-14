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
