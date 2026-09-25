import {registeredAdmaPage} from '@/app/page-programs/deferred';
import {getComponent} from '@/app/components-registry/registry';
import {mentionSchema} from '@/app/resources/contracts';
import {resolveMentions} from '@/app/resources/service';
import {programNavigationInput} from '@/app/page-programs/inputs';
import {canWritePage} from '@/app/page-permissions';
import {ensurePageSession} from '@/app/chat/session';
import {startJob,finishJob} from '@/app/context-index/jobs';
import {answerStream} from '@/app/answer-stream';
import {runningTurn,trackTurn} from '@/app/chat/running';
import {activityReporter} from '@/app/agents/activity';
import {appEditCapabilities,readAppDraft,stageAppRevision,discardAppDraft,saveAppDraft,verifyCurrentApp} from '@/app/page-programs/edit-app';
import {verifyTestsSchema,type VerifyTests} from '@/app/page-programs/verify';
import {fileContext} from '@/app/context-files/server';
import {getWikiComments,postWikiComment,discardWikiDrafts} from '@/app/chat/wiki-comments';
import {sandboxStatus} from '@/app/sandboxes/service';
import {storageStatus} from '@/app/storage/oauth';
import {readEditDraft,saveEditDraft,discardEditDraft} from '@/app/chat/edit-draft';
import {editWiki} from '@/app/chat/edit-page';
import {saveTurn,readTurns,conversationContext} from '@/app/chat/history';
import {runPageProgram} from '@/app/page-programs/runtime';
import {connectionStatus,listFolders} from '@/app/connections/google-drive/service';
import {z} from 'zod';
import {getActor} from '@/app/actor';
import {database,getPage,reply,sameOrigin,lock,unlock} from '@/db/store';
import {askAgent,memory,recordAction,type Agent} from '@/app/agents/runtime';
import {executePage} from '@/app/components-registry/runtime';
import {parametersSchema} from '@/app/components-registry/contracts';
import {validateGenerationDraft} from '@/app/page-programs/generation-draft';
import {runProgram} from '@/app/sandboxes/service';
import {codeSchema} from '@/app/sandboxes/contracts';
import {session,respond,handlePost} from '@/app/chat/page-turn';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 try{const id=(await params).id,s=await session(request,id),rawPage=await getPage(id,s.userId),page=rawPage?registeredAdmaPage(rawPage):null;if(!page)return reply({error:'This page is private or does not exist.'},404);
 if(new URL(request.url).searchParams.has('running'))return respond({running:runningTurn(id,s.userId)},s.cookie);
 if(page.kind==='static')return getWikiComments(request,page,s);
 const before=Number(new URL(request.url).searchParams.get('before'))||undefined;
 if(before!==undefined&&(!Number.isSafeInteger(before)||before<1))return respond({error:'Invalid history cursor.'},s.cookie,400);
 const history=await readTurns(s.agent,before);
 if(!history.messages.length&&!before){const recent=await memory(s.agent);history.messages=recent.filter(m=>m.action.startsWith('User: ')).map(m=>({user:m.action.slice(6),reply:JSON.parse(m.result).reply||'',sequence:0,createdAt:''}));}
 return respond({...history,sessionId:s.agent.id,userName:s.userName,editDraft:canWritePage(page)&&page.dynamic?await readAppDraft(s.agent,page.id):null},s.cookie);
 }catch{return reply({error:'Could not load the page conversation.'},503);}
}
// Cancel an unsaved proposal without touching the page.
export async function DELETE(request:Request,{params}:{params:Promise<{id:string}>}){
 if(!sameOrigin(request))return reply({error:'This request must come from the site.'},403);
 try{const id=(await params).id,s=await session(request,id),rawPage=await getPage(id,s.userId),page=rawPage?registeredAdmaPage(rawPage):null;if(!page)return reply({error:'This page is private or does not exist.'},404);
  if(page.kind==='static')await discardWikiDrafts(page,s);else await Promise.all([discardAppDraft(s.agent),discardEditDraft(s.agent)]);
  return respond({discarded:true},s.cookie);
 }catch{return reply({error:'Could not cancel the proposal.'},503);}
}
export async function POST(request:Request,route:{params:Promise<{id:string}>}){
 const actor=await getActor(request);
 if(!request.headers.get('accept')?.includes('text/event-stream'))return handlePost(request,route,actor);
 const body=await request.text();let message='';try{const parsed=JSON.parse(body) as {message?:unknown;saveDraftId?:unknown};if(typeof parsed.message==='string'&&!parsed.saveDraftId)message=parsed.message.trim();}catch{}
 const track=message?trackTurn((await route.params).id,actor.userId,message):undefined;
 return actor.finish(answerStream((signal,emit)=>handlePost(new Request(request.url,{method:'POST',headers:request.headers,body,signal}),route,actor,text=>emit({type:'reply',text}),message=>emit({type:'activity',message})),request.signal,'Reading your message…',track));
}
