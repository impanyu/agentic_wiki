import {mkdtemp,writeFile,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {z} from 'zod';
import {helper,vpnSlot,vpnIsUp} from './unl-vpn';

// ADAPT project share (\\snr18\Adapt on the CALMIT server). It is reachable only from
// the UNL network, so every operation runs smbclient inside the owner's UNL VPN
// namespace (see unl-vpn.ts) with the owner's UNL AD account.
const SHARE='Adapt',DOMAIN='UNL-AD',HOSTS=['snr18','snr18.unl.edu','snr18.unl.ad.unl.edu','snr18.ad.unl.edu'];
const credentials=z.object({username:z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),password:z.string().min(1).max(500)}).passthrough();
// smbclient command strings quote paths with double quotes; refuse characters that could break out.
const safePath=z.string().max(2000).refine(p=>!/["\x00-\x1f;]/.test(p),'Unsupported character in path.');
const safeName=z.string().min(1).max(200).refine(n=>!/["\x00-\x1f;/\\]/.test(n)&&n!=='.'&&n!=='..','Unsupported file name.');
const norm=(p:string)=>('/'+p).replace(/\\/g,'/').replace(/\/+/g,'/').replace(/\/$/,'')||'/';
const smbPath=(p:string)=>norm(p).replace(/\//g,'\\');
const hostCache=new Map<number,string>();

export type AdaptContext={secret:string;vpnConnectorId:string|null};
async function host(slot:number){
 const cached=hostCache.get(slot);if(cached)return cached;
 for(const name of HOSTS){const r=await helper(['resolve',String(slot),name],undefined,15000);const ip=r.stdout.trim().split(/\s+/)[0];if(r.code===0&&ip){hostCache.set(slot,ip);return ip;}}
 throw Error('The ADAPT server (snr18) could not be found through the UNL VPN.');
}
async function smb(ctx:AdaptContext,command:string,files?:{dir:string}){
 if(!ctx.vpnConnectorId||!await vpnIsUp(ctx.vpnConnectorId))throw Error('Connect UNL VPN in Connectors first; the ADAPT share is reachable only through the UNL VPN.');
 const auth=credentials.parse(JSON.parse(ctx.secret)),slot=await vpnSlot(ctx.vpnConnectorId),ip=await host(slot);
 const dir=files?.dir||await mkdtemp(join(tmpdir(),'aw-adapt-')),authFile=join(dir,'.auth');
 await writeFile(authFile,`username=${auth.username}\npassword=${auth.password}\ndomain=${DOMAIN}\n`,{mode:0o600});
 try{
  const r=await helper(['smb',String(slot),`//${ip}/${SHARE}`,'-A',authFile,'-m','SMB3','-c',command],undefined,120000);
  const out=r.stdout+r.stderr;
  if(/NT_STATUS_LOGON_FAILURE|NT_STATUS_ACCESS_DENIED/.test(out))throw Error(/LOGON_FAILURE/.test(out)?'The ADAPT server rejected the UNL AD username or password. Update the ADAPT connector.':'Your UNL AD account has no access to this ADAPT folder.');
  const failure=out.match(/NT_STATUS_[A-Z_]+/);if(r.code!==0||failure&&!/NT_STATUS_NO_SUCH_FILE listing/.test(out))throw Error(failure?'ADAPT share error: '+failure[0].replace('NT_STATUS_','').replaceAll('_',' ').toLowerCase():'ADAPT share request failed.');
  return r.stdout;
 }finally{await rm(authFile,{force:true});if(!files)await rm(dir,{recursive:true,force:true});}
}
export async function adaptList(ctx:AdaptContext,path='/'){
 safePath.parse(path);const out=await smb(ctx,`cd "${smbPath(path)}"; ls`);
 const items:{name:string;kind:'file'|'folder';size:number;modified:string}[]=[];
 for(const line of out.split('\n')){const m=line.match(/^\s{2}(.+?)\s+([ADHSRNI]*)\s+(\d+)\s+(\w{3} \w{3}\s+\d+ \d{2}:\d{2}:\d{2} \d{4})\s*$/);if(!m||m[1]==='.'||m[1]==='..')continue;items.push({name:m[1],kind:m[2].includes('D')?'folder':'file',size:Number(m[3]),modified:new Date(m[4]).toISOString()});}
 return {path:norm(path),items:items.sort((a,b)=>a.kind===b.kind?a.name.localeCompare(b.name):a.kind==='folder'?-1:1)};
}
export async function adaptDownload(ctx:AdaptContext,path:string,maxBytes:number){
 safePath.parse(path);const dir=await mkdtemp(join(tmpdir(),'aw-adapt-')),local=join(dir,'file');
 try{await smb(ctx,`get "${smbPath(path)}" "${local}"`,{dir});const size=(await stat(local)).size;if(size>maxBytes)throw Error('File exceeds the transfer limit.');return new Uint8Array(await readFile(local));}
 finally{await rm(dir,{recursive:true,force:true});}
}
export async function adaptUpload(ctx:AdaptContext,dir:string,name:string,bytes:Uint8Array,replace=false){
 safePath.parse(dir);safeName.parse(name);
 if(!replace&&(await adaptList(ctx,dir)).items.some(i=>i.name.toLowerCase()===name.toLowerCase()))throw Error('A file with this name already exists on ADAPT; nothing was overwritten.');
 const tmp=await mkdtemp(join(tmpdir(),'aw-adapt-')),local=join(tmp,'upload');
 try{await writeFile(local,bytes,{mode:0o600});await smb(ctx,`cd "${smbPath(dir)}"; put "${local}" "${name}"`,{dir:tmp});return {path:norm(dir+'/'+name),name,size:bytes.length};}
 finally{await rm(tmp,{recursive:true,force:true});}
}
export async function adaptMkdir(ctx:AdaptContext,parent:string,name:string){safePath.parse(parent);safeName.parse(name);await smb(ctx,`cd "${smbPath(parent)}"; mkdir "${name}"`);return norm(parent+'/'+name);}

export async function executeAdaptConnector(ctx:AdaptContext,name:string,raw:unknown){
 const parse=<T extends z.ZodRawShape>(shape:T)=>z.object(shape).strict().parse(raw);
 if(name==='list_files'){const a=parse({path:safePath.optional()});return adaptList(ctx,a.path||'/');}
 if(name==='read_text_file'){const a=parse({path:safePath,offset:z.number().int().min(0).optional(),limit:z.number().int().min(1).max(200000).optional()}),bytes=await adaptDownload(ctx,a.path,5*1024*1024),text=new TextDecoder().decode(bytes),offset=a.offset||0,limit=a.limit||50000,content=text.slice(offset,offset+limit);return {path:norm(a.path),content,offset,nextOffset:offset+limit<text.length?offset+limit:null,totalCharacters:text.length};}
 if(name==='write_text_file'){const a=parse({path:safePath,content:z.string().max(2_000_000)}),p=norm(a.path),dir=p.slice(0,p.lastIndexOf('/'))||'/',file=p.slice(p.lastIndexOf('/')+1);return {saved:true,...await adaptUpload(ctx,dir,file,new TextEncoder().encode(a.content),true)};}
 if(name==='create_folder'){const a=parse({path:safePath}),p=norm(a.path);return {created:true,path:await adaptMkdir(ctx,p.slice(0,p.lastIndexOf('/'))||'/',p.slice(p.lastIndexOf('/')+1))};}
 throw Error('Unknown ADAPT operation.');
}
