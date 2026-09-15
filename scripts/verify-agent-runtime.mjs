// Optional bounded live check. Uses the existing server credential without logging it.
import assert from 'node:assert/strict';
import {runToolLoop} from '../app/agent-runtime/loop.ts';
if(!process.env.OPENAI_API_KEY)throw Error('OPENAI_API_KEY is required');
const receipt=crypto.randomUUID();let calculated=false,verified=false,requests=0;
const tool=(name,description,properties)=>({type:'function',name,description,strict:true,parameters:{type:'object',additionalProperties:false,properties,required:Object.keys(properties)}});
const result=await runToolLoop({maxRounds:5,maxCalls:5,payload:{model:process.env.OPENAI_MODEL||'gpt-5.4-mini',store:false,input:'Multiply 17 by 23 with calculate, then pass its receipt to verify. Only after verification return the product in a short final response.',tools:[tool('calculate','Multiply two numbers and issue a receipt.',{a:{type:'number'},b:{type:'number'}}),tool('verify','Verify the receipt returned by calculate.',{receipt:{type:'string'}})],max_output_tokens:800},request:async payload=>{
 requests++;const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+process.env.OPENAI_API_KEY},body:JSON.stringify(payload),signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error('OpenAI HTTP '+r.status);return r.json();
},execute:async(name,args)=>{
 if(name==='calculate'){assert.equal(args.a,17);assert.equal(args.b,23);calculated=true;return {data:{product:391,receipt}};}
 if(name==='verify'){assert.ok(calculated);assert.equal(args.receipt,receipt);verified=true;return {data:{verified:true,product:391}};}
 throw Error('Unknown tool');
}});
assert.ok(verified);assert.ok(result.response.output.some(o=>o.type==='message'));console.log(JSON.stringify({liveAgentLoop:'passed',requests,calculated,verified}));
