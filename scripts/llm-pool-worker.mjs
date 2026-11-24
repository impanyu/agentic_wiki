#!/usr/bin/env node
// RankWiki model-pool worker: runs next to a local OpenAI-compatible model server (vLLM, SGLang, Ollama, llama.cpp)
// on one of our own GPUs — a lab machine or an HCC Swan job — and answers the agents' model calls by PULLING them from
// RankWiki over outbound HTTPS. No inbound port, no tunnel. No dependencies (Node 18+).
//
//   RANKWIKI_URL=https://rankwiki.aisoup.net LLM_POOL_TOKEN=… LOCAL_BASE=http://127.0.0.1:8000/v1 LOCAL_MODEL=<served model name> \
//   POOL_MODEL=local CONCURRENCY=8 node llm-pool-worker.mjs
//
// POOL_MODEL is the name the agents ask for (app/llm/catalog.ts: pool:local → "local"); LOCAL_MODEL is the model name
// the local server serves. Stop with Ctrl-C (claimed requests are answered first).
import {hostname} from 'node:os';
const env=k=>process.env[k]||'';
const URL_=env('RANKWIKI_URL')||'https://rankwiki.aisoup.net',TOKEN=env('LLM_POOL_TOKEN'),LOCAL=env('LOCAL_BASE')||'http://127.0.0.1:8000/v1';
const LOCAL_MODEL=env('LOCAL_MODEL'),POOL_MODEL=env('POOL_MODEL')||'local',SLOTS=Math.max(1,Number(env('CONCURRENCY')||8));
const WORKER=env('WORKER_ID')||(hostname()+'-'+process.pid),LOCAL_KEY=env('LOCAL_API_KEY')||'none';
if(!TOKEN||!LOCAL_MODEL){console.error('Set LLM_POOL_TOKEN and LOCAL_MODEL (see the header of this file).');process.exit(1);}
let busy=0,stopping=false,done=0,failed=0;
const post=(path,body,signal)=>fetch(URL_+path,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+TOKEN},body:JSON.stringify(body),signal});
async function answer(job){
 busy++;const t0=Date.now();
 try{
  const r=await fetch(LOCAL+'/chat/completions',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+LOCAL_KEY},
   body:JSON.stringify({...job.body,model:LOCAL_MODEL,stream:false}),signal:AbortSignal.timeout(280_000)});
  const text=await r.text();let data;try{data=JSON.parse(text);}catch{throw Error('local server: HTTP '+r.status+' '+text.slice(0,200));}
  if(!r.ok||data.error)throw Error('local server: HTTP '+r.status+' '+JSON.stringify(data.error||data).slice(0,300));
  await post('/api/llm/pool/result',{worker:WORKER,id:job.id,ok:true,response:data});done++;
  console.log(new Date().toISOString(),'answered',job.id.slice(0,8),((Date.now()-t0)/1000).toFixed(1)+'s',data.usage?`in ${data.usage.prompt_tokens} out ${data.usage.completion_tokens}`:'');
 }catch(e){failed++;console.warn(new Date().toISOString(),'failed',job.id.slice(0,8),e.message);
  await post('/api/llm/pool/result',{worker:WORKER,id:job.id,ok:false,error:e.message}).catch(()=>{});}
 finally{busy--;}
}
let lastWaitAt=0,lastWait=0;
async function localWaiting(){
 if(Date.now()-lastWaitAt<1500)return lastWait;lastWaitAt=Date.now();
 try{const r=await fetch(LOCAL.replace(/\/v1\/?$/,'')+'/metrics',{signal:AbortSignal.timeout(3000)});if(!r.ok)return lastWait=0;
  const m=/^vllm:num_requests_waiting\{[^}]*\}\s+([0-9.e+]+)/m.exec(await r.text());return lastWait=m?Number(m[1]):0;}
 catch{return lastWait=0;}
}
async function loop(){
 console.log(`worker ${WORKER}: ${SLOTS} slots, serving "${POOL_MODEL}" with ${LOCAL_MODEL} at ${LOCAL}, pulling from ${URL_}`);
 while(!stopping){
  // A local server that already queues requests (vLLM's num_requests_waiting) takes no more: waiting here would only
  // add latency, while an unclaimed request goes on to the next model within seconds.
  const queued=await localWaiting();
  const free=queued>0?0:SLOTS-busy;
  try{
   const r=await post('/api/llm/pool/claim',{worker:WORKER,models:[POOL_MODEL],max:free,info:{local:LOCAL_MODEL,slots:SLOTS,busy,done,failed}},AbortSignal.timeout(40_000));
   if(!r.ok){console.warn('claim: HTTP',r.status,(await r.text()).slice(0,200));await new Promise(s=>setTimeout(s,10_000));continue;}
   const {jobs=[]}=await r.json();
   for(const j of jobs)void answer(j);
   // All slots busy: only a heartbeat every 30 s; otherwise ask again at once (the claim itself waits for work).
   if(free<=0)await new Promise(s=>setTimeout(s,queued>0?2_000:30_000));
   else if(!jobs.length)await new Promise(s=>setTimeout(s,200));
  }catch(e){console.warn('claim failed:',e.message);await new Promise(s=>setTimeout(s,10_000));}
 }
 while(busy)await new Promise(s=>setTimeout(s,500));
 console.log(`stopped: ${done} answered, ${failed} failed`);
}
process.on('SIGINT',()=>{if(stopping)process.exit(1);stopping=true;console.log('stopping after the requests in progress…');});
process.on('SIGTERM',()=>{stopping=true;});
loop();
