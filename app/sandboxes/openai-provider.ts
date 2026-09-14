import {executionFiles,type CodeProgram} from './contracts';
type Upload={path:string;data:ArrayBuffer};
type Execution={ok:boolean;stdout:string;stderr:string;result:unknown};
const BASE='https://api.openai.com/v1';
const REPORT='/workspace/outputs/execution.json';
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
export class OpenAISandboxError extends Error {constructor(public code:string){super(code);}}
function encoded(data:string|ArrayBuffer){const bytes=typeof data==='string'?new TextEncoder().encode(data):new Uint8Array(data);let raw='';for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(raw);}
export function hostedExecution(program:CodeProgram,input:unknown,uploads:Upload[]){
 // Keep older saved attachment references usable in the new workspace layout.
 const remap=(value:unknown):unknown=>typeof value==='string'?value.replace(/^\/home\/user\/context\//,'/workspace/context/'):Array.isArray(value)?value.map(remap):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,remap(v)])):value;
 const prepared=executionFiles(program,remap(input),'/workspace');
 const launcher=`import json, os, subprocess, resource\nfrom pathlib import Path\nos.makedirs('/workspace/outputs',exist_ok=True)\ndef limits():\n    resource.setrlimit(resource.RLIMIT_FSIZE,(262144,262144))\n    resource.setrlimit(resource.RLIMIT_CPU,(30,30))\nresult={'ok':False,'stdout':'','stderr':'','result':None}\ntry:\n    with open('/workspace/stdout.log','wb') as out, open('/workspace/stderr.log','wb') as err:\n        process=subprocess.Popen(${JSON.stringify(program.language==='python'?['python3','/workspace/run.py']:['node','/workspace/run.mjs'])},cwd='/workspace',stdout=out,stderr=err,preexec_fn=limits,start_new_session=True)\n        try: code=process.wait(timeout=30)\n        except subprocess.TimeoutExpired:\n            import signal\n            os.killpg(process.pid,signal.SIGKILL)\n            process.wait()\n            code=-1\n    result['stdout']=Path('/workspace/stdout.log').read_bytes()[:12000].decode('utf-8','replace')\n    result['stderr']=Path('/workspace/stderr.log').read_bytes()[:12000].decode('utf-8','replace')\n    if code!=0: raise ValueError('Program failed or exceeded its 30-second execution limit.')\n    p=Path('/workspace/result.json')\n    if p.stat().st_size>128000: raise ValueError('Result exceeds 128 KB.')\n    result['result']=json.loads(p.read_text(),parse_constant=lambda x: (_ for _ in ()).throw(ValueError('Non-finite JSON number')))\n    result['ok']=True\nexcept Exception as exc:\n    result['stderr']=(result['stderr']+'\\n'+str(exc))[:12000]\nPath('${REPORT}').write_text(json.dumps(result,allow_nan=False))\n`;
 return [...prepared.files,{path:'/workspace/execute.py',data:launcher},...uploads.map(f=>({...f,path:f.path.replace(/^\/home\/user\//,'/workspace/')}))];
}
export async function runOpenAIProgram(program:CodeProgram,input:unknown,uploads:Upload[],apiKey:string,model:string,onSession:(id:string)=>Promise<void>,onCleanupFailure:(id:string)=>Promise<void>=async()=>{}){
 const headers={Authorization:'Bearer '+apiKey,'OpenAI-Beta':'agents=v1'};
 const deadline=AbortSignal.timeout(180000);let sessionId='',turnId='';const uploaded:string[]=[];
 async function call(path:string,method='GET',body?:unknown,cleanup=false){
  const response=await fetch(BASE+path,{method,headers:{...headers,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:cleanup?AbortSignal.timeout(15000):deadline});
  if(!response.ok){await response.body?.cancel();const code=response.status===401||response.status===403?'OPENAI_SANDBOX_ACCESS_REQUIRED':response.status===429?'OPENAI_SANDBOX_LIMIT':response.status===409?'OPENAI_SANDBOX_BUSY':'OPENAI_SANDBOX_REQUEST_FAILED';throw new OpenAISandboxError(code);}
  return response;
 }
 try{
  const files=hostedExecution(program,input,uploads);if(files.length>50)throw new OpenAISandboxError('OPENAI_SANDBOX_FILE_LIMIT');
  const environmentFiles:unknown[]=[];let inlineBytes=0;
  for(const f of files){
   const bytes=typeof f.data==='string'?new TextEncoder().encode(f.data):new Uint8Array(f.data);
   if(bytes.byteLength<=5*1024*1024&&inlineBytes+bytes.byteLength<=9*1024*1024){environmentFiles.push({type:'inline',path:f.path,data:encoded(f.data)});inlineBytes+=bytes.byteLength;}
   else{
    const form=new FormData();form.set('purpose','user_data');form.set('expires_after[anchor]','created_at');form.set('expires_after[seconds]','3600');form.set('file',new Blob([bytes]),f.path.split('/').at(-1)!);
    const r=await fetch(BASE+'/files',{method:'POST',headers:{Authorization:headers.Authorization},body:form,signal:deadline});
    if(!r.ok)throw new OpenAISandboxError('OPENAI_SANDBOX_UPLOAD_FAILED');const file=await r.json() as {id:string};uploaded.push(file.id);environmentFiles.push({type:'file_id',path:f.path,file_id:file.id});
   }
  }
  const session=await (await call('/agents/sessions','POST',{
   agent:{model,instructions:'The application already executed its saved backend during environment setup. Do not run, inspect, modify, or repair any files or programs. Reply only: completed.',tools:[]},
   environment:{type:'openai_hosted',network:{access:'disabled'},files:environmentFiles,setup_commands:[{command:'python3 /workspace/execute.py',cwd:'/workspace'}]},
   input:'Acknowledge completion. Do not call tools.',stream:false,
  })).json() as {id:string};
  sessionId=session.id;await onSession(sessionId);
  // Poll persisted turns, not session.idle: provisioning and failed turns may be idle.
  while(!turnId){
   deadline.throwIfAborted();
   const turns=await (await call('/agents/sessions/'+encodeURIComponent(sessionId)+'/turns?limit=1&order=desc')).json() as {data:{id:string;status:string;error?:{code:string}}[]};
   const turn=turns.data[0];
   if(turn?.status==='completed'){turnId=turn.id;break;}
   if(turn&&['failed','cancelled'].includes(turn.status))throw new OpenAISandboxError('OPENAI_SANDBOX_TURN_FAILED');
   const current=await (await call('/agents/sessions/'+encodeURIComponent(sessionId))).json() as {status:string};
   if(current.status==='failed'||current.status==='requires_action')throw new OpenAISandboxError('OPENAI_SANDBOX_SETUP_FAILED');
   await pause(1000);
  }
  let artifact:{id:string;size_bytes:number}|undefined,after='';
  do{
   const list=await (await call('/agents/sessions/'+encodeURIComponent(sessionId)+'/artifacts?limit=100'+(after?'&after='+encodeURIComponent(after):''))).json() as {data:{id:string;path:string;turn_id:string;size_bytes:number}[];has_more:boolean};
   artifact=list.data.find(a=>a.path===REPORT&&a.turn_id===turnId);if(artifact||!list.has_more)break;after=list.data.at(-1)!.id;
  }while(after);
  if(!artifact||artifact.size_bytes>256000)throw new OpenAISandboxError('OPENAI_SANDBOX_RESULT_MISSING');
  const response=await call('/agents/sessions/'+encodeURIComponent(sessionId)+'/artifacts/'+encodeURIComponent(artifact.id)+'/content');
  const reader=response.body!.getReader();let size=0,text='';const decoder=new TextDecoder();
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>256000)throw new OpenAISandboxError('OPENAI_SANDBOX_RESULT_TOO_LARGE');text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}finally{await reader.cancel().catch(()=>{});}
  const result=JSON.parse(text) as Execution;
  if(typeof result.ok!=='boolean'||typeof result.stdout!=='string'||typeof result.stderr!=='string'||!Object.hasOwn(result,'result')||JSON.stringify(result.result).length>128000)throw new OpenAISandboxError('OPENAI_SANDBOX_RESULT_INVALID');
  return {...result,stdout:result.stdout.slice(0,12000),stderr:result.stderr.slice(0,12000)};
 }finally{
  if(sessionId){let closed=false;for(let attempt=0;attempt<3;attempt++){try{await call('/agents/sessions/'+encodeURIComponent(sessionId),'DELETE',undefined,true);closed=true;break;}catch{await call('/agents/sessions/'+encodeURIComponent(sessionId)+'/events','POST',{events:[{type:'agent.session.input.cancel'}]},true).catch(()=>{});await pause(1000*(attempt+1));}}if(!closed)await onCleanupFailure(sessionId);}
  for(const id of uploaded)await call('/files/'+encodeURIComponent(id),'DELETE',undefined,true).catch(()=>{});
 }
}
