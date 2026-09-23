import {readAppDraft,saveAppDraft} from '@/app/page-programs/edit-app';
import {resolveMentions} from '@/app/resources/service';
import type {Mention} from '@/app/resources/contracts';
import {ensureRoleSession} from './session';
import {canWritePage} from '@/app/page-permissions';
import {startJob,finishJob} from '@/app/context-index/jobs';
import {fileContext} from '@/app/context-files/server';
import {database,reply,lock,unlock} from '@/db/store';
import type {AnswerPage} from '@/app/page-types';
import type {Agent} from '@/app/agents/runtime';
import {conversationContext} from './history';
import {importLegacyComments} from './shared-history';
import {editWiki} from './edit-page';
import {readEditDraft,saveEditDraft} from './edit-draft';
type Viewer={userId:string;userName:string;cookie:string|null;agent:Agent};
async function commentAgent(pageId:string,viewer:Viewer){
 return ensureRoleSession('comments:'+pageId,viewer.userId);
}
function finish(response:Response,viewer:Viewer){if(viewer.cookie)response.headers.set('Set-Cookie',viewer.cookie);return response;}
async function saveComment(pageId:string,agent:Agent,viewer:Viewer,message:string,response:string,createdAt:string){
 const saved=await database().batch([
  database().prepare('INSERT INTO wiki_comments(page_id,session_id,author_name,message,reply,created_at) SELECT p.id,a.id,?,?,?,? FROM pages p,agent_instances a WHERE p.id=? AND (p.visibility=\'public\' OR p.owner_id=?) AND a.id=? AND a.owner_id=?').bind(viewer.userName,message,response,createdAt,pageId,viewer.userId,agent.id,viewer.userId),
  database().prepare('INSERT INTO page_chat_turns(session_id,message,reply,created_at) SELECT a.id,?,?,? FROM agent_instances a JOIN pages p ON p.id=? WHERE a.id=? AND a.owner_id=? AND (p.visibility=\'public\' OR p.owner_id=?)').bind(message,response,createdAt,pageId,agent.id,viewer.userId,viewer.userId),
 ]);
 if(!saved[0].meta.changes)throw Error('Page access changed before the comment was saved.');
}
export async function getWikiComments(request:Request,page:AnswerPage,viewer:Viewer){
 const before=Number(new URL(request.url).searchParams.get('before'))||Number.MAX_SAFE_INTEGER;
 if(!Number.isSafeInteger(before)||before<1)return finish(reply({error:'Invalid comments cursor.'},400),viewer);
 await importLegacyComments(page.id,viewer.userId,viewer.userName);
 const agent=await commentAgent(page.id,viewer);
 const rows=await database().prepare('SELECT sequence,message user,reply,author_name authorName,created_at createdAt FROM wiki_comments WHERE page_id=? AND sequence<? ORDER BY sequence DESC LIMIT 51').bind(page.id,before).all<{sequence:number;user:string;reply:string;authorName:string;createdAt:string}>();
 const messages=rows.results.slice(0,50).reverse();
 return finish(reply({messages,before:rows.results.length>50?messages[0]?.sequence:null,userName:viewer.userName,editDraft:canWritePage(page)?(await readAppDraft(agent,page.id)||await readEditDraft(agent,page.id)||await readEditDraft(viewer.agent,page.id)):null}),viewer);
}
export async function postWikiComment(request:Request,page:AnswerPage,viewer:Viewer,data:{message?:string;saveDraftId?:string;mentions?:Mention[]}){
 await importLegacyComments(page.id,viewer.userId,viewer.userName);
 const agent=await commentAgent(page.id,viewer);
 if(data.saveDraftId&&!canWritePage(page))return finish(reply({error:'This page is read-only.'},403),viewer);
 if(!data.message&&!data.saveDraftId)return finish(reply({error:'Enter a message.'},400),viewer);
 const lease=await lock('agent:'+agent.id,660000);if(!lease)return finish(reply({error:'The agent is still replying to your previous message.'},409),viewer);
 let jobId:string;try{jobId=await startJob(viewer.userId,'wiki-agent',data.message||'Save wiki revision',page.id);}catch(e){await unlock(lease);throw e;}let jobState='completed';
 let released=false;const release=async()=>{if(released)return;await unlock(lease);released=true;await finishJob(jobId,jobState).catch(()=>{});};
 const run=async(onReply?:(text:string)=>void,signal?:AbortSignal)=>{
  const createdAt=new Date().toISOString();
  if(data.saveDraftId){const draftAgent=(await readEditDraft(viewer.agent,page.id))?.id===data.saveDraftId?viewer.agent:agent;const result=(await readAppDraft(agent,page.id))?.id===data.saveDraftId?await saveAppDraft(agent,page.id,data.saveDraftId):await saveEditDraft(draftAgent,page.id,data.saveDraftId),response=page.language.startsWith('zh')?'更改已保存。':'Changes saved.';if(!result.alreadySaved)await saveComment(page.id,agent,viewer,page.language.startsWith('zh')?'保存更改':'Save changes',response,createdAt);return {page:result.page,reply:response,alreadySaved:result.alreadySaved,editDraft:null,authorName:viewer.userName,createdAt};}
  const ownConversation=await conversationContext(agent);
  const recent=await database().prepare('SELECT author_name author,message,reply FROM wiki_comments WHERE page_id=? ORDER BY sequence DESC LIMIT 30').bind(page.id).all();
  const selectedFileIds=data.mentions?.flatMap(m=>m.type==='resource'&&m.resource.space==='page'&&m.resource.kind==='file'?[m.resource.id]:[])||[];
  const attachments=await fileContext(page.id,viewer.userId,selectedFileIds.length?selectedFileIds:undefined);
  const context={ownConversation,pageDiscussion:recent.results.reverse(),attachedFiles:attachments.metadata,selectedReferences:data.mentions?.length?await resolveMentions(page.id,viewer.userId,data.mentions||[]):[]};
  const result=await editWiki(page,data.message!,context,viewer.userId,agent,onReply,signal,attachments.parts);
  signal?.throwIfAborted();
  await saveComment(page.id,agent,viewer,data.message!,result.reply,createdAt);
  return {...result,authorName:viewer.userName,createdAt};
 };
 if(!request.headers.get('accept')?.includes('text/event-stream')||data.saveDraftId){try{return finish(reply(await run()),viewer);}catch(error){console.error('Wiki chat failed',error instanceof Error?error.name:'UnknownError');jobState='failed';return finish(reply({error:'The agent could not finish. Please try again.'},503),viewer);}finally{await release().catch(()=>{});}}
 // A dropped connection (background tab, phone lock) must not cancel the reply:
 // the run finishes and saves the turn, and the client recovers it from history.
 const lifetime=new AbortController(),signal=AbortSignal.any([lifetime.signal,AbortSignal.timeout(600000)]),encoder=new TextEncoder();
 let detached=request.signal.aborted;request.signal.addEventListener('abort',()=>{detached=true;},{once:true});
 const stream=new ReadableStream<Uint8Array>({start(controller){let closed=false;const send=(event:unknown)=>{if(!closed&&!detached&&!signal.aborted){try{controller.enqueue(encoder.encode('data: '+JSON.stringify(event)+'\n\n'));}catch{detached=true;}}};send({type:'start',authorName:viewer.userName,createdAt:new Date().toISOString()});const heartbeat=setInterval(()=>send({type:'ping'}),10000);
 void(async()=>{try{const result=await run(text=>send({type:'reply',text}),signal);await release();send({type:'done',...result});}catch(error){console.error('Wiki chat failed',error instanceof Error?error.name:'UnknownError',error instanceof Error&&/^(AI_|INCOMPLETE_)/.test(error.message)?error.message.slice(0,80):'generation-or-save');jobState='failed';await release().catch(()=>{});if(!signal.aborted)send({type:'error',message:'The reply did not finish. This message was not saved. Please try again.'});}finally{clearInterval(heartbeat);if(signal.aborted&&!released)jobState='cancelled';await release().catch(()=>{});closed=true;try{controller.close();}catch{}}})();
 },cancel(){detached=true;}});
 return finish(new Response(stream,{headers:{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store, private','Vary':'Cookie','X-Accel-Buffering':'no'}}),viewer);
}
