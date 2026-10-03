import {database,getPage,lock,unlock} from '@/db/store';
import {canWritePage} from '@/app/page-permissions';

// Page and web-app versions. Every saved change records the resulting state as a numbered
// version; the first change also keeps the state before it ("Original version"), so any earlier
// state can be previewed and switched to. Switching adds no entry: the list keeps every version
// and marks the one the page currently shows, so switching back is always possible.
// Page files are not part of a version.
const COLUMNS='title,summary,body,dynamic_config,labels,kind,sources,category';
const KEEP=200;
type Snapshot={title:string;summary:string;body:string;dynamic_config:string|null;labels:string;kind:string;sources:string;category:string};
export type VersionSource='original'|'agent-edit'|'app-revision'|'editor'|'refresh'|'index'|'live-agent'|'restore';

async function current(pageId:string){return database().prepare(`SELECT ${COLUMNS} FROM pages WHERE id=?`).bind(pageId).first<Snapshot>();}
async function latest(pageId:string){return database().prepare('SELECT number,snapshot FROM page_versions WHERE page_id=? ORDER BY number DESC LIMIT 1').bind(pageId).first<{number:number;snapshot:string}>();}
async function insert(pageId:string,number:number,author:string,source:VersionSource,summary:string,snapshot:string,createdAt=new Date().toISOString()){
 await database().prepare('INSERT INTO page_versions(id,page_id,number,author_id,source,summary,snapshot,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),pageId,number,author,source,summary.slice(0,500),snapshot,createdAt).run();
}

// Call before changing a page: the first time, the existing state becomes version 1.
export async function keepOriginal(pageId:string,authorId:string){
 try{if(await latest(pageId))return;const state=await current(pageId);if(!state)return;
  const created=await database().prepare('SELECT COALESCE(updated_at,created_at) t FROM pages WHERE id=?').bind(pageId).first<{t:string}>();
  await insert(pageId,1,authorId,'original','Original version',JSON.stringify(state),created?.t||new Date().toISOString());
 }catch(e){console.error('keepOriginal failed',pageId,e instanceof Error?e.message:e);}
}
// Call after a change is saved: records the new state unless nothing changed.
export async function recordVersion(pageId:string,authorId:string,source:VersionSource,summary:string){
 const lease=await lock('page-version:'+pageId,30000);if(!lease)return;
 try{
  const state=await current(pageId);if(!state)return;const snapshot=JSON.stringify(state),last=await latest(pageId);
  if(last?.snapshot===snapshot)return;
  await insert(pageId,(last?.number||0)+1,authorId,source,summary,snapshot);
  // The routing profile follows the page's content.
  void import('@/app/routing/profiles').then(m=>m.refreshProfile(pageId)).catch(()=>{});
  const old=await database().prepare('SELECT number FROM page_versions WHERE page_id=? ORDER BY number DESC LIMIT 1 OFFSET ?').bind(pageId,KEEP).first<{number:number}>();
  if(old)await database().prepare('DELETE FROM page_versions WHERE page_id=? AND number<=? AND number>1').bind(pageId,old.number).run();
 }catch(e){console.error('recordVersion failed',pageId,e instanceof Error?e.message:e);}
 finally{await unlock(lease);}
}
// Wraps a page change: original kept before, the result recorded after a successful save.
export async function versioned<T>(pageId:string,authorId:string,source:VersionSource,summary:string,change:()=>Promise<T>):Promise<T>{
 await keepOriginal(pageId,authorId);const result=await change();await recordVersion(pageId,authorId,source,summary);return result;
}

async function editable(pageId:string,userId:string){const page=await getPage(pageId,userId);if(!page||!canWritePage(page))throw Error('Only people who can edit this page can see and restore its versions.');return page;}
export async function listVersions(pageId:string,userId:string){
 await editable(pageId,userId);
 const rows=(await database().prepare("SELECT id,number,source,summary,created_at,json_extract(snapshot,'$.title') title,snapshot FROM page_versions WHERE page_id=? AND source<>'restore' ORDER BY number DESC LIMIT 200").bind(pageId).all<{id:string;number:number;source:string;summary:string;created_at:string;title:string;snapshot:string}>()).results;
 const state=await current(pageId),now=state?JSON.stringify(state):'',active=rows.find(r=>r.snapshot===now)?.id;
 return {versions:rows.map(r=>({id:r.id,number:r.number,source:r.source,summary:r.summary,title:r.title,createdAt:r.created_at,current:r.id===active}))};
}
export async function readVersion(pageId:string,userId:string,versionId:string){
 await editable(pageId,userId);
 const row=await database().prepare('SELECT number,source,summary,snapshot,created_at FROM page_versions WHERE id=? AND page_id=?').bind(versionId,pageId).first<{number:number;source:string;summary:string;snapshot:string;created_at:string}>();if(!row)throw Error('That version is no longer available.');
 const s=JSON.parse(row.snapshot) as Snapshot,config=s.dynamic_config?JSON.parse(s.dynamic_config) as {template?:string;pageCode?:unknown}:null;
 return {number:row.number,source:row.source,summary:row.summary,createdAt:row.created_at,title:s.title,description:s.summary,body:s.body,app:config?{template:config.template||'',customFrontend:!!config.pageCode}:null};
}
export async function restoreVersion(pageId:string,userId:string,versionId:string){
 await editable(pageId,userId);
 const row=await database().prepare('SELECT number,snapshot FROM page_versions WHERE id=? AND page_id=?').bind(versionId,pageId).first<{number:number;snapshot:string}>();if(!row)throw Error('That version is no longer available.');
 const s=JSON.parse(row.snapshot) as Snapshot,config=s.dynamic_config?JSON.parse(s.dynamic_config) as {components?:Record<string,{id:string;version:number}|undefined>}:null;
 await keepOriginal(pageId,userId);
 const lease=await lock('refresh:'+pageId,90000);if(!lease)throw Error('This page is being updated. Try again in a moment.');
 try{
  await database().batch([
   database().prepare('UPDATE pages SET title=?,summary=?,body=?,dynamic_config=?,labels=?,kind=?,sources=?,category=?,updated_at=?,checked_at=NULL WHERE id=?').bind(s.title,s.summary,s.body,s.dynamic_config,s.labels,s.kind,s.sources,s.category,new Date().toISOString(),pageId),
   // Components are immutable per version, so the version's references restore its app exactly.
   ...Object.entries(config?.components||{}).filter(([,ref])=>ref).map(([role,ref])=>database().prepare('INSERT INTO component_dependencies(parent_id,role,component_id,version) VALUES(?,?,?,?) ON CONFLICT(parent_id,role) DO UPDATE SET component_id=excluded.component_id,version=excluded.version').bind(pageId,role,ref!.id,ref!.version)),
  ]);
 }finally{await unlock(lease);}
 return listVersions(pageId,userId);
}
