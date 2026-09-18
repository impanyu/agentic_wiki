import {canWritePage} from '@/app/page-permissions';
import {env} from '@/server/runtime';
import {database,getPage,lock,unlock} from '@/db/store';
import {relocateQuote} from '@/app/api/ask/refresh-matched-page';
import type {AnswerPage} from '@/app/page-types';
import type {Agent} from '@/app/agents/runtime';
export type EditDraft={id:string;title:string;summary:string;body:string;indexEntries?:NonNullable<AnswerPage['labels']['indexEntries']>};
type StoredDraft=EditDraft&{ownerId:string;pageId:string;base:string;saved?:boolean};
const bucket=()=>(env as unknown as {FILES:R2Bucket}).FILES;
const path=(agent:Agent)=>'page-edit-drafts/'+agent.id+'.json';
export async function revision(page:Pick<AnswerPage,'title'|'summary'|'body'|'sources'>&{labels?:Pick<AnswerPage['labels'],'indexEntries'>}){const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([page.title,page.summary,page.body,page.sources,page.labels?.indexEntries])));return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');}
async function stored(agent:Agent,pageId:string){const object=await bucket().get(path(agent));if(!object)return null;const d=await object.json<StoredDraft>();return d.ownerId===agent.ownerId&&d.pageId===pageId?d:null;}
const publicDraft=(d:StoredDraft):EditDraft=>({id:d.id,title:d.title,summary:d.summary,body:d.body,indexEntries:d.indexEntries});
export async function readEditDraft(agent:Agent,pageId:string){const d=await stored(agent,pageId);return d&&!d.saved?publicDraft(d):null;}
export async function discardEditDraft(agent:Agent){await bucket().delete(path(agent));}
export async function stageEdit(agent:Agent,page:AnswerPage,content:Omit<EditDraft,'id'>){if(!page||!canWritePage(page)||page.kind!=='static')throw Error('This page is read-only.');const d:StoredDraft={id:crypto.randomUUID(),ownerId:agent.ownerId,pageId:page.id,base:await revision(page),...content};await bucket().put(path(agent),JSON.stringify(d));return publicDraft(d);}
export async function saveEditDraft(agent:Agent,pageId:string,draftId:string){
 const lease=await lock('refresh:'+pageId,90000);if(!lease)throw Error('The page is being updated. Please retry shortly.');
 try{const page=await getPage(pageId,agent.ownerId);if(!page||!canWritePage(page)||page.kind!=='static')throw Error('This page is read-only.');const d=await stored(agent,pageId);if(!d||d.id!==draftId)throw Error('This proposal has been replaced. Reload the conversation.');
 if(d.saved)return {page,alreadySaved:true};
 if(await revision(page)!==d.base){if(await revision({...d,sources:page.sources,labels:{indexEntries:d.indexEntries}})===await revision(page)){await bucket().put(path(agent),JSON.stringify({...d,saved:true}));return {page,alreadySaved:false};}throw Error('The article changed after this proposal. Ask the editor to revise it against the current article before saving.');}
 const now=new Date().toISOString(),links=await database().prepare('SELECT id,quote,segments FROM internal_links WHERE source_id=?').bind(pageId).all<{id:string;quote:string;segments:string}>();
 const update=d.indexEntries?database().prepare("UPDATE pages SET title=?,summary=?,body=?,labels=?,updated_at=?,checked_at=NULL WHERE id=? AND (owner_id=? OR (visibility='public' AND public_write=1)) AND kind='static' AND EXISTS(SELECT 1 FROM generation_locks WHERE token=? AND expires>?)").bind(d.title,d.summary,d.body,JSON.stringify({...page.labels,indexEntries:d.indexEntries}),now,pageId,agent.ownerId,lease,Date.now()):database().prepare("UPDATE pages SET title=?,summary=?,body=?,updated_at=?,checked_at=NULL WHERE id=? AND (owner_id=? OR (visibility='public' AND public_write=1)) AND kind='static' AND EXISTS(SELECT 1 FROM generation_locks WHERE token=? AND expires>?)").bind(d.title,d.summary,d.body,now,pageId,agent.ownerId,lease,Date.now());
 await database().batch([update,...links.results.map(l=>database().prepare(`UPDATE internal_links SET segments=? WHERE id=? AND EXISTS(SELECT 1 FROM pages WHERE id=? AND (owner_id=? OR (visibility='public' AND public_write=1)) AND updated_at=?)`).bind(JSON.stringify(relocateQuote(l.quote,JSON.parse(l.segments),d)),l.id,pageId,agent.ownerId,now))]);
 const updated=await getPage(pageId,agent.ownerId);if(updated?.updatedAt!==now)throw Error('The edit was not saved. Please retry.');await bucket().put(path(agent),JSON.stringify({...d,saved:true}));return {page:updated,alreadySaved:false};
 }finally{await unlock(lease);}
}
