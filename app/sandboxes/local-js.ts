import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,basename} from 'node:path';
import type {CodeProgram} from './contracts';

// Runs a JavaScript page program on this server in a locked-down child process:
// a fresh network namespace (no network at all), Node's permission model (reads
// and writes only inside its own temporary folder, no child processes, workers
// or native addons), a 30-second wall clock and a 256 MB heap. A hosted sandbox
// takes about 90 seconds to start per step; this takes well under one.
type Upload={path:string;data:ArrayBuffer};
let available:boolean|undefined;
export function localJsAvailable(){
 if(process.env.SANDBOX_LOCAL_JS==='false')return false;
 if(available===undefined){try{available=spawnSync('unshare',['-rn','true'],{timeout:5000}).status===0;}catch{available=false;}}
 return available;
}
let running=0;const waiting:(()=>void)[]=[];
async function slot(){if(running>=4)await new Promise<void>(resolve=>waiting.push(resolve));running++;}
function release(){running--;waiting.shift()?.();}

export async function runLocalJs(program:CodeProgram,input:unknown,uploads:Upload[]){
 await slot();const dir=await mkdtemp(join(tmpdir(),'agenticwiki-program-'));
 try{
  const context=join(dir,'context');await mkdir(context);
  for(const file of uploads)await writeFile(join(context,basename(file.path)),new Uint8Array(file.data));
  // Saved inputs may point at the hosted sandbox's context folder.
  const remap=(value:unknown):unknown=>typeof value==='string'?value.replace(/^\/(?:home\/user|workspace)\/context\//,context+'/'):Array.isArray(value)?value.map(remap):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,remap(v)])):value;
  await writeFile(join(dir,'input.json'),JSON.stringify(remap(input)));
  await writeFile(join(dir,'program.mjs'),program.code);
  await writeFile(join(dir,'run.mjs'),`import {readFileSync,writeFileSync} from 'node:fs';\nimport {main} from './program.mjs';\nconst result=await main(JSON.parse(readFileSync(${JSON.stringify(join(dir,'input.json'))},'utf8')));\nwriteFileSync(${JSON.stringify(join(dir,'result.json'))},JSON.stringify(result));\n`);
  const args=['-rn',process.execPath,'--permission','--allow-fs-read='+dir,'--allow-fs-write='+dir,'--max-old-space-size=256','--disallow-code-generation-from-strings',join(dir,'run.mjs')];
  const {code,stdout,stderr}=await new Promise<{code:number|null;stdout:string;stderr:string}>(resolve=>{
   const child=spawn('unshare',args,{cwd:dir,env:{PATH:process.env.PATH||'/usr/bin:/bin',NODE_ENV:'production'},stdio:['ignore','pipe','pipe']});
   let out='',err='';const cap=(s:string,c:Buffer)=>(s+c.toString()).slice(-12000);
   child.stdout.on('data',c=>{out=cap(out,c);});child.stderr.on('data',c=>{err=cap(err,c);});
   const timer=setTimeout(()=>{child.kill('SIGKILL');err+='\nProgram exceeded its 30-second execution limit.';},30000);
   child.on('close',status=>{clearTimeout(timer);resolve({code:status,stdout:out,stderr:err});});
   child.on('error',e=>{clearTimeout(timer);resolve({code:-1,stdout:out,stderr:err+'\n'+e.message});});
  });
  if(code!==0)return {ok:false,stdout,stderr,result:null};
  const text=await readFile(join(dir,'result.json'),'utf8').catch(()=> '');
  if(!text)return {ok:false,stdout,stderr:stderr+'\nThe program did not return a result.',result:null};
  if(text.length>4_000_000)return {ok:false,stdout,stderr:stderr+'\nResult exceeds 4 MB.',result:null};
  return {ok:true,stdout,stderr,result:JSON.parse(text)};
 }finally{await rm(dir,{recursive:true,force:true}).catch(()=>{});release();}
}
