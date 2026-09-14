import {env} from '@/server/runtime';
import {database,getPage,lock,unlock} from '@/db/store';
import {relocateQuote} from '@/app/api/ask/refresh-matched-page';
import type {AnswerPage} from '@/app/page-types';
import type {Agent} from '@/app/components-registry/agents';
export type EditDraft={id:string;title:string;summary:string;body:string};
type StoredDraft=EditDraft&{ownerId:string;pageId:string;base:string;saved?:boolean};
const bucket=()=>(env as unknown as {FILES:R2Bucket}).FILES;
const path=(agent:Agent)=>'page-edit-drafts/'+agent.id+'.json';
export async function revision(page:Pick<AnswerPage,'title'|'summary'|'body'|'sources'>){const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([page.title,page.summary,page.body,page.sources])));return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');}
async function stored(agent:Agent,pageId:string){const object=await bucket().get(path(agent));if(!object)return null;const d=await object.json<StoredDraft>();return d.ownerId===agent.ownerId&&d.pageId===pageId?d:null;}
const publicDraft=(d:StoredDraft):EditDraft=>({id:d.id,title:d.title,summary:d.summary,body:d.body});
export async function readEditDraft(agent:Agent,pageId:string){const d=await stored(agent,pageId);return d&&!d.saved?publicDraft(d):null;}
export async function discardEditDraft(agent:Agent){await bucket().delete(path(agent));}
export async function stageEdit(agent:Agent,page:AnswerPage,content:Omit<EditDraft,'id'>){if(!page.owned||page.kind!=='static')throw Error('Only the owner can edit this wiki page.');const d:StoredDraft={id:crypto.randomUUID(),ownerId:agent.ownerId,pageId:page.id,base:await revision(page),...content};await bucket().put(path(agent),JSON.stringify(d));return publicDraft(d);}
export async function saveEditDraft(agent:Agent,pageId:string,draftId:string){
 const lease=await lock('refresh:'+pageId,90000);if(!lease)throw Error('The page is being updated. Please retry shortly.');
 try{const page=await getPage(pageId,agent.ownerId);if(!page?.owned||page.kind!=='static')throw Error('Only the owner can save edits.');const d=await stored(agent,pageId);if(!d||d.id!==draftId)throw Error('This proposal has been replaced. Reload the conversation.');
 if(d.saved)return {page,alreadySaved:true};
 if(await revision(page)!==d.base){if(await revision({...d,sources:page.sources})===await revision(page)){await bucket().put(path(agent),JSON.stringify({...d,saved:true}));return {page,alreadySaved:false};}throw Error('The article changed after this proposal. Ask the editor to revise it against the current article before saving.');}
 const now=new Date().toISOString(),links=await database().prepare('SELECT id,quote,segments FROM internal_links WHERE source_id=?').bind(pageId).all<{id:string;quote:string;segments:string}>();
 await database().batch([database().prepare("UPDATE pages SET title=?,summary=?,body=?,updated_at=?,checked_at=NULL WHERE id=? AND owner_id=? AND kind='static' AND EXISTS(SELECT 1 FROM generation_locks WHERE token=? AND expires>?)").bind(d.title,d.summary,d.body,now,pageId,agent.ownerId,lease,Date.now()),...links.results.map(l=>database().prepare('UPDATE internal_links SET segments=? WHERE id=? AND EXISTS(SELECT 1 FROM pages WHERE id=? AND owner_id=? AND updated_at=?)').bind(JSON.stringify(relocateQuote(l.quote,JSON.parse(l.segments),d)),l.id,pageId,agent.ownerId,now))]);
 const updated=await getPage(pageId,agent.ownerId);if(updated?.updatedAt!==now)throw Error('The edit was not saved. Please retry.');await bucket().put(path(agent),JSON.stringify({...d,saved:true}));return {page:updated,alreadySaved:false};
 }finally{await unlock(lease);}
}
