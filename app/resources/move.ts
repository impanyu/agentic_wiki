import {z} from 'zod';
import {copySchema,type Resource} from './contracts';
import {copyResources,readFile,fileDigest,browseResources} from './service';
import {connections,callConnector} from '@/app/connectors/service';
import {vaultPath,vaultRead,vaultWrite} from '@/app/storage/vault';
import {database,getPage,lock,unlock} from '@/db/store';
import {canWritePage} from '@/app/page-permissions';
import {listContextFiles} from '@/app/context-files/server';
const schema=copySchema.extend({confirmRemoval:z.literal(true)});
const removalTool=(r:Resource)=>r.space==='adma'?'delete_'+r.kind:'trash';
async function permission(pageId:string,userId:string,r:Resource){
 if(!canWritePage(await getPage(pageId,userId)))throw Error('This page is read only.');
 if(r.space==='hcc')throw Error('Files on HCC can be copied but not moved from here; copy them, then delete the originals on HCC if needed.');
 if(!r.id||r.id==='root'||r.space==='adma'&&['repositories','third-party'].includes(r.id))throw Error('Repository roots cannot be moved. Select files or folders inside them.');
 if(r.space==='page'){
  if(r.kind==='file'&&!(await listContextFiles(pageId,userId)).some(f=>f.id===r.id&&f.removable))throw Error('Source file cannot be removed.');
  return;
 }
 const c=(await connections(userId)).find(c=>c.id===(r.space==='adma'?r.connectorId:r.space)),tool=removalTool(r);
 if(!c?.enabled||!c.connected||!c.allowed.includes(tool)||!c.automatic.includes(tool))throw Error('Enable '+tool+' for this connection before moving, or use Copy.');
}
async function remove(pageId:string,userId:string,r:Resource){
 await permission(pageId,userId,r);
 if(r.kind==='folder'){const contents=await browseResources(pageId,userId,r);if(contents.items.length||contents.next)throw Error('Folder contains remaining or new data; it was preserved.');}
 if(r.space==='page'){
  if(r.kind==='file'){
   const result=await database().prepare("DELETE FROM page_files WHERE id=? AND page_id=? AND (scope='' OR owner_id=?) AND EXISTS(SELECT 1 FROM pages WHERE id=? AND (owner_id=? OR (visibility='public' AND public_write=1)))").bind(r.id,pageId,userId,pageId,userId).run();
   if(!result.meta.changes)throw Error('Source attachment changed or is unavailable.');
  }else await database().prepare("DELETE FROM page_file_folders WHERE page_id=? AND path=? AND (scope='' OR scope=?)").bind(pageId,r.id,userId).run();
  return;
 }
 const result=await callConnector(userId,r.space==='adma'?r.connectorId!:r.space,removalTool(r),{id:r.id},pageId) as any;
 if(result?.confirmationRequired||result?.error)throw Error(result.error||'Source removal awaits connector approval; it has not completed.');
}
export async function moveResources(pageId:string,userId:string,raw:unknown){
 const request=schema.parse(raw),key=await vaultPath(userId,'move-'+request.operationId),lease=await lock('move:'+userId+':'+request.operationId,660000);
 if(!lease)throw Error('This move is already running.');
 try{
  const prior=await vaultRead(key);
  if(prior){if(prior.pageId!==pageId||JSON.stringify(prior.request)!==JSON.stringify(request))throw Error('Move operation ID was already used.');return prior.result;}
  for(const r of request.sources)await permission(pageId,userId,r);
  const {confirmRemoval,...copy}=request;
  const copied=await copyResources(pageId,userId,copy) as any;
  const result={state:'verifying',copied:copied.copied||[],moved:[] as Resource[],failed:[...(copied.failed||[])] as any[],bytes:copied.bytes||0,message:''};
  const save=()=>vaultWrite(key,{pageId,request,result});
  await save();
  if(copied.state!=='complete'){result.state='partial';result.message='Copy did not complete. No source removal was attempted.';await save();return result;}
  // Verify every copied file and the current source before removing any originals.
  try{
   for(const entry of result.copied){
    await permission(pageId,userId,entry.source);
    if(entry.source.kind==='folder')continue;
    if(entry.exported)throw Error('Google Workspace exports are copies, not lossless moves. Originals were preserved.');
    const id=entry.result?.id||entry.result?.files?.[0]?.id;if(!id||!entry.digest)throw Error('Destination could not be verified. Originals were preserved.');
    const target={...entry.destination,id,kind:'file' as const,name:entry.source.name};
    if(await fileDigest((await readFile(pageId,userId,target)).bytes)!==entry.digest||await fileDigest((await readFile(pageId,userId,entry.source)).bytes)!==entry.digest)throw Error('Source or destination content changed. Originals were preserved.');
   }
  }catch(e){result.failed.push({error:e instanceof Error?e.message:'Verification failed.'});result.state='partial';await save();return result;}
  result.state='removing';result.message='Removal in progress. Do not start another move if interrupted.';await save();
  // Deepest folders last, and never recursively delete newly arrived contents.
  for(const entry of [...result.copied].reverse()){
   try{
    if(entry.source.kind==='file'&&await fileDigest((await readFile(pageId,userId,entry.source)).bytes)!==entry.digest)throw Error('Source changed after copying; it was preserved.');
    await remove(pageId,userId,entry.source);result.moved.push(entry.source);
   }catch(e){result.failed.push({source:entry.source,error:e instanceof Error?e.message:'Source removal failed; inspect both locations.'});}
   await save();
  }
  result.state=result.failed.length?'partial':'complete';result.message=result.failed.length?'Some originals remain or require inspection. Successful copies were kept.':'Move complete.';await save();return result;
 }finally{await unlock(lease);}
}
