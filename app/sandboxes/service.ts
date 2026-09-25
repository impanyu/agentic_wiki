import {env} from '@/server/runtime';
import {database,lock,unlock,aiKey,model} from '@/db/store';
import {getComponent,type AgentContext} from '@/app/components-registry/registry';
import {codeSchema,desktopActionSchema,assertSession,type CodeProgram} from './contracts';
import {e2bProvider} from './provider';
import {runOpenAIProgram,OpenAISandboxError} from './openai-provider';
const setting=(name:string)=>(env as unknown as Record<string,string>)[name]||process.env[name]||'';
export function sandboxStatus(userId:string){return {configured:!!aiKey(),allowed:!userId.startsWith('guest:')&&(!setting('SANDBOX_ALLOWED_USERS')||setting('SANDBOX_ALLOWED_USERS').split(',').map(s=>s.trim()).includes(userId)),internet:setting('SANDBOX_GUI_INTERNET')==='true',provider:'openai',desktopProvider:'e2b',desktopConfigured:!!setting('E2B_API_KEY'),codeTimeoutSeconds:30,desktopLifetimeSeconds:600};}
function access(context:Pick<AgentContext,'userId'|'agent'>,desktop=false){if(context.agent&&context.agent.ownerId!==context.userId)throw new Error('AGENT_PRINCIPAL_MISMATCH');const status=sandboxStatus(context.userId);if(!status.allowed)throw new Error('SANDBOX_SIGN_IN_REQUIRED');if(desktop?!status.desktopConfigured:!status.configured)throw new Error(desktop?'DESKTOP_NOT_CONFIGURED':'SANDBOX_NOT_CONFIGURED');return desktop?setting('E2B_API_KEY'):aiKey();}
type Session={id:string;owner_id:string;provider_id:string;kind:string;state:string;created_at:number;expires_at:number};
async function reserve(userId:string,kind:'code'|'desktop'){
 const lease=await lock('sandbox-create:'+userId,120000);if(!lease)throw new Error('SANDBOX_BUSY');
 try{const row=await database().prepare('SELECT count(*) n FROM sandbox_sessions WHERE owner_id=? AND created_at>?').bind(userId,Date.now()-86400000).first<{n:number}>();if((row?.n||0)>=100)throw new Error('SANDBOX_DAILY_LIMIT');
 const active=await database().prepare("SELECT count(*) n FROM sandbox_sessions WHERE owner_id=? AND state IN ('starting','active','cleanup_pending') AND expires_at>?").bind(userId,Date.now()).first<{n:number}>();if((active?.n||0)>=2)throw new Error('SANDBOX_CONCURRENCY_LIMIT');
 const id=crypto.randomUUID(),now=Date.now();await database().prepare("INSERT INTO sandbox_sessions(id,owner_id,provider_id,kind,state,created_at,expires_at) VALUES(?,?,'',?,'starting',?,?)").bind(id,userId,kind,now,now+(kind==='desktop'?600000:240000)).run();return id;
 }finally{await unlock(lease);}
}
async function state(id:string,status:string,providerId?:string){await database().prepare('UPDATE sandbox_sessions SET state=?,provider_id=COALESCE(?,provider_id) WHERE id=?').bind(status,providerId??null,id).run();}
export async function runProgram(raw:unknown,input:unknown,context:Pick<AgentContext,'userId'|'agent'>,uploads:{path:string;data:ArrayBuffer}[]=[]){
 if(uploads.some(f=>!/^\/home\/user\/context\/[a-zA-Z0-9._-]+$/.test(f.path))||uploads.reduce((n,f)=>n+f.data.byteLength,0)>40*1024*1024)throw Error('INVALID_CONTEXT_FILES');
 const apiKey=access(context),program=codeSchema.parse(raw);
 // A located syntax error is far more useful to a coding agent than the runtime's bare message.
 if(program.language==='javascript'){const check=await import('./syntax-check').catch(()=>null);const problem=check?.javascriptSyntaxDiagnosis(program.code);if(problem)return {ok:false as const,stdout:'',stderr:problem,result:null};}
 if(program.language==='javascript'&&process.env.SANDBOX_LOCAL_JS!=='false'){const local=await import('./local-js');if(local.localJsAvailable())return local.runLocalJs(program,input,uploads);}
 const id=await reserve(context.userId,'code');let cleanupPending=false;
 // A hosted run occasionally completes without publishing its result file; one retry recovers it.
 const once=()=>runOpenAIProgram(program,input,uploads,apiKey,setting('OPENAI_SANDBOX_MODEL')||model('page-backend-coding'),async providerId=>state(id,'active',providerId),async providerId=>{cleanupPending=true;await state(id,'cleanup_pending',providerId);});
 try{let result;try{result=await once();}catch(e){if(!(e instanceof OpenAISandboxError&&e.code==='OPENAI_SANDBOX_RESULT_MISSING'))throw e;console.error('Sandbox result missing; retrying once');result=await once();}return {...result,...(cleanupPending?{cleanupPending:true}:{})};}
 catch(e){if(e instanceof OpenAISandboxError)throw e;throw new Error('OPENAI_SANDBOX_EXECUTION_FAILED');}
 finally{if(!cleanupPending)await state(id,'closed').catch(()=>{});}
}

export async function executeCodeComponent(ref:{id:string;version:number},input:unknown,context:Pick<AgentContext,'userId'|'agent'>){const component=await getComponent(ref,context,'backend_code');return runProgram(JSON.parse(component.payload),input,context);}
export async function createDesktop(context:Pick<AgentContext,'userId'|'agent'>){const apiKey=access(context,true),id=await reserve(context.userId,'desktop');let desktop:Awaited<ReturnType<typeof e2bProvider.createDesktop>>|undefined;
 try{desktop=await e2bProvider.createDesktop(apiKey,sandboxStatus(context.userId).internet);await state(id,'active',desktop.sandboxId);return {id,expiresAt:Date.now()+600000};}catch{if(desktop)await desktop.kill().catch(()=>{});await state(id,'failed');throw new Error('SANDBOX_PROVIDER_FAILED');}}
async function owned(id:string,userId:string){const row=await database().prepare('SELECT * FROM sandbox_sessions WHERE id=? AND owner_id=?').bind(id,userId).first<Session>();assertSession(row,userId);if(row!.kind!=='desktop')throw new Error('NOT_DESKTOP');return row!;}
export async function screenshot(id:string,context:Pick<AgentContext,'userId'|'agent'>){const key=access(context,true),row=await owned(id,context.userId);try{const d=await e2bProvider.connectDesktop(row.provider_id,key);const bytes=await d.screenshot();if(bytes.length>4000000)throw new Error();return bytes;}catch{throw new Error('SANDBOX_SCREENSHOT_FAILED');}}
export async function desktopAction(id:string,raw:unknown,context:Pick<AgentContext,'userId'|'agent'>){const key=access(context,true),row=await owned(id,context.userId),action=desktopActionSchema.parse(raw);const lease=await lock('desktop-action:'+id,45000);if(!lease)throw new Error('SANDBOX_BUSY');try{const d=await e2bProvider.connectDesktop(row.provider_id,key);await e2bProvider.action(d,action);return {ok:true};}catch{throw new Error('SANDBOX_ACTION_FAILED');}finally{await unlock(lease);}}
export async function closeDesktop(id:string,context:Pick<AgentContext,'userId'|'agent'>){const key=access(context,true);const row=await database().prepare('SELECT * FROM sandbox_sessions WHERE id=? AND owner_id=?').bind(id,context.userId).first<Session>();if(!row)throw new Error('SANDBOX_NOT_FOUND');if(row.provider_id)try{await e2bProvider.kill(row.provider_id,key);}catch{throw new Error('SANDBOX_STOP_FAILED');}await state(id,'closed');}
