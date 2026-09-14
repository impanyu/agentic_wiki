import {Buffer} from 'node:buffer';
import {env} from '@/server/runtime';
import {database,getPage} from '@/db/store';
export type FilePart={type:'input_file';filename:string;file_data:string}|{type:'input_image';image_url:string}|{type:'input_text';text:string};
export type ContextFile={id:string;name:string;size:number;createdAt:string;url:string;owned:boolean};
export const contextFilesSql=`SELECT f.id,f.owner_id,f.created_at,c.payload FROM page_files f JOIN pages p ON p.id=f.page_id JOIN components c ON c.id=f.component_id WHERE p.id=? AND (p.visibility='public' OR p.owner_id=?) AND (f.scope='' OR f.scope=?) ORDER BY f.created_at DESC,f.id`;
export async function contextFiles(pageId:string,userId:string){
 const rows=await database().prepare(contextFilesSql).bind(pageId,userId,userId).all<{id:string;owner_id:string;created_at:string;payload:string}>();
 return rows.results.map(r=>({row:r,data:JSON.parse(r.payload)}));
}
export async function listContextFiles(pageId:string,userId:string):Promise<ContextFile[]>{return (await contextFiles(pageId,userId)).map(({row,data})=>({id:row.id,name:data.fileName,size:data.size,createdAt:row.created_at,url:'/api/pages/'+encodeURIComponent(pageId)+'/files/'+encodeURIComponent(row.id),owned:row.owner_id===userId}));}
export async function attachContextFile(pageId:string,componentId:string,userId:string){
 const page=await getPage(pageId,userId);if(!page)throw Error('Page is unavailable.');
 const scope=page.kind==='static'?'':userId;
 await database().prepare("INSERT INTO page_files(id,page_id,component_id,owner_id,scope,created_at) SELECT ?,p.id,c.id,?,?,? FROM pages p,components c WHERE p.id=? AND (p.visibility='public' OR p.owner_id=?) AND c.id=? AND c.owner_id=? AND c.type='data'").bind(crypto.randomUUID(),userId,scope,new Date().toISOString(),pageId,userId,componentId,userId).run();
}
export async function fileContext(pageId:string,userId:string,selectedIds?:string[]){
 const files=await contextFiles(pageId,userId),parts:FilePart[]=[],metadata:Record<string,unknown>[]=[];let total=0,included=0;
 for(const {row,data} of files){
  if(selectedIds&&!selectedIds.includes(row.id))continue;
  const entry:Record<string,unknown>={id:row.id,name:data.fileName,size:data.size};metadata.push(entry);
  if(!String(data.location).startsWith('r2://FILES/uploads/')){entry.status='Not available for inline reading';continue;}
  if(total+data.size>40*1024*1024||included>=10){entry.status='Not included this turn: attachment context limit';continue;}
  const ext=String(data.fileName).split('.').pop()?.toLowerCase()||'';
  if(!/^(pdf|docx?|pptx?|xlsx?|odt|rtf|txt|md|json|csv|tsv|html?|xml|py|js|ts|css|sql|yaml|yml|log|png|jpe?g|webp|gif)$/.test(ext)){entry.status='Stored; this format needs a suitable processing tool';continue;}
  const object=await (env as unknown as {FILES:R2Bucket}).FILES.get(data.location.slice('r2://FILES/'.length));if(!object){entry.status='File unavailable';continue;}
  const bytes=await object.arrayBuffer();total+=bytes.byteLength;included++;
  const mime=/^(png|jpe?g|webp|gif)$/.test(ext)?'image/'+(ext==='jpg'?'jpeg':ext):ext==='pdf'?'application/pdf':data.mimeType||'application/octet-stream';
  const encoded='data:'+mime+';base64,'+Buffer.from(bytes).toString('base64');
  parts.push(/^(png|jpe?g|webp|gif)$/.test(ext)?{type:'input_image',image_url:encoded}:{type:'input_file',filename:data.fileName,file_data:encoded});entry.status='Included as model input';
 }
 return {metadata,parts};
}
export async function sandboxContextFiles(pageId:string,userId:string){
 const files=await contextFiles(pageId,userId),uploads:{path:string;data:ArrayBuffer}[]=[],metadata:{id:string;name:string;path?:string;status?:string}[]=[];let bytes=0;
 for(const {row,data} of files){const item:{id:string;name:string;path?:string;status?:string}={id:row.id,name:data.fileName};metadata.push(item);if(!String(data.location).startsWith('r2://FILES/uploads/')||bytes+data.size>40*1024*1024){item.status='Not mounted: file context limit or unavailable source';continue;}const object=await (env as unknown as {FILES:R2Bucket}).FILES.get(data.location.slice('r2://FILES/'.length));if(!object){item.status='Unavailable';continue;}const content=await object.arrayBuffer();bytes+=content.byteLength;item.path='/home/user/context/'+row.id+'-'+String(data.fileName).replace(/[^a-zA-Z0-9._-]/g,'_');uploads.push({path:item.path,data:content});}
 return {uploads,metadata};
}
