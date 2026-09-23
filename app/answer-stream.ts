import {readEvents} from './event-stream';
// Send headers and heartbeats before routing starts: routing may make several
// slow AI calls before the article generator produces its first event.
// A client disconnect (background tab, suspended mobile browser, proxy idle
// close) must NOT cancel the generation: the run continues to completion and
// its progress record lets the client recover the saved page by generationId.
// Explicit cancellation goes through DELETE /api/ask with the cancel token.
export function answerStream(run:(signal:AbortSignal,emit:(event:unknown)=>void)=>Promise<Response>,signal:AbortSignal,initialStatus='Finding the right page…',progress?:{event:(event:unknown)=>void;finish:()=>Promise<void>}){
 const lifetime=new AbortController();
 const encoder=new TextEncoder();let timer:ReturnType<typeof setInterval>|undefined,closed=false;
 const detach=()=>{closed=true;if(timer)clearInterval(timer);};
 if(signal.aborted)detach();else signal.addEventListener('abort',detach,{once:true});
 const stream=new ReadableStream<Uint8Array>({
  start(controller){
   const send=(event:unknown)=>{progress?.event(event);if(!closed){try{controller.enqueue(encoder.encode('data: '+JSON.stringify(event)+'\n\n'));}catch{detach();}}};
   send({type:'status',message:initialStatus});
   timer=setInterval(()=>send({type:'ping'}),10000);
   void(async()=>{
    try{
     const started=Date.now();let response:Response;
     while(true){
      lifetime.signal.throwIfAborted();response=await run(lifetime.signal,send);
      if(response.status!==409)break;
      const pending=await response.clone().json() as {retryAfter?:number};
      if(!pending.retryAfter||Date.now()-started>240000)break;
      await response.body?.cancel();send({type:'status',message:'This question is being prepared. Opening it as soon as it is ready…'});
      await new Promise<void>(resolve=>setTimeout(resolve,Math.min(pending.retryAfter!,5)*1000));
     }
     if(response.ok&&response.headers.get('content-type')?.includes('text/event-stream')&&response.body){
      for await(const event of readEvents(response.body)){send(event);if(event.type==='done'||event.type==='error')break;}
     }else{
      const result=await response.json() as {error?:string};
      send(response.ok?{...result,type:'done'}:{type:'error',message:result.error||'Could not open the page. Please try again.'});
     }
    }catch(error){console.error('Answer stream failed',error instanceof Error?error.message:'unknown');send({type:'error',message:'The connection to the answer service was interrupted. Please try again.'});}
    finally{await progress?.finish();detach();signal.removeEventListener('abort',detach);try{controller.close();}catch{}}
   })();
  },
  // The consumer went away; keep generating, just stop writing to it.
  cancel(){detach();},
 });
 return new Response(stream,{headers:{'Content-Type':'text/event-stream; charset=utf-8','Content-Encoding':'identity','Cache-Control':'no-store, private, no-transform','Vary':'Cookie, Accept','X-Accel-Buffering':'no','X-Content-Type-Options':'nosniff'}});
}
