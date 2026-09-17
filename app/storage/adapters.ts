import type {StorageRequest} from './contracts';
export type StorageItem={id:string;name:string;kind:'file'|'folder';parents:string[];modifiedTime?:string;size?:number};
type Json=Record<string,any>;
const enc=encodeURIComponent;
const required=(v:string|undefined)=>{if(!v)throw Error('STORAGE_ARGUMENT_REQUIRED');return v;};
const googleId=(v:string)=>{if(!/^[A-Za-z0-9_-]+$/.test(v))throw Error('STORAGE_INVALID_ID');return v;};
async function bounded(r:Response,max=128000){if(Number(r.headers.get('content-length'))>max)throw Error('STORAGE_RESULT_TOO_LARGE');const reader=r.body?.getReader();if(!reader)return '';const chunks:Uint8Array[]=[];let n=0;try{while(true){const {value,done}=await reader.read();if(done)break;n+=value.length;if(n>max)throw Error('STORAGE_RESULT_TOO_LARGE');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}const all=new Uint8Array(n);let off=0;for(const c of chunks){all.set(c,off);off+=c.length;}return new TextDecoder().decode(all);}
export async function providerOperation(request:StorageRequest,token:string,transport:typeof fetch=fetch){
 const {provider,operation,args:a}=request;
 async function send(url:string,method='GET',body?:unknown,headers:Record<string,string>={},raw=false):Promise<Json>{
  const r=await transport(url,{method,redirect:'error',headers:{Authorization:'Bearer '+token,...(body!==undefined?{'Content-Type':raw?'application/octet-stream':'application/json'}:{}),...headers},body:body===undefined?undefined:raw?String(body):JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw Error(r.status===401?'STORAGE_RECONNECT_REQUIRED':r.status===403?'STORAGE_PERMISSION_REQUIRED':'STORAGE_OPERATION_FAILED');
  if(r.status===202)return {pending:true};if(r.status===204)return {ok:true};const text=await bounded(r);return text?JSON.parse(text):{ok:true};
 }
 function item(f:Json):StorageItem{return {id:String(provider==='dropbox'?f.path_lower||f.id:f.id),name:String(f.name||''),kind:provider==='google'?f.mimeType==='application/vnd.google-apps.folder'?'folder':'file':provider==='dropbox'?f['.tag']==='folder'?'folder':'file':f.folder?'folder':'file',parents:provider==='google'?f.parents||[]:provider==='onedrive'?[f.parentReference?.id||'root']:[(f.path_lower||'').slice(0,(f.path_lower||'').lastIndexOf('/'))],modifiedTime:f.modifiedTime||f.lastModifiedDateTime||f.server_modified,size:Number(f.size)||undefined};}
 const g='https://www.googleapis.com/drive/v3',d='https://api.dropboxapi.com/2',m='https://graph.microsoft.com/v1.0/me/drive';
 if(operation==='list'){
  if(provider==='google'){const parent=googleId(a.parent||'root'),u=new URL(g+'/files');u.search=new URLSearchParams({q:parent==='root'&&!a.rootOnly?"trashed = false":"'"+parent+"' in parents and trashed = false",fields:'nextPageToken,files(id,name,mimeType,parents,size,modifiedTime)',pageSize:'100',...(a.cursor?{pageToken:a.cursor}:{})}).toString();const r=await send(u.toString());return {items:(r.files||[]).map(item),next:r.nextPageToken||null};}
  if(provider==='dropbox'){const r=await send(d+(a.cursor?'/files/list_folder/continue':'/files/list_folder'),'POST',a.cursor?{cursor:a.cursor}:{path:a.parent==='root'?'':a.parent||'',limit:100});return {items:(r.entries||[]).map(item),next:r.has_more?r.cursor:null};}
  let url=m+(a.parent&&a.parent!=='root'?'/items/'+enc(a.parent):'/root')+'/children?$top=100';if(a.cursor){const cursor=new URL(a.cursor);if(cursor.origin!=='https://graph.microsoft.com'||!cursor.pathname.startsWith('/v1.0/me/drive/'))throw Error('STORAGE_INVALID_CURSOR');url=cursor.toString();}const r=await send(url);return {items:(r.value||[]).map(item),next:r['@odata.nextLink']||null};
 }
 if(operation==='read'){
  let url='',headers:Record<string,string>={Authorization:'Bearer '+token};
  if(provider==='google'){const id=enc(googleId(required(a.id))),meta=await send(g+'/files/'+id+'?fields=mimeType');const exports:Record<string,string>={'application/vnd.google-apps.document':'text/plain','application/vnd.google-apps.spreadsheet':'text/csv','application/vnd.google-apps.presentation':'text/plain'};url=g+'/files/'+id+(exports[meta.mimeType]?'/export?mimeType='+enc(exports[meta.mimeType]):'?alt=media');}
  if(provider==='dropbox'){url='https://content.dropboxapi.com/2/files/download';headers['Dropbox-API-Arg']=JSON.stringify({path:required(a.id)});}
  if(provider==='onedrive'){const f=await send(m+'/items/'+enc(required(a.id))+'?$select=id,@microsoft.graph.downloadUrl');url=f['@microsoft.graph.downloadUrl'];const u=new URL(url);if(u.protocol!=='https:'||!['.sharepoint.com','.1drv.com','.onedrive.com','.onedrive.live.com'].some(s=>u.hostname.endsWith(s)))throw Error('STORAGE_DOWNLOAD_UNAVAILABLE');headers={};}
  const r=await transport(url,{method:provider==='dropbox'?'POST':'GET',headers,redirect:'error',signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('STORAGE_READ_FAILED');return {content:await bounded(r,64000),contentType:r.headers.get('content-type')||'application/octet-stream'};
 }
 if(provider==='google'){
  if(operation==='mkdir')return item(await send(g+'/files','POST',{name:required(a.name),mimeType:'application/vnd.google-apps.folder',parents:[googleId(a.parent||'root')]}));
  if(operation==='upload'){const boundary='agenticwiki-'+crypto.randomUUID(),body='--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'+JSON.stringify({name:required(a.name),parents:[googleId(a.parent||'root')]})+'\r\n--'+boundary+'\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n'+(a.content||'')+'\r\n--'+boundary+'--';return item(await send('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart','POST',body,{'Content-Type':'multipart/related; boundary='+boundary},true));}
  const url=g+'/files/'+enc(required(a.id));
  if(operation==='copy')return item(await send(url+'/copy','POST',{...(a.name?{name:a.name}:{}),...(a.parent?{parents:[googleId(a.parent)]}:{})}));
  if(operation==='move'){const old=await send(url+'?fields=parents');const q=new URLSearchParams({addParents:googleId(required(a.parent)),removeParents:(old.parents||[]).join(',')});return item(await send(url+'?'+q,'PATCH',{}));}
  return item(await send(url,'PATCH',operation==='trash'?{trashed:true}:{name:required(a.name)}));
 }
 if(provider==='dropbox'){
  const path=(a.parent==='root'?'':a.parent||'')+'/'+(a.name||'');
  if(['mkdir','upload','rename'].includes(operation))required(a.name);
  if(operation==='mkdir')return item((await send(d+'/files/create_folder_v2','POST',{path,autorename:false})).metadata);
  if(operation==='upload')return item(await send('https://content.dropboxapi.com/2/files/upload','POST',a.content||'',{'Dropbox-API-Arg':JSON.stringify({path,mode:'add',autorename:false,mute:false,strict_conflict:true})},true));
  if(operation==='trash')return item((await send(d+'/files/delete_v2','POST',{path:required(a.id)})).metadata);
  const from=required(a.id),parent=operation==='rename'?from.slice(0,from.lastIndexOf('/')):a.parent==='root'?'':a.parent===undefined?required(a.parent):a.parent,name=a.name||from.slice(from.lastIndexOf('/')+1);
  return item((await send(d+(operation==='copy'?'/files/copy_v2':'/files/move_v2'),'POST',{from_path:from,to_path:parent+'/'+name,autorename:false})).metadata);
 }
 const parent=a.parent&&a.parent!=='root'?'/items/'+enc(a.parent):'/root';
 if(operation==='mkdir')return item(await send(m+parent+'/children','POST',{name:required(a.name),folder:{},'@microsoft.graph.conflictBehavior':'fail'}));
 if(operation==='upload')return item(await send(m+parent+':/'+enc(required(a.name))+':/content?@microsoft.graph.conflictBehavior=fail','PUT',a.content||'',{},true));
 const url=m+'/items/'+enc(required(a.id));
 if(operation==='trash')return send(url,'DELETE');
 if(operation==='copy')return send(url+'/copy','POST',{parentReference:{id:required(a.parent)},...(a.name?{name:a.name}:{})});
 return item(await send(url,'PATCH',operation==='rename'?{name:required(a.name)}:{parentReference:{id:required(a.parent)},...(a.name?{name:a.name}:{})}));
}
