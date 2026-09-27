import {mkdir,readFile,writeFile,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {database,lock,unlock} from '@/db/store';
import {runEeScript,requestKey,type EeRequest,type EeResponse} from './sandbox';
import {platformAccount,platformStatus,userAccount,userConnection,type EeAccount} from './credentials';

// Runs Earth Engine scripts for agents and page programs. The sandbox replays the script with the
// answers gathered so far; each pass's new requests are checked against a read-only allow-list,
// counted against the account's daily quota and executed here with the account's token.
const API='https://earthengine.googleapis.com';
const MAX_PASSES=12,MAX_REQUESTS=40,dataDir=()=>resolve(process.env.DATA_DIR||'./data','earth-engine');
const limit=(name:string,fallback:number)=>Number(process.env[name])||fallback;
const appUrl=()=>(process.env.APP_URL||'').replace(/\/$/,'');
export type EeRunResult={ok:boolean;result:unknown;logs:string[];error?:string;account:'platform'|'user';project:string;requests:number;images:{url:string;kind:string}[];tiles:string[]};

export async function earthEngineStatus(userId:string){const p=await platformStatus(),u=await userConnection(userId);return {builtIn:{available:p.configured&&!userId.startsWith('guest:'),dailyRequests:limit('EARTH_ENGINE_DAILY_REQUESTS',300)},connected:u?{project:u.project,email:u.email||''}:null};}

// Only computations and reads; Earth Engine exports, asset writes, tasks and IAM are refused.
export function vetRequest(r:EeRequest,project:string):string|null{
 let u:URL;try{u=new URL(r.url);}catch{return 'Invalid Earth Engine request URL.';}
 if(u.origin!==API)return 'Only earthengine.googleapis.com is reachable.';
 const m=u.pathname.match(/^\/v1(?:alpha|beta)?\/projects\/([^/]+)\/(.+)$/);if(!m)return 'Unsupported Earth Engine request '+u.pathname+'.';
 if(m[1]!==project&&m[1]!=='earthengine-public')return 'Requests must use the account project '+project+'.';
 const rest=m[2];
 if(r.method==='POST'&&/^(value:compute|thumbnails|videoThumbnails|filmstripThumbnails|maps|table:computeFeatures|featureViews?)$/.test(rest))return null;
 if(r.method==='GET'&&/^assets\/.+/.test(rest)&&!/:(delete|move|copy|setIamPolicy)/.test(rest))return null;
 if(r.method==='POST'&&/^assets\/.+:(listAssets|listImages|listFeatures)$/.test(rest))return null;
 if(/(export|:copy|:move|:delete|setIamPolicy|operations)/i.test(rest))return 'Exports, asset changes and tasks are not available here; compute results, thumbnails and map tiles instead.';
 return 'Unsupported Earth Engine request '+r.method+' '+rest+'.';
}

async function countRequests(account:EeAccount,n:number){
 const day=new Date().toISOString().slice(0,10),db=database(),owner=account.ownerId;
 const lease=await lock('earthengine-usage:'+owner,20000);if(!lease)throw Error('Earth Engine is busy for this account. Retry shortly.');
 try{
  const mine=await db.prepare('SELECT requests FROM earth_engine_usage WHERE owner_id=? AND day=? AND account=?').bind(owner,day,account.kind).first<{requests:number}>(),used=mine?.requests||0;
  if(account.kind==='platform'){
   const cap=limit('EARTH_ENGINE_DAILY_REQUESTS',300);if(used+n>cap)throw Error(`The built-in Earth Engine allowance for today (${cap} requests) is used up. Connect your own Earth Engine account in Connectors to continue.`);
   const all=await db.prepare("SELECT COALESCE(SUM(requests),0) n FROM earth_engine_usage WHERE day=? AND account='platform'").bind(day).first<{n:number}>();if((all?.n||0)+n>limit('EARTH_ENGINE_PLATFORM_DAILY_REQUESTS',5000))throw Error('The built-in Earth Engine allowance for this server is used up for today. Connect your own Earth Engine account in Connectors to continue.');
  }else if(used+n>limit('EARTH_ENGINE_USER_DAILY_REQUESTS',3000))throw Error('Daily Earth Engine request limit reached for this connection.');
  await db.prepare('INSERT INTO earth_engine_usage(owner_id,day,account,requests) VALUES(?,?,?,?) ON CONFLICT(owner_id,day,account) DO UPDATE SET requests=earth_engine_usage.requests+excluded.requests').bind(owner,day,account.kind,n).run();
 }finally{await unlock(lease);}
}

async function send(account:EeAccount,r:EeRequest,signal?:AbortSignal):Promise<EeResponse>{
 const headers:Record<string,string>={Authorization:'Bearer '+await account.token()};if(r.body)headers['Content-Type']='application/json';
 const res=await fetch(r.url,{method:r.method,headers,body:r.method==='GET'?undefined:r.body,signal:signal?AbortSignal.any([signal,AbortSignal.timeout(180000)]):AbortSignal.timeout(180000)});
 const text=await res.text();if(text.length>8_000_000)return {status:413,text:JSON.stringify({error:{code:413,message:'Earth Engine result exceeds 8 MB; reduce the region, scale or list length.'}})};
 return {status:res.status,text};
}

let algorithmsCache:{text:string;at:number}|undefined;
async function algorithms(account:EeAccount,signal?:AbortSignal){
 if(algorithmsCache&&Date.now()-algorithmsCache.at<86400000)return algorithmsCache.text;
 const file=join(dataDir(),'algorithms.json');
 try{const s=await stat(file);if(Date.now()-s.mtimeMs<86400000){algorithmsCache={text:await readFile(file,'utf8'),at:s.mtimeMs};return algorithmsCache.text;}}catch{}
 const r=await send(account,{method:'GET',url:`${API}/v1/projects/${account.project}/algorithms?prettyPrint=false`,body:''},signal);
 if(r.status!==200)throw Error('Earth Engine refused the request ('+r.status+'): '+errorText(r.text));
 await mkdir(dataDir(),{recursive:true});await writeFile(file,r.text);algorithmsCache={text:r.text,at:Date.now()};return r.text;
}
const errorText=(text:string)=>{try{return String(JSON.parse(text).error?.message||text).slice(0,600);}catch{return text.slice(0,600);}};

// Thumbnail links need the account's token, so the image is fetched once and kept as a permanent file.
async function keepThumbnail(account:EeAccount,url:string,signal?:AbortSignal){
 const r=await fetch(url,{headers:{Authorization:'Bearer '+await account.token()},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(180000)]):AbortSignal.timeout(180000)});
 const type=r.headers.get('content-type')||'',ext=type.includes('png')?'png':type.includes('jpeg')?'jpg':type.includes('gif')?'gif':type.includes('tiff')?'tif':'';
 if(!r.ok||!ext)throw Error('Earth Engine thumbnail failed: '+errorText(await r.text().catch(()=>'')));
 const bytes=new Uint8Array(await r.arrayBuffer());if(bytes.byteLength>20_000_000)throw Error('Thumbnail exceeds 20 MB; lower dimensions.');
 const id=crypto.randomUUID().replaceAll('-','')+'.'+ext;await mkdir(join(dataDir(),'thumbnails'),{recursive:true});await writeFile(join(dataDir(),'thumbnails',id),bytes);
 return appUrl()+'/api/earth-engine/thumbnails/'+id;
}
async function keepMap(account:EeAccount,mapName:string){
 const id=crypto.randomUUID().replaceAll('-','');
 await database().prepare('INSERT INTO earth_engine_maps(id,owner_id,account,project,map_name,created_at) VALUES(?,?,?,?,?,?)').bind(id,account.ownerId,account.kind,account.project,mapName,Date.now()).run();
 return appUrl()+'/api/earth-engine/tiles/'+id+'/{z}/{x}/{y}';
}
const THUMB=/https:\/\/earthengine\.googleapis\.com\/v1(?:alpha|beta)?\/projects\/[a-z0-9-]+\/(?:thumbnails|videoThumbnails|filmstripThumbnails)\/[A-Za-z0-9_-]+:getPixels/g;
const TILES=/https:\/\/earthengine\.googleapis\.com\/v1(?:alpha|beta)?\/(projects\/[a-z0-9-]+\/maps\/[A-Za-z0-9_-]+)\/tiles\/\{z\}\/\{x\}\/\{y\}/g;
async function publishLinks(account:EeAccount,value:unknown,signal?:AbortSignal){
 const images:{url:string;kind:string}[]=[],tiles:string[]=[],swap=new Map<string,string>();
 const text=JSON.stringify(value);
 for(const url of new Set(text.match(THUMB)||[])){if(swap.size>=12)throw Error('Return at most 12 thumbnails per run.');const kept=await keepThumbnail(account,url,signal);swap.set(url,kept);images.push({url:kept,kind:/video/.test(url)?'animation':/filmstrip/.test(url)?'filmstrip':'image'});}
 for(const m of new Set([...text.matchAll(TILES)].map(m=>m[0]))){const name=m.replace(TILES,'$1');const kept=await keepMap(account,name);swap.set(m,kept);tiles.push(kept);}
 const walk=(v:unknown):unknown=>typeof v==='string'?v.replace(THUMB,s=>swap.get(s)||s).replace(TILES,s=>swap.get(s)||s):Array.isArray(v)?v.map(walk):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,walk(x)])):v;
 return {value:walk(value),images,tiles};
}

export async function chooseAccount(userId:string,use:unknown):Promise<EeAccount>{
 if(userId.startsWith('guest:'))throw Error('Sign in to use Earth Engine.');
 if(use==='mine')return userAccount(userId);
 if(use==='builtin')return platformAccount(userId);
 return await userConnection(userId)?userAccount(userId):platformAccount(userId);
}
export async function runEarthEngine(raw:unknown,userId:string,signal?:AbortSignal):Promise<EeRunResult>{
 const args=(raw&&typeof raw==='object'?raw:{}) as {code?:unknown;account?:unknown};
 const code=typeof args.code==='string'?args.code:'';if(!code.trim())throw Error('code is required: the body of async function (ee, print) that returns a plain JSON value.');
 if(code.length>60000)throw Error('Earth Engine code is limited to 60,000 characters.');
 const account=await chooseAccount(userId,args.account),alg=await algorithms(account,signal),responses:Record<string,EeResponse>={};
 let requests=0,logs:string[]=[];
 for(let pass=0;pass<MAX_PASSES;pass++){
  signal?.throwIfAborted();
  const out=await runEeScript(code,account.project,alg,responses);logs=out.logs;
  if(!out.pending.length){
   const base={account:account.kind,project:account.project,requests,logs};
   if(!out.ok)return {...base,ok:false,result:null,error:out.error.replace(/\n\s+at [\s\S]*$/,'')||'The script failed.',images:[],tiles:[]};
   const {value,images,tiles}=await publishLinks(account,out.result,signal);
   return {...base,ok:true,result:value,images,tiles};
  }
  for(const r of out.pending){const problem=vetRequest(r,account.project);if(problem)return {ok:false,result:null,logs,error:problem,account:account.kind,project:account.project,requests,images:[],tiles:[]};}
  if(requests+out.pending.length>MAX_REQUESTS)return {ok:false,result:null,logs,error:`The script needs more than ${MAX_REQUESTS} Earth Engine requests; combine values into one getInfo() (for example an ee.Dictionary or ee.List) instead of many small calls.`,account:account.kind,project:account.project,requests,images:[],tiles:[]};
  await countRequests(account,out.pending.length);requests+=out.pending.length;
  const answers=await Promise.all(out.pending.map(r=>send(account,r,signal).catch(e=>({status:502,text:JSON.stringify({error:{code:502,message:e instanceof Error?e.message:'Earth Engine request failed.'}})}))));
  out.pending.forEach((r,i)=>{responses[requestKey(r)]=answers[i];});
 }
 return {ok:false,result:null,logs,error:'The script kept asking for new results after '+MAX_PASSES+' passes; make its requests independent of earlier results where possible.',account:account.kind,project:account.project,requests,images:[],tiles:[]};
}

export async function thumbnailFile(id:string){if(!/^[a-f0-9]{32}\.(png|jpg|gif|tif)$/.test(id))return null;try{return {bytes:await readFile(join(dataDir(),'thumbnails',id)),type:id.endsWith('png')?'image/png':id.endsWith('jpg')?'image/jpeg':id.endsWith('gif')?'image/gif':'image/tiff'};}catch{return null;}}
export async function tile(id:string,z:number,x:number,y:number){
 if(!/^[a-f0-9]{32}$/.test(id)||![z,x,y].every(Number.isInteger)||z<0||z>24)return null;
 const row=await database().prepare('SELECT * FROM earth_engine_maps WHERE id=?').bind(id).first<{owner_id:string;account:string;project:string;map_name:string;created_at:number}>();
 if(!row||Date.now()-row.created_at>2*86400000)return null;
 const account=row.account==='user'?await userAccount(row.owner_id):await platformAccount(row.owner_id);
 const r=await fetch(`${API}/v1/${row.map_name}/tiles/${z}/${x}/${y}`,{headers:{Authorization:'Bearer '+await account.token()},signal:AbortSignal.timeout(60000)});
 if(!r.ok)return {status:r.status,bytes:new Uint8Array(),type:'text/plain'};
 return {status:200,bytes:new Uint8Array(await r.arrayBuffer()),type:r.headers.get('content-type')||'image/png'};
}
