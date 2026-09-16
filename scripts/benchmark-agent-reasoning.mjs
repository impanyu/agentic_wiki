// Bounded public/synthetic benchmark. No external account tools or writes are used.
import assert from 'node:assert/strict';
import {runToolLoop} from '../app/agents/loop.ts';
if(!process.env.OPENAI_API_KEY)throw Error('Existing OPENAI_API_KEY required');
const fn=(name,description,properties)=>({type:'function',name,description,strict:true,parameters:{type:'object',additionalProperties:false,properties,required:Object.keys(properties)}});
const request=async body=>{const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+process.env.OPENAI_API_KEY,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(90000)});if(!r.ok){const e=await r.json();throw Error('OpenAI HTTP '+r.status+': '+String(e.error?.message).slice(0,500));}return r.json();};
const text=r=>r.output.filter(x=>x.type==='message').flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('');
for(const effort of ['low','medium']){
 let calls=0,listed=false,verified=false;const start=Date.now(),usage=[];
 const result=await runToolLoop({maxRounds:5,maxCalls:5,payload:{model:'gpt-5.6-terra',store:false,reasoning:{effort},include:['reasoning.encrypted_content'],instructions:'Use the enabled connector tools to fulfill the user request. Choose the correct provider, inspect tools, then report the exact files. Do not use the wrong connector or invent files.',input:'List my ADMA files. Enabled connectors: google (Google Drive), adma (ADMA).',tools:[fn('inspect_connector','Return available tools for a connector.',{id:{type:'string'}}),fn('call_connector','Call a tool from the inspected connector.',{id:{type:'string'},tool:{type:'string'}})],text:{format:{type:'json_schema',name:'files',strict:true,schema:{type:'object',additionalProperties:false,properties:{files:{type:'array',items:{type:'string'}}},required:['files']}}},max_output_tokens:3000},request:async p=>{calls++;const r=await request(p);usage.push(r.usage);return r;},execute:async(name,args)=>{
  assert.equal(args.id,'adma');
  if(name==='inspect_connector'){listed=true;return {data:{tools:['list_files']}};}
  assert.ok(listed);assert.equal(args.tool,'list_files');verified=true;return {data:{files:['field-notes.csv','soil-map.png']}};
 }});
 assert.ok(verified);assert.deepEqual(JSON.parse(text(result.response)).files,['field-notes.csv','soil-map.png']);
 console.log(JSON.stringify({task:'connector_selection_loop',effort,passed:true,durationMs:Date.now()-start,modelCalls:calls,usage}));
 const began=Date.now();let repairs=0;const expressionRun=await runToolLoop({maxRounds:4,maxCalls:1,request,execute:async()=>{throw Error('No tools');},validateFinal:async response=>{try{JSON.parse(JSON.parse(text(response)).programJson);}catch{repairs++;return 'programJson must contain exactly one valid JSON object. Fix the JSON syntax.';}},payload:{model:'gpt-5.6-terra',store:false,reasoning:{effort},instructions:'Return the minimal JSON expression program for the requested reusable calculator. Expressions are number literals, {input:field}, or {op:"add"|"subtract"|"multiply"|"divide",args:[expressions]}. Put the JSON expression program in the programJson string.',input:'A percentage change calculator: inputs before and after; output percent = (after-before)/before * 100. Name the output percent. Return {kind:"expression-program",outputs:{percent:expression}}.',text:{format:{type:'json_schema',name:'program',strict:true,schema:{type:'object',additionalProperties:false,properties:{programJson:{type:'string'}},required:['programJson']}}},max_output_tokens:3000}});const r=expressionRun.response;
 const p=JSON.parse(JSON.parse(text(r)).programJson);assert.equal(p.kind,'expression-program');
 const evaluate=(v,inputs)=>{if(typeof v==='number')return v;if(v.input)return inputs[v.input];const [a,b]=v.args.map(x=>evaluate(x,inputs));switch(v.op){case 'subtract':return a-b;case 'divide':return a/b;case 'multiply':return a*b;case 'add':return a+b;default:throw Error('Invalid operation');}};
 for(const [before,after,expected] of [[80,100,25],[100,70,-30],[10,10,0]])assert.ok(Math.abs(evaluate(p.outputs.percent,{before,after})-expected)<1e-8);
 console.log(JSON.stringify({task:'expression_generation',effort,passed:true,repairs,durationMs:Date.now()-began,usage:r.usage}));
}
