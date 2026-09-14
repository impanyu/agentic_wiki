import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readEvents} from '../app/event-stream.ts';

test('decodes split Chinese UTF-8, CRLF frames and heartbeat comments',async()=>{
 const bytes=new TextEncoder().encode(': heartbeat\r\n\r\ndata: {"text":"中国西南部"}\r\n\r\ndata: {"type":"done"}\n\ndata: [DONE]\n\n');
 let i=0;const stream=new ReadableStream({pull(c){i<bytes.length?c.enqueue(bytes.slice(i,i+=1)):c.close();}});
 const events=[];for await(const e of readEvents(stream))events.push(e);
 assert.deepEqual(events,[{text:'中国西南部'},{type:'done'}]);
});
test('rejects a truncated event instead of treating it as completion',async()=>{
 const stream=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('data: {"type":"done"'));c.close();}});
 await assert.rejects(async()=>{for await(const e of readEvents(stream))void e;},/ended unexpectedly/);
});
test('cancels the reader when the consumer stops',async()=>{
 let cancelled=false;
 const stream=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('data: {"type":"delta"}\n\n'));},cancel(){cancelled=true;}});
 for await(const e of readEvents(stream)){assert.equal(e.type,'delta');break;}
 assert.equal(cancelled,true);
});
