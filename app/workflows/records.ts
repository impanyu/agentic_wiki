import {database,getPage} from '@/db/store';
import {canWritePage} from '@/app/page-permissions';
// Records an app keeps between visits (expenses, tasks, observations…), stored per
// page in named collections. scope "page" is shared with everyone who can open the
// app and written by its editors; scope "user" is the current user's own records.
// While an app is verified, writes go to a scratch layer instead of the database.
export const RECORD_LIMITS={recordBytes:20_000,perCollection:5000,list:2000,batch:500};
export type RecordOverlay={added:Map<string,StoredRecord>;deleted:Set<string>};
export type StoredRecord={id:string;collection:string;owner:string;data:Record<string,unknown>;createdAt:string;updatedAt:string};
type Ctx={userId:string;pageId:string;verification?:boolean;overlay?:RecordOverlay};
type Row={id:string;collection:string;owner_id:string;data:string;created_at:string;updated_at:string};
const NAME=/^[A-Za-z][A-Za-z0-9_-]{0,47}$/;
function target(ctx:Ctx,a:Record<string,unknown>){
 const collection=String(a.collection??'');if(!NAME.test(collection))throw Error('Name the collection with letters, digits, _ or - (e.g. "expenses").');
 const scope=a.scope==='user'?'user':'page';
 return {collection,scope,owner:scope==='user'?ctx.userId:''};
}
async function access(ctx:Ctx,scope:string,write:boolean){
 if(!ctx.pageId){if(ctx.verification)return;throw Error('Records belong to a page; save the app first.');}
 const page=await getPage(ctx.pageId,ctx.userId);if(!page)throw Error('PAGE_ACCESS_DENIED');
 if(write&&scope==='page'&&!canWritePage(page))throw Error('Only editors of this app can change its shared records; use scope "user" for each visitor’s own records.');
 if(scope==='user'&&!ctx.userId)throw Error('Sign in to keep your own records.');
}
const shape=(r:StoredRecord)=>({id:r.id,createdAt:r.createdAt,updatedAt:r.updatedAt,data:r.data});
const fromRow=(r:Row):StoredRecord=>({id:r.id,collection:r.collection,owner:r.owner_id,data:JSON.parse(r.data),createdAt:r.created_at,updatedAt:r.updated_at});
async function stored(ctx:Ctx,collection:string,owner:string,limit:number){
 if(!ctx.pageId)return [];
 return (await database().prepare('SELECT id,collection,owner_id,data,created_at,updated_at FROM app_records WHERE page_id=? AND collection=? AND owner_id=? ORDER BY created_at DESC LIMIT ?').bind(ctx.pageId,collection,owner,limit).all<Row>()).results.map(fromRow);
}
export async function listRecords(ctx:Ctx,a:Record<string,unknown>){
 const {collection,scope,owner}=target(ctx,a);await access(ctx,scope,false);
 const limit=Math.max(1,Math.min(RECORD_LIMITS.list,Number(a.limit)||500));
 let list=await stored(ctx,collection,owner,RECORD_LIMITS.perCollection);
 if(ctx.overlay){const o=ctx.overlay;list=list.filter(r=>!o.deleted.has(r.id)).map(r=>o.added.get(r.id)??r);for(const r of o.added.values())if(r.collection===collection&&r.owner===owner&&!list.some(x=>x.id===r.id))list.unshift(r);}
 list.sort((x,y)=>x.createdAt<y.createdAt?1:x.createdAt>y.createdAt?-1:0);if(a.order==='oldest')list.reverse();
 return list.slice(0,limit).map(shape);
}
export async function saveRecords(ctx:Ctx,a:Record<string,unknown>){
 const {collection,scope,owner}=target(ctx,a);await access(ctx,scope,true);
 const batch=Array.isArray(a.data);const items=(batch?a.data as unknown[]:[a.data]);
 if(!items.length||items.length>RECORD_LIMITS.batch)throw Error('Save 1–'+RECORD_LIMITS.batch+' records at a time.');
 if(batch&&a.id)throw Error('Give id only when updating a single record.');
 const now=new Date().toISOString(),saved:StoredRecord[]=[];
 const existing=await stored(ctx,collection,owner,RECORD_LIMITS.perCollection);
 if(!a.id&&existing.length+items.length>RECORD_LIMITS.perCollection)throw Error('A collection holds at most '+RECORD_LIMITS.perCollection+' records.');
 for(const item of items){
  if(!item||typeof item!=='object'||Array.isArray(item))throw Error('Each record is an object of fields, e.g. {"amount": 12.5, "note": "lunch"}.');
  const text=JSON.stringify(item);if(text.length>RECORD_LIMITS.recordBytes)throw Error('A record holds at most 20 KB of data.');
  const id=a.id?String(a.id):crypto.randomUUID();
  const before=a.id?(ctx.overlay?.added.get(id)??existing.find(r=>r.id===id)):undefined;
  if(a.id&&!before)throw Error('No record '+id+' in '+collection+'.');
  const merged=a.id&&a.merge!==false?{...before!.data,...item as object}:item as Record<string,unknown>;
  const record:StoredRecord={id,collection,owner,data:JSON.parse(JSON.stringify(merged)),createdAt:before?.createdAt??now,updatedAt:now};
  if(ctx.verification){(ctx.overlay??={added:new Map(),deleted:new Set()}).added.set(id,record);}
  else if(before)await database().prepare('UPDATE app_records SET data=?,updated_at=? WHERE id=? AND page_id=? AND collection=? AND owner_id=?').bind(JSON.stringify(record.data),now,id,ctx.pageId,collection,owner).run();
  else await database().prepare('INSERT INTO app_records(id,page_id,collection,owner_id,data,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(id,ctx.pageId,collection,owner,JSON.stringify(record.data),ctx.userId,now,now).run();
  saved.push(record);
 }
 return batch?{saved:saved.length,records:saved.map(shape)}:shape(saved[0]);
}
export async function deleteRecords(ctx:Ctx,a:Record<string,unknown>){
 const {collection,scope,owner}=target(ctx,a);await access(ctx,scope,true);
 const ids=(Array.isArray(a.ids)?a.ids:a.id!=null?[a.id]:[]).map(String).filter(Boolean);
 if(!ids.length||ids.length>RECORD_LIMITS.batch)throw Error('Pass id or ids (1–'+RECORD_LIMITS.batch+').');
 if(ctx.verification){const o=(ctx.overlay??={added:new Map(),deleted:new Set()});for(const id of ids){o.added.delete(id);o.deleted.add(id);}return {deleted:ids.length};}
 let n=0;for(const id of ids)n+=(await database().prepare('DELETE FROM app_records WHERE id=? AND page_id=? AND collection=? AND owner_id=?').bind(id,ctx.pageId,collection,owner).run()).meta?.changes??0;
 return {deleted:n};
}
