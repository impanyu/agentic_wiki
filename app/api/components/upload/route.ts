import {folderPath} from '@/app/context-files/tree';
import {attachContextFile,listContextFiles} from '@/app/context-files/server';
import {env} from '@/server/runtime';
import {getActor} from '@/app/actor';
import {createComponent,rememberComponent} from '@/app/components-registry/registry';
import {detectLanguages} from '@/app/api/ask/ai';
import {database,getPage,reply,sameOrigin} from '@/db/store';
export async function POST(request:Request){
 const actor=await getActor(request),respond=(data:unknown,status=200)=>actor.finish(reply(data,status));
 if(!sameOrigin(request))return respond({error:'This request must come from the site.'},403);
 const files=(env as unknown as {FILES?:R2Bucket}).FILES;if(!files)return respond({error:'File storage is unavailable.'},503);
 let key:string|undefined,registered=false;
 try{
  const pageId=request.headers.get('x-page-id'),folder=folderPath(decodeURIComponent(request.headers.get('x-folder-path')||''));
  if(pageId&&!await getPage(pageId,actor.userId))return respond({error:'This page is unavailable.'},404);
  // The browser sends bytes directly, avoiding multipart copies of large files.
  const length=Number(request.headers.get('content-length')||0);if(length>10*1024*1024)return respond({error:'Choose a file up to 10 MB.'},413);
  const name=decodeURIComponent(request.headers.get('x-file-name')||'data-file').replace(/[\u0000-\u001f/\\]/g,'_').slice(0,250);
  if(!name.trim())return respond({error:'The file needs a name.'},400);
  const reader=request.body?.getReader();if(!reader)return respond({error:'Choose a file to upload.'},400);
  const chunks:Uint8Array[]=[];let size=0;
  while(true){const item=await reader.read();if(item.done)break;size+=item.value.length;if(size>10*1024*1024){await reader.cancel();return respond({error:'Choose a file up to 10 MB.'},413);}chunks.push(item.value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  key='uploads/'+crypto.randomUUID();await files.put(key,bytes,{httpMetadata:{contentType:'application/octet-stream'}});
  const language=(await detectLanguages([{id:'file',text:name}])).get('file')!;
  // A unique upload is a distinct resource even when another file has the same name.
  const context={userId:actor.userId,ownerId:actor.userId,language,visibility:'private' as const};
  const component=await createComponent(name+' — '+key.split('/')[1],'data',{kind:'data-reference',location:'r2://FILES/'+key,fileName:name,mimeType:(request.headers.get('content-type')||'application/octet-stream').slice(0,200),size,format:name.includes('.')?name.split('.').pop()!.slice(0,100):'binary',description:'Uploaded file: '+name},context);
  registered=true;
  await rememberComponent(name,component,context);
  await database().prepare('UPDATE components SET title=?,description=? WHERE id=? AND owner_id=?').bind(name,'Uploaded file: '+name,component.id,actor.userId).run();
  const fileId=pageId?await attachContextFile(pageId,component.id,actor.userId,folder):undefined;
  return respond({page:await getPage(component.id,actor.userId),file:pageId?(await listContextFiles(pageId,actor.userId)).find(f=>f.id===fileId):undefined});
 }catch(error){if(key&&!registered)await files.delete(key).catch(()=>{});console.error('Upload failed',error instanceof Error?error.message.slice(0,150):'unknown');return respond({error:'The upload could not be saved. Please try again.'},503);}
}
