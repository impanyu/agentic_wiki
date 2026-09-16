// Provider-independent Responses loop. Preserve every output item (including
// reasoning items) and pair every function call with its own result.
export type LoopEvent={kind:'started'|'tool_started'|'tool_finished'|'completed'|'failed'|'model_finished'|'validation_failed';data:unknown};
export type ToolResult={data:unknown;parts?:unknown[]};
export async function runToolLoop(options:{
 payload:Record<string,any>;request:(payload:Record<string,any>)=>Promise<any>;
 execute:(name:string,args:any)=>Promise<ToolResult>;event?:(event:LoopEvent)=>Promise<void>;
 validateFinal?:(response:any,trace:{webSearched:boolean})=>Promise<string|void>;
 signal?:AbortSignal;maxRounds?:number;maxCalls?:number;
}){
 const {payload,request,execute,event}=options;
 const timeout=AbortSignal.timeout(600000),signal=options.signal?AbortSignal.any([options.signal,timeout]):timeout;
 const maxRounds=options.maxRounds??24,maxCalls=options.maxCalls??48;
 let callsUsed=0,webSearched=false,limited=false,waiting=false;
 const seen=new Map<string,{signature:string;result:ToolResult}>();
 payload.input=typeof payload.input==='string'?[{role:'user',content:payload.input}]:[...(payload.input||[])];
 await event?.({kind:'started',data:{maxRounds,maxCalls}});
 try{
  for(let round=0;round<=maxRounds;round++){
   signal?.throwIfAborted();
   if(round===maxRounds||callsUsed>=maxCalls||payload.input.reduce((n:number,i:any)=>n+(typeof i.content==='string'?i.content.length:Array.isArray(i.content)?i.content.reduce((m:number,c:any)=>m+(typeof c.text==='string'?c.text.length:0),0):String(i.output||i.arguments||'').length),0)>180000){payload.tool_choice='none';limited=true;payload.input.push({role:'user',content:'Execution budget reached. Return an honest final result with completed work, remaining work and any pending approvals. Do not claim unfinished work completed.'});}
   const started=Date.now();
   const response=await request(payload);
   await event?.({kind:'model_finished',data:{round:round+1,model:payload.model,reasoning:payload.reasoning?.effort,durationMs:Date.now()-started,usage:response.usage}});
   if(payload.tool_choice==='required')payload.tool_choice='auto';
   signal?.throwIfAborted();
   if(response.status==='incomplete'||response.status==='failed')throw Error('AGENT_RESPONSE_INCOMPLETE');
   webSearched ||= !!response.output?.some((item:any)=>item.type==='web_search_call'&&item.status==='completed');
   const calls=(response.output||[]).filter((item:any)=>item.type==='function_call');
   if(!calls.length&&options.validateFinal){const error=await options.validateFinal(response,{webSearched});if(error){await event?.({kind:'validation_failed',data:{error}});if(limited||round===maxRounds)throw Error('AGENT_INVALID_FINAL');payload.input.push(...(response.output||[]),{role:'user',content:'Draft validation failed: '+error+'. Correct the draft or use tools as needed. Return only a valid complete result.'});continue;}}
   if(!calls.length){await event?.({kind:'completed',data:{rounds:round+1,calls:callsUsed,status:waiting?'waiting_for_approval':limited?'limited':'completed'}});return {response,webSearched,limited,waiting};}
   if(round===maxRounds)throw Error('AGENT_TOOL_BUDGET');
   payload.input.push(...response.output);
   for(const call of calls){
    signal?.throwIfAborted();
    if(typeof call.call_id!=='string'||!call.call_id)throw Error('AGENT_INVALID_CALL');
    const signature=call.name+'\n'+call.arguments,prior=seen.get(call.call_id);
    if(prior&&prior.signature!==signature)throw Error('AGENT_CALL_ID_CONFLICT');
    let result:ToolResult;
    if(prior)result=prior.result;
    else if(callsUsed>=maxCalls)result={data:{error:'Tool budget reached. This action was not executed.'}};
    else{
     callsUsed++;
     await event?.({kind:'tool_started',data:{callId:call.call_id,tool:call.name,arguments:call.arguments}});
     try{result=await execute(call.name,JSON.parse(call.arguments));}
     catch(error){if(signal?.aborted)throw error;result={data:{error:error instanceof Error?error.message:'Tool failed'}};}
     // Persist before asking the model to continue. A failed journal write stops
     // the run; it must never silently replay an external side effect.
     await event?.({kind:'tool_finished',data:{callId:call.call_id,tool:call.name,result:result.data}});
     seen.set(call.call_id,{signature,result});
    }
    waiting ||= !!(result.data&&typeof result.data==='object'&&(result.data as any).confirmationRequired);
    const serialized=JSON.stringify(result.data)??'null';
    payload.input.push({type:'function_call_output',call_id:call.call_id,output:serialized.length>24000?JSON.stringify({truncated:true,excerpt:serialized.slice(0,22000),instruction:'Request a narrower query or paginate to retrieve omitted results.'}):serialized});
    if(result.parts?.length)payload.input.push({role:'user',content:result.parts});
   }
  }
  throw Error('AGENT_TOOL_BUDGET');
 }catch(error){await event?.({kind:'failed',data:{status:signal?.aborted?'cancelled':'failed',error:error instanceof Error?error.message:'Agent failed'}});throw error;}
}
