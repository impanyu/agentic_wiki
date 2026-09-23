import {mkdtemp,writeFile,readFile,rm,access} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {z} from 'zod';

const credentials=z.object({username:z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),privateKey:z.string().min(100).max(10000).optional(),sessionId:z.string().uuid().optional()}).passthrough();
const safePath=z.string().min(1).max(1000).refine(value=>!/[\0\r\n]/.test(value),'Invalid path.');
const jobId=z.string().regex(/^\d+(?:_[\d-]+)?$/);
const knownHost='swan.unl.edu ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFH3i+E4EKT20y+tXmnizsXN2c6Lg2SlaGjsbERegll6\n';
const quote=(value:string)=>"'"+value.replaceAll("'","'\\''")+"'";
const socketFor=(id:string)=>join(tmpdir(),'agenticwiki-hcc-'+id+'.sock');
const touchedFor=(id:string)=>socketFor(id)+'.last-used';
const idleLimitMs=2*60*60*1000;
async function run(args:string[],options:{env?:NodeJS.ProcessEnv;detached?:boolean;timeout?:number}={}){return await new Promise<{stdout:string;stderr:string}>((resolve,reject)=>{const child=spawn('ssh',args,{stdio:['ignore','pipe','pipe'],env:options.env,detached:options.detached});let stdout='',stderr='',done=false;const finish=(e?:Error)=>{if(done)return;done=true;clearTimeout(timer);e?reject(e):resolve({stdout,stderr});};child.stdout?.on('data',(c:Buffer)=>stdout+=c);child.stderr?.on('data',(c:Buffer)=>stderr+=c);child.on('error',finish);child.on('close',code=>code===0?finish():finish(Error(stderr.trim()||'HCC SSH command failed.')));const timer=setTimeout(()=>{child.kill('SIGKILL');finish(Error('HCC authentication timed out. Check the password and approve Duo promptly.'));},options.timeout||45000);});}

export async function hccSessionStatus(secret:string){const auth=credentials.parse(JSON.parse(secret));if(auth.privateKey)return {connected:true,method:'ssh-key',expiresAt:null};if(!auth.sessionId)return {connected:false,method:'duo',expiresAt:null};try{const touched=Number(await readFile(touchedFor(auth.sessionId),'utf8').catch(()=>String(Date.now()))),expiresAt=touched+idleLimitMs;if(expiresAt<=Date.now()){await run(['-S',socketFor(auth.sessionId),'-O','exit',auth.username+'@swan.unl.edu'],{timeout:5000}).catch(()=>{});await Promise.all([rm(socketFor(auth.sessionId),{force:true}),rm(touchedFor(auth.sessionId),{force:true})]);return {connected:false,method:'duo',expiresAt:null};}const result=await run(['-S',socketFor(auth.sessionId),'-O','check',auth.username+'@swan.unl.edu'],{timeout:5000});const match=(result.stderr+result.stdout).match(/pid=\d+/);return {connected:true,method:'duo',expiresAt,detail:match?.[0]||'active'};}catch{return {connected:false,method:'duo',expiresAt:null};}}

export async function startHccSession(secret:string,password:string,duoResponse='1'){
 const auth=credentials.parse(JSON.parse(secret));if(!auth.sessionId)throw Error('Reconnect the UNL HCC connector to enable Duo sessions.');if(!password||password.length>500)throw Error('Enter your HCC password.');if(!/^[0-9A-Za-z.,#*-]{1,80}$/.test(duoResponse))throw Error('Invalid Duo response.');
 const socket=socketFor(auth.sessionId),dir=await mkdtemp(join(tmpdir(),'agenticwiki-hcc-auth-')),passwordFile=join(dir,'password'),duoFile=join(dir,'duo'),stageFile=join(dir,'stage'),askpass=join(dir,'askpass.sh'),hosts=join(dir,'known_hosts');await Promise.all([rm(socket,{force:true}),rm(touchedFor(auth.sessionId),{force:true})]);
 // The askpass script records every prompt Swan shows (never the answers) so a failed
 // login can report exactly where the exchange stopped; ssh -E keeps its own log in the same directory.
 const sshLog=join(dir,'ssh.log');
 await Promise.all([writeFile(passwordFile,password,{mode:0o600}),writeFile(duoFile,duoResponse,{mode:0o600}),writeFile(stageFile,'',{mode:0o600}),writeFile(hosts,knownHost,{mode:0o600}),writeFile(askpass,`#!/bin/sh\nprintf '%s\\n' "$1" | tr '\\n' ' ' | cut -c1-400 >> "${stageFile}"; echo >> "${stageFile}"\ncase "$1" in *assword*) echo '@password' >> "${stageFile}"; cat "${passwordFile}";; *Duo*|*Passcode*|*option*) echo '@duo' >> "${stageFile}"; cat "${duoFile}";; *) echo '@other' >> "${stageFile}"; cat "${duoFile}";; esac\n`,{mode:0o700})]);
 const child=spawn('ssh',['-v','-E',sshLog,'-M','-S',socket,'-o','ControlPersist=2h','-o','ConnectTimeout=20','-o','ServerAliveInterval=30','-o','ServerAliveCountMax=3','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+hosts,'-o','PreferredAuthentications=keyboard-interactive,password','-o','PubkeyAuthentication=no','-N',auth.username+'@swan.unl.edu'],{stdio:'ignore',detached:true,env:{...process.env,DISPLAY:':0',SSH_ASKPASS:askpass,SSH_ASKPASS_REQUIRE:'force'}});child.unref();
 try{const deadline=Date.now()+70000;while(Date.now()<deadline){await new Promise(r=>setTimeout(r,1000));try{await access(socket);const status=await hccSessionStatus(secret);if(status.connected){await writeFile(touchedFor(auth.sessionId),String(Date.now()),{mode:0o600});return {...status,expiresAt:Date.now()+idleLimitMs,message:'HCC compute session connected. It remains available until it has been idle for two hours.'};}}catch{}if(child.exitCode!==null)break;}child.kill('SIGTERM');
  const stages=await readFile(stageFile,'utf8').catch(()=> ''),log=await readFile(sshLog,'utf8').catch(()=> '');
  const prompts=stages.split('\n').filter(line=>line&&!line.startsWith('@')).map(line=>line.trim()),outcome=log.split('\n').filter(line=>/denied|Authentication|Connection|timed out|refused|Too many|Host key/i.test(line)&&!/^debug1: (Authentications that can continue|Next authentication method)/.test(line)).slice(-3).map(line=>line.replace(/^debug1: /,'').trim());
  console.error('HCC login failed for',auth.username,{exitCode:child.exitCode,prompts,outcome});
  const detail=' Prompts seen: '+(prompts.length?prompts.map(p=>'"'+p+'"').join(' → '):'none')+(outcome.length?'. ssh: '+outcome.join(' | '):'')+'.';
  if(stages.includes('@duo'))throw Error('Swan accepted your password and requested Duo, but authentication was not approved within 70 seconds. Check Duo Mobile or enter a current Duo passcode.'+detail);
  if(stages.includes('@password'))throw Error('Swan did not accept the HCC username or password, so no Duo request was sent.'+detail);
  throw Error('Swan did not present an authentication prompt. Check HCC availability and the configured username.'+detail);}finally{await rm(dir,{recursive:true,force:true});}
}

async function ssh(secret:string,command:string,signal?:AbortSignal){
 const auth=credentials.parse(JSON.parse(secret)),dir=await mkdtemp(join(tmpdir(),'agenticwiki-hcc-')),key=join(dir,'key'),hosts=join(dir,'known_hosts');
 if(!auth.privateKey){const status=await hccSessionStatus(secret);if(!status.connected)throw Error('HCC compute session expired. Open Connectors and reconnect with password and Duo.');}
 await Promise.all([...(auth.privateKey?[writeFile(key,auth.privateKey.trim()+'\n',{mode:0o600})]:[]),writeFile(hosts,knownHost,{mode:0o600})]);
 try{const result=await new Promise<string>((resolve,reject)=>{
  const sessionArgs=auth.privateKey?['-i',key,'-o','IdentitiesOnly=yes']:['-S',socketFor(auth.sessionId!)];const child=spawn('ssh',[...sessionArgs,'-o','BatchMode=yes','-o','ConnectTimeout=12','-o','ServerAliveInterval=10','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+hosts,auth.username+'@swan.unl.edu','bash','-lc',quote(command)],{stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='',size=0,done=false;let timer:ReturnType<typeof setTimeout>;
  const abort=()=>{child.kill('SIGKILL');finish(Error('HCC request cancelled.'));};
  const finish=(error?:Error)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(stdout.trim());};
  const collect=(chunk:Buffer,target:'out'|'err')=>{size+=chunk.length;if(size>2_000_000){child.kill('SIGKILL');finish(Error('HCC response exceeded 2 MB. Narrow the request.'));return;}if(target==='out')stdout+=chunk;else stderr+=chunk;};
  child.stdout.on('data',(c:Buffer)=>collect(c,'out'));child.stderr.on('data',(c:Buffer)=>collect(c,'err'));child.on('error',e=>finish(e));child.on('close',code=>code===0?finish():finish(Error(stderr.trim()||'HCC SSH command failed. Check the registered key and HCC access.')));signal?.addEventListener('abort',abort,{once:true});
  timer=setTimeout(()=>{child.kill('SIGKILL');finish(Error('HCC did not respond in time. Reconnect the compute session if it expired.'));},45000);
 });if(auth.sessionId)await writeFile(touchedFor(auth.sessionId),String(Date.now()),{mode:0o600});return result;}finally{await rm(dir,{recursive:true,force:true});}
}

const lines=(value:string)=>value?value.split('\n').filter(Boolean):[];
export async function executeHccConnector(secret:string,name:string,raw:unknown,signal?:AbortSignal){
 const parse=<T extends z.ZodRawShape>(shape:T)=>z.object(shape).strict().parse(raw);
 if(name==='account_status'){const out=await ssh(secret,"printf 'user\\t'; id -un; printf 'home\\t'; printf '%s\\n' \"$HOME\"; printf 'cluster\\t'; hostname; printf 'quota\\t'; (hcc-du 2>/dev/null | head -40 || true)",signal),all=lines(out);return {fields:Object.fromEntries(all.filter(x=>x.includes('\t')).map(x=>{const [key,...rest]=x.split('\t');return [key,rest.join('\t')];})),details:all.filter(x=>!x.includes('\t')).slice(0,40)};}
 if(name==='list_files'){const a=parse({path:safePath.optional(),limit:z.number().int().min(1).max(500).optional()}),path=a.path||'~',limit=a.limit||200,out=await ssh(secret,`target=${quote(path)}; target=\${target/#\~/$HOME}; test -d "$target"; find "$target" -mindepth 1 -maxdepth 1 -printf '%y\\t%f\\t%s\\t%TY-%Tm-%TdT%TH:%TM:%TS\\n' | sort -k1,1r -k2,2 | head -n ${limit}`,signal),all=lines(out);return {path,items:all.map(line=>{const [type,name,size,modified]=line.split('\t');return {name,kind:type==='d'?'folder':'file',size:Number(size)||0,modified};}),truncated:all.length===limit};}
 if(name==='read_text_file'){const a=parse({path:safePath,offset:z.number().int().min(0).max(5_000_000).optional(),limit:z.number().int().min(1).max(50000).optional()}),offset=a.offset||0,limit=a.limit||16000,content=await ssh(secret,`target=${quote(a.path)}; target=\${target/#\~/$HOME}; test -f "$target"; test $(wc -c < "$target") -le 5242880; dd if="$target" bs=1 skip=${offset} count=${limit} status=none`,signal);return {path:a.path,content,offset,nextOffset:content.length===limit?offset+limit:null};}
 if(name==='write_text_file'){const a=parse({path:safePath,content:z.string().max(200000)}),encoded=Buffer.from(a.content).toString('base64');await ssh(secret,`target=${quote(a.path)}; target=\${target/#\~/$HOME}; mkdir -p "$(dirname "$target")"; printf %s ${quote(encoded)} | base64 -d > "$target"`,signal);return {saved:true,path:a.path,bytes:Buffer.byteLength(a.content)};}
 if(name==='create_folder'){const a=parse({path:safePath});await ssh(secret,`target=${quote(a.path)}; target=\${target/#\~/$HOME}; mkdir -p "$target"`,signal);return {created:true,path:a.path};}
 if(name==='list_jobs'){const a=parse({states:z.string().max(120).optional(),limit:z.number().int().min(1).max(500).optional()}),filter=a.states?` --states=${quote(a.states)}`:'',out=await ssh(secret,`squeue --me --noheader${filter} --format='%i\\t%j\\t%T\\t%P\\t%M\\t%l\\t%D\\t%R' | head -n ${a.limit||200}`,signal);return {jobs:lines(out).map(line=>{const [id,name,state,partition,elapsed,timeLimit,nodes,reason]=line.split('\t');return {id,name,state,partition,elapsed,timeLimit,nodes:Number(nodes)||0,reason};})};}
 if(name==='job_details'){const a=parse({job_id:jobId}),details=await ssh(secret,`(scontrol show job -o ${quote(a.job_id)} 2>/dev/null || sacct -j ${quote(a.job_id)} --noheader --parsable2 --format=JobID,JobName,State,Partition,Elapsed,Timelimit,ExitCode,NodeList | head -20)`,signal);return {jobId:a.job_id,details};}
 if(name==='read_job_log'){const a=parse({path:safePath,lines:z.number().int().min(1).max(2000).optional()}),content=await ssh(secret,`target=${quote(a.path)}; target=\${target/#\~/$HOME}; test -f "$target"; tail -n ${a.lines||200} "$target"`,signal);return {path:a.path,content};}
 if(name==='list_partitions'){const out=await ssh(secret,"sinfo --noheader --format='%P\\t%a\\t%l\\t%D\\t%G'",signal);return {partitions:lines(out).map(line=>{const [name,availability,timeLimit,nodes,gres]=line.split('\t');return {name,availability,timeLimit,nodes:Number(nodes)||0,gres};})};}
 if(name==='search_modules'){const a=parse({query:z.string().min(1).max(100)}),out=await ssh(secret,`module --terse spider ${quote(a.query)} 2>&1 | head -200`,signal);return {query:a.query,results:lines(out)};}
 if(name==='submit_job'){const a=parse({script:z.string().min(1).max(200000),working_directory:safePath.optional(),script_name:z.string().regex(/^[A-Za-z0-9._-]{1,120}$/).optional()}),encoded=Buffer.from(a.script).toString('base64'),filename=a.script_name||('agenticwiki-'+Date.now()+'.submit'),work=a.working_directory||'~/agenticwiki-jobs',out=await ssh(secret,`work=${quote(work)}; work=\${work/#\~/$HOME}; mkdir -p "$work"; file="$work"/${quote(filename)}; printf %s ${quote(encoded)} | base64 -d > "$file"; cd "$work"; sbatch "$file"`,signal),match=out.match(/Submitted batch job (\d+)/);if(!match)throw Error('HCC did not return a Slurm job ID. '+out);return {submitted:true,jobId:match[1],scriptPath:work+'/'+filename,message:out};}
 if(name==='cancel_job'){const a=parse({job_id:jobId});await ssh(secret,`scancel ${quote(a.job_id)}`,signal);return {cancelled:true,jobId:a.job_id};}
 throw Error('Unknown HCC operation.');
}
export async function verifyHccConnector(secret:string){await executeHccConnector(secret,'account_status',{});}
