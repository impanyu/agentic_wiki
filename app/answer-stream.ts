import {readEvents} from './event-stream';
// Send headers and heartbeats before routing starts: routing may make several
// slow AI calls before the article generator produces its first event.
export function answerStream(run:(signal:AbortSignal,emit:(event:unknown)=>void)=>Promise<Response>,signal:AbortSignal,initialStatus='Finding the right page…',progress?:{event:(event:unknown)=>void;finish:()=>Promise<void>}){
 const lifetime=new AbortController(),combined=AbortSignal.any([signal,lifetime.signal]);
 const encoder=new TextEncoder();let timer:ReturnType<typeof setInterval>;
 const stream=new ReadableStream<Uint8Array>({
  start(controller){
   let closed=false;
   const send=(event:unknown)=>{progress?.event(event);if(!closed&&!combined.aborted)controller.enqueue(encoder.encode('data: '+JSON.stringify(event)+'\n\n'));};
   send({type:'status',message:initialStatus});
   timer=setInterval(()=>{try{send({type:'ping'});}catch{lifetime.abort();}},10000);
   void(async()=>{
    try{
     const started=Date.now();let response:Response;
     while(true){
      combined.throwIfAborted();response=await run(combined,send);
      if(response.status!==409)break;
      const pending=await response.clone().json() as {retryAfter?:number};
      if(!pending.retryAfter||Date.now()-started>240000)break;
      await response.body?.cancel();send({type:'status',message:'This question is being prepared. Opening it as soon as it is ready…'});
      await new Promise<void>((resolve,reject)=>{
       const abort=()=>{clearTimeout(wait);combined.removeEventListener('abort',abort);reject(combined.reason);};
       const wait=setTimeout(()=>{combined.removeEventListener('abort',abort);resolve();},Math.min(pending.retryAfter!,5)*1000);
       if(combined.aborted)abort();else combined.addEventListener('abort',abort,{once:true});
      });
     }
     if(response.ok&&response.headers.get('content-type')?.includes('text/event-stream')&&response.body){
      for await(const event of readEvents(response.body)){combined.throwIfAborted();send(event);if(event.type==='done'||event.type==='error')break;}
     }else{
      const result=await response.json() as {error?:string};
      send(response.ok?{...result,type:'done'}:{type:'error',message:result.error||'Could not open the page. Please try again.'});
     }
    }catch(error){if(!combined.aborted){console.error('Answer stream failed',error instanceof Error?error.message:'unknown');send({type:'error',message:'The connection to the answer service was interrupted. Please try again.'});}}
    finally{await progress?.finish();closed=true;clearInterval(timer);try{controller.close();}catch{}}
   })();
  },
  cancel(){clearInterval(timer);lifetime.abort();},
 });
 return new Response(stream,{headers:{'Content-Type':'text/event-stream; charset=utf-8','Content-Encoding':'identity','Cache-Control':'no-store, private, no-transform','Vary':'Cookie, Accept','X-Accel-Buffering':'no','X-Content-Type-Options':'nosniff'}});
}
