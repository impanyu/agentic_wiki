'use client';
import {ChatMarkdown} from '@/app/chat/markdown';
import {useEffect,useState,useRef} from 'react';
import {ArrowUp,MessageSquare} from 'lucide-react';
import {readEvents} from '@/app/event-stream';
import type {EditDraft} from '@/app/chat/edit-draft';
import type {AnswerPage} from '@/app/page-types';
type ChatResponse={messages?:Comment[];userName?:string;before?:number|null;editDraft?:EditDraft|null;error?:string;reply:string;page:AnswerPage;alreadySaved?:boolean;authorName?:string;createdAt?:string};
type Comment={user:string;reply:string;authorName?:string;createdAt?:string;sequence?:number};
export function PageAgentChat({page,onResult}:{page:AnswerPage;onResult:(page:AnswerPage)=>void}){
 const request=useRef<AbortController|null>(null);useEffect(()=>()=>request.current?.abort(),[]);
 const [editDraft,setEditDraft]=useState<EditDraft|null>(null),[before,setBefore]=useState<number|null>(null);
 const [messages,setMessages]=useState<Comment[]>([]),[pending,setPending]=useState<Comment|null>(null);
 const [userName,setUserName]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[ready,setReady]=useState(false);
 const zh=page.language.startsWith('zh'),wiki=page.kind==='static';
 useEffect(()=>{const c=new AbortController();fetch('/api/pages/'+page.id+'/chat',{signal:c.signal}).then(async r=>{if(!r.ok)throw Error(zh?'对话加载失败，请刷新重试。':'Could not load chat. Please refresh to retry.');return r.json() as Promise<ChatResponse>;}).then(d=>{setMessages(d.messages||[]);setUserName(d.userName||'');setBefore(d.before||null);setEditDraft(d.editDraft||null);setReady(true);}).catch(e=>{if(!c.signal.aborted)setError(e instanceof Error?e.message:'Could not load chat.');});return()=>c.abort();},[page.id,zh]);
 function complete(text:string,d:{reply:string;page:AnswerPage;editDraft?:EditDraft|null;authorName?:string;createdAt?:string}){setMessages(m=>[...m,{user:text,reply:d.reply,authorName:d.authorName||userName,createdAt:d.createdAt||new Date().toISOString()}]);setPending(null);setEditDraft(d.editDraft||null);onResult(d.page);}
 async function send(e:React.FormEvent){
  e.preventDefault();if(!message.trim()||busy)return;setBusy(true);setError('');const controller=new AbortController();request.current=controller;const text=message.trim();setMessage('');setPending({user:text,reply:'',authorName:userName,createdAt:new Date().toISOString()});
  try{
   const r=await fetch('/api/pages/'+page.id+'/chat',{signal:controller.signal,method:'POST',headers:{'Content-Type':'application/json',Accept:'text/event-stream'},body:JSON.stringify({message:text,parameters:page.parameters||page.runtime?.input})});
   if(!r.ok){const d=await r.json() as ChatResponse;throw Error(d.error||'Could not send message.');}
   if(r.headers.get('content-type')?.includes('text/event-stream')&&r.body){
    let done=false;
    for await(const event of readEvents(r.body)){
     if(controller.signal.aborted)break;
     if(event.type==='start')setPending(p=>p?{...p,authorName:String(event.authorName||userName),createdAt:String(event.createdAt||p.createdAt)}:p);
     if(event.type==='reply')setPending(p=>p?{...p,reply:String(event.text||'')}:p);
     if(event.type==='error')throw Error(String(event.message));
     if(event.type==='done'){complete(text,event as unknown as Parameters<typeof complete>[1]);done=true;break;}
    }
    if(!done&&!controller.signal.aborted)throw Error(zh?'回复中断，消息未确认保存，请重试。':'Reply interrupted. Your message was not confirmed saved. Please retry.');
   }else complete(text,await r.json());
  }catch(e){if(!controller.signal.aborted){setMessage(text);setError(e instanceof Error?e.message:'Please try again.');}}finally{if(!controller.signal.aborted){setBusy(false);setPending(null);}}
 }
 async function save(){if(!editDraft||busy)return;setBusy(true);setError('');try{const r=await fetch('/api/pages/'+page.id+'/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({saveDraftId:editDraft.id,parameters:page.parameters||{}})}),d=await r.json() as ChatResponse;if(!r.ok)throw Error(d.error||'Could not save changes.');setEditDraft(null);if(!d.alreadySaved)setMessages(m=>[...m,{user:zh?'保存更改':'Save changes',reply:d.reply,authorName:d.authorName||userName,createdAt:d.createdAt||new Date().toISOString()}]);onResult(d.page);}catch(e){setError(e instanceof Error?e.message:'Could not save changes.');}finally{setBusy(false);}}
 async function older(){if(!before)return;try{const r=await fetch('/api/pages/'+page.id+'/chat?before='+before);if(!r.ok)throw Error('Could not load earlier messages.');const d=await r.json() as ChatResponse;setMessages(m=>[...(d.messages||[]),...m]);setBefore(d.before||null);}catch(e){setError(String(e));}}
 function thread(m:Comment,key:string,streaming=false){const name=m.authorName||userName||(zh?'访客':'Guest');return <article className="chat-turn" key={key}><div className="chat-user-message"><div className="chat-message-meta"><strong>{name}</strong>{m.createdAt&&<time dateTime={m.createdAt}>{new Date(m.createdAt).toLocaleString(zh?'zh-CN':'en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</time>}</div><div className="chat-user-bubble">{m.user}</div></div><div className="chat-assistant-message"><div className="chat-message-meta"><strong>AgenticWiKi</strong>{streaming&&<span>{zh?'正在回复…':'Replying…'}</span>}</div><div className="chat-assistant-text"><ChatMarkdown text={m.reply||(streaming?(zh?'正在思考…':'Thinking…'):'')}/>{streaming&&m.reply&&<span className="comment-cursor" aria-hidden="true"/>}</div></div></article>;}
 return <section className="page-agent page-chat" aria-label={zh?'对话':'Chat'}>
  <div className="chat-heading"><h2><MessageSquare size={20}/>{zh?'对话':'Chat'}</h2><p>{wiki?(zh?'围绕本页提问、讨论，或提出修改建议。':'Ask about this page, discuss ideas, or request changes.'):(zh?'在这里继续任务，或请求修改此应用。':'Continue your task or ask for changes to this app.')}</p></div>
  {before&&<button className="older-comments" disabled={busy} onClick={()=>void older()}>{zh?'加载更早的消息':'Load earlier messages'}</button>}
  <div className="page-agent-messages" aria-busy={busy}>{messages.map((m,i)=>thread(m,String(m.sequence||i)))}{pending&&thread(pending,'pending',true)}</div>
  {ready&&!messages.length&&!pending&&<p className="comments-empty">{zh?'你想了解或修改什么？':'What would you like to explore or change?'}</p>}
  {editDraft&&page.owned&&<div className="edit-proposal"><h3>{zh?'建议的更改 · 尚未保存':'Proposed changes · Not saved'}</h3><details><summary>{zh?'预览修改后的文章':(wiki?'Preview revised article':'Preview app changes')}</summary><div className="edit-proposal-preview"><h4>{editDraft.title}</h4><p>{editDraft.summary}</p><ChatMarkdown text={editDraft.body}/></div></details><button disabled={busy} onClick={()=>void save()}>{busy?'…':zh?'保存更改':'Save changes'}</button></div>}
  <form onSubmit={send} className="chat-composer"><label className="sr-only" htmlFor={'chat-'+page.id}>{zh?'发送消息':'Message AgenticWiKi'}</label><textarea id={'chat-'+page.id} aria-label={zh?'发送消息':'Message AgenticWiKi'} placeholder={zh?'向 AgenticWiKi 发送消息…':'Message AgenticWiKi…'} value={message} onChange={e=>setMessage(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();e.currentTarget.form?.requestSubmit();}}} maxLength={2000} rows={2} disabled={busy}/><div className="chat-composer-actions"><span>{zh?'Shift + Enter 换行':'Shift + Enter for a new line'}</span><button aria-label={zh?'发送消息':'Send message'} disabled={!ready||busy||!message.trim()}><ArrowUp size={20}/></button></div></form>
  <span className="sr-only" role="status">{busy?(zh?'Agent 正在回复':'Agent is replying'):''}</span>{error&&<p role="alert">{error}</p>}
 </section>;
}
