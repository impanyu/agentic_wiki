'use client';
import {SandboxView} from './sandbox-view';
import {uploadPageFiles} from '@/app/context-files/upload';
import {ResourcePicker} from '@/app/resources/picker';
import type {Mention} from '@/app/resources/contracts';
import {useUi} from '@/app/i18n/client';
import {canWritePage} from '@/app/page-permissions';
import {ChatMarkdown} from '@/app/chat/markdown';
import {useEffect,useState,useRef} from 'react';
import {ArrowUp,MessageSquare} from 'lucide-react';
import {readEvents} from '@/app/event-stream';
import type {EditDraft} from '@/app/chat/edit-draft';
import type {AnswerPage} from '@/app/page-types';
type ChatResponse={messages?:Comment[];userName?:string;before?:number|null;editDraft?:EditDraft|null;error?:string;reply:string;page:AnswerPage;alreadySaved?:boolean;authorName?:string;createdAt?:string};
type Comment={user:string;reply:string;authorName?:string;createdAt?:string;sequence?:number;activity?:string[]};
export function PageAgentChat({page,onResult,onOpenQuestion}:{page:AnswerPage;onOpenQuestion?:(question:string,passage:string)=>void;onResult:(page:AnswerPage)=>void}){
 const {t,locale}=useUi();

 const [references,setReferences]=useState<Mention[]>([]),[picker,setPicker]=useState(false);const mentionAt=useRef<number|null>(null),composer=useRef<HTMLTextAreaElement>(null);
 const uploadInput=useRef<HTMLInputElement>(null),folderInput=useRef<HTMLInputElement>(null),uploadMenu=useRef<HTMLDivElement>(null);
 const [uploadOpen,setUploadOpen]=useState(false),[uploading,setUploading]=useState(false);
 useEffect(()=>{if(!uploadOpen)return;const close=(e:PointerEvent)=>{if(!uploadMenu.current?.contains(e.target as Node))setUploadOpen(false);};const key=(e:KeyboardEvent)=>{if(e.key==='Escape')setUploadOpen(false);};document.addEventListener('pointerdown',close);document.addEventListener('keydown',key);return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',key);};},[uploadOpen]);
 async function upload(files:FileList|null){if(!files?.length)return;setUploadOpen(false);setUploading(true);setError('');try{await uploadPageFiles(page.id,Array.from(files),file=>setReferences(old=>[...old,{type:'resource' as const,resource:{space:'page' as const,id:file.id,name:file.name,kind:'file' as const}}].slice(-30)));}catch(e){setError(e instanceof Error?e.message:'Upload failed.');}finally{setUploading(false);if(uploadInput.current)uploadInput.current.value='';if(folderInput.current)folderInput.current.value='';composer.current?.focus();}}
 const request=useRef<AbortController|null>(null);useEffect(()=>()=>request.current?.abort(),[]);
 const [editDraft,setEditDraft]=useState<EditDraft|null>(null),[before,setBefore]=useState<number|null>(null);
 const [messages,setMessages]=useState<Comment[]>([]),[pending,setPending]=useState<Comment|null>(null);
 const [userName,setUserName]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[ready,setReady]=useState(false);
 const zh=page.language.startsWith('zh'),wiki=page.kind==='static';
 useEffect(()=>{const c=new AbortController();fetch('/api/pages/'+page.id+'/chat',{signal:c.signal}).then(async r=>{if(!r.ok)throw Error("Could not load chat. Please refresh to retry.");return r.json() as Promise<ChatResponse>;}).then(d=>{setMessages(d.messages||[]);setUserName(d.userName||'');setBefore(d.before||null);setEditDraft(d.editDraft||null);setReady(true);}).catch(e=>{if(!c.signal.aborted)setError(e instanceof Error?e.message:'Could not load chat.');});return()=>c.abort();},[page.id,zh]);
 // A reply started before this panel mounted (the reader left and came back) is
 // still running on the server: show it and follow it until it is saved.
 useEffect(()=>{if(!ready)return;const c=new AbortController();void(async()=>{let seen=false;while(!c.signal.aborted){try{const r=await fetch('/api/pages/'+page.id+'/chat?running=1',{cache:'no-store',signal:c.signal});const d=await r.json() as {running?:{message:string;reply:string;startedAt:string;activity?:string[]}|null};if(!d.running){if(seen){const h=await fetch('/api/pages/'+page.id+'/chat',{cache:'no-store',signal:c.signal});const hd=await h.json() as ChatResponse;setMessages(hd.messages||[]);setBefore(hd.before||null);setEditDraft(hd.editDraft||null);setPending(null);setBusy(false);}return;}if(request.current&&!request.current.signal.aborted)return;seen=true;setBusy(true);setPending({user:d.running.message,reply:d.running.reply,activity:d.running.activity,authorName:userName,createdAt:d.running.startedAt});}catch{if(c.signal.aborted)return;}await new Promise(resolve=>setTimeout(resolve,1500));}})();return()=>c.abort();},[ready,page.id]);
 function complete(text:string,d:{reply:string;page:AnswerPage;editDraft?:EditDraft|null;authorName?:string;createdAt?:string}){setMessages(m=>[...m,{user:text,reply:d.reply,authorName:d.authorName||userName,createdAt:d.createdAt||new Date().toISOString()}]);setPending(null);setEditDraft(d.editDraft||null);onResult(d.page);window.dispatchEvent(new CustomEvent('page-agent-completed',{detail:{pageId:page.id}}));}
 // The composer never locks: a message sent while the agent is replying waits in
 // a visible queue and goes out as soon as the current reply is saved.
 const [queue,setQueue]=useState<{id:string;text:string;references:Mention[]}[]>([]);
 function send(e:React.FormEvent){
  e.preventDefault();if(!message.trim()||uploading)return;const item={id:crypto.randomUUID(),text:message.trim(),references};setReferences([]);setMessage('');
  if(busy||queue.length)setQueue(q=>[...q,item]);else void run(item.text,item.references);
 }
 useEffect(()=>{if(busy||!ready||!queue.length)return;const [next,...rest]=queue;setQueue(rest);void run(next.text,next.references);},[busy,ready,queue]);
 async function run(text:string,sentReferences:Mention[]){
  setBusy(true);setError('');const controller=new AbortController();request.current=controller;setPending({user:text,reply:'',authorName:userName,createdAt:new Date().toISOString()});
  try{
   const r=await fetch('/api/pages/'+page.id+'/chat',{signal:controller.signal,method:'POST',headers:{'Content-Type':'application/json',Accept:'text/event-stream'},body:JSON.stringify({message:text,mentions:sentReferences,parameters:page.parameters||page.runtime?.input})});
   if(!r.ok){const d=await r.json() as ChatResponse;throw Error(d.error||'Could not send message.');}
   if(r.headers.get('content-type')?.includes('text/event-stream')&&r.body){
    let done=false;
    for await(const event of readEvents(r.body)){
     if(controller.signal.aborted)break;
     if(event.type==='start')setPending(p=>p?{...p,authorName:String(event.authorName||userName),createdAt:String(event.createdAt||p.createdAt)}:p);
     if(event.type==='reply')setPending(p=>p?{...p,reply:String(event.text||'')}:p);
     if(event.type==='activity')setPending(p=>p?{...p,activity:[...(p.activity||[]),String(event.message||'')].slice(-40)}:p);
     if(event.type==='error')throw Error(String(event.message));
     if(event.type==='done'){complete(text,event as unknown as Parameters<typeof complete>[1]);done=true;break;}
    }
    if(!done&&!controller.signal.aborted){const recovered=await recover(text,controller.signal);if(!recovered)throw Error("Reply interrupted. Your message was not confirmed saved. Please retry.");}
   }else complete(text,await r.json());
  }catch(e){if(!controller.signal.aborted){if(e instanceof TypeError){const recovered=await recover(text,controller.signal);if(recovered)return;}setMessage(old=>old.trim()?old:text);if(!references.length)setReferences(sentReferences);setError(e instanceof Error?e.message:'Please try again.');}}finally{if(!controller.signal.aborted){setBusy(false);setPending(null);}}
 }
 // The server keeps answering after the connection drops (a backgrounded tab, a
 // phone lock); poll the saved history until this message's reply appears.
 async function recover(text:string,signal:AbortSignal){
  setPending(p=>p?{...p,reply:p.reply||t('Connection interrupted. Waiting for the reply…')}:p);
  const deadline=Date.now()+300000;
  while(!signal.aborted&&Date.now()<deadline){
   await new Promise(resolve=>setTimeout(resolve,3000));
   try{const r=await fetch('/api/pages/'+page.id+'/chat',{cache:'no-store',signal});if(!r.ok)continue;const d=await r.json() as ChatResponse;const turn=[...(d.messages||[])].reverse().find(m=>m.user===text);if(turn){setMessages(d.messages||[]);setPending(null);setEditDraft(d.editDraft||null);setBefore(d.before||null);onResult((await (await fetch('/api/pages/'+encodeURIComponent(page.id)+'?defer=1',{cache:'no-store',signal})).json() as {page:AnswerPage}).page);return true;}}catch(e){if(signal.aborted)return false;}
  }
  return false;
 }
 async function cancelDraft(){if(!editDraft||busy)return;setBusy(true);setError('');try{const r=await fetch('/api/pages/'+page.id+'/chat',{method:'DELETE'});const d=await r.json() as {error?:string};if(!r.ok)throw Error(d.error||'Could not cancel the proposal.');setEditDraft(null);}catch(e){setError(e instanceof Error?e.message:'Could not cancel the proposal.');}finally{setBusy(false);}}
 async function save(){if(!editDraft||busy)return;setBusy(true);setError('');try{const r=await fetch('/api/pages/'+page.id+'/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({saveDraftId:editDraft.id,parameters:page.parameters||{}})}),d=await r.json() as ChatResponse;if(!r.ok)throw Error(d.error||'Could not save changes.');setEditDraft(null);if(!d.alreadySaved)setMessages(m=>[...m,{user:t("Save changes"),reply:d.reply,authorName:d.authorName||userName,createdAt:d.createdAt||new Date().toISOString()}]);onResult(d.page);}catch(e){setError(e instanceof Error?e.message:'Could not save changes.');}finally{setBusy(false);}}
 async function older(){if(!before)return;try{const r=await fetch('/api/pages/'+page.id+'/chat?before='+before);if(!r.ok)throw Error('Could not load earlier messages.');const d=await r.json() as ChatResponse;setMessages(m=>[...(d.messages||[]),...m]);setBefore(d.before||null);}catch(e){setError(String(e));}}
 function thread(m:Comment,key:string,streaming=false){const name=m.authorName||userName||t("Guest");return <article className="chat-turn" key={key}><div className="chat-user-message"><div className="chat-message-meta"><strong>{name}</strong>{m.createdAt&&<time dateTime={m.createdAt}>{new Date(m.createdAt).toLocaleString(locale,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</time>}</div><div className="chat-user-bubble">{m.user}</div></div><div className="chat-assistant-message"><div className="chat-message-meta"><strong>AgenticWiKi</strong>{streaming&&<span>{t("Replying…")}</span>}</div>{streaming&&!!m.activity?.length&&<ol className="chat-activity" aria-live="polite">{m.activity.slice(-8).map((step,i,all)=><li key={i} className={i===all.length-1&&!m.reply?'chat-activity-current':undefined}>{step}</li>)}</ol>}<div className="chat-assistant-text"><ChatMarkdown onOpenQuestion={onOpenQuestion} text={m.reply||(streaming&&!m.activity?.length?t("Thinking…"):'')}/>{streaming&&m.reply&&<span className="comment-cursor" aria-hidden="true"/>}</div></div></article>;}
 return <section className="page-agent page-chat" aria-label={t("Chat")}>
  <div className="chat-heading"><h2><MessageSquare size={20}/>{t("Chat")}</h2><p>{wiki?(t("Ask about this page, discuss ideas, or request changes.")):(t("Continue your task or ask for changes to this app."))}</p></div>
  {before&&<button className="older-comments" disabled={busy} onClick={()=>void older()}>{t("Load earlier messages")}</button>}
  <div className="page-agent-messages" aria-busy={busy}>{messages.map((m,i)=>thread(m,String(m.sequence||i)))}{pending&&thread(pending,'pending',true)}{queue.map(item=><article className="chat-turn chat-turn-queued" key={item.id}><div className="chat-user-message"><div className="chat-queued-label">{t('Queued · sends when the current reply finishes')}<button type="button" aria-label={t('Remove queued message')} onClick={()=>setQueue(q=>q.filter(x=>x.id!==item.id))}>×</button></div><p>{item.text}</p></div></article>)}</div>
  {ready&&!messages.length&&!pending&&<p className="comments-empty">{t("What would you like to explore or change?")}</p>}
  {editDraft&&canWritePage(page)&&<div className="edit-proposal"><h3>{t("Proposed changes · Not saved")}</h3><details><summary>{wiki?t("Preview revised article"):t("Preview app changes")}</summary><div className="edit-proposal-preview"><h4>{editDraft.title}</h4><p>{editDraft.summary}</p>{editDraft.indexEntries?<div className="meaning-index">{[...new Set(editDraft.indexEntries.map(entry=>entry.group))].map(group=><section key={group}>{group&&<h4>{group}</h4>}<ul>{editDraft.indexEntries!.filter(entry=>entry.group===group).map(entry=><li key={entry.question}><strong>{entry.question}</strong><p>{entry.description}</p></li>)}</ul></section>)}</div>:<ChatMarkdown text={editDraft.body}/>}{editDraft.pageCode&&<SandboxView app={editDraft.pageCode.frontend} title={editDraft.title+' preview'}/>}</div></details><button disabled={busy} onClick={()=>void save()}>{busy?'…':t("Save changes")}</button><button type="button" className="edit-proposal-cancel" disabled={busy} onClick={()=>void cancelDraft()}>{t("Cancel")}</button></div>}
  <form onSubmit={send} className="chat-composer"><label className="sr-only" htmlFor={'chat-'+page.id}>{t("Message AgenticWiKi")}</label><textarea ref={composer} id={'chat-'+page.id} aria-label={t("Message AgenticWiKi")} placeholder={t("Message AgenticWiKi…")} value={message} onChange={e=>{const value=e.target.value,at=e.target.selectionStart;setMessage(value);if(value[at-1]==='@'&&(at===1||/\s/.test(value[at-2]))){mentionAt.current=at-1;setPicker(true);}}} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();e.currentTarget.form?.requestSubmit();}}} maxLength={2000} rows={2}/>{!!references.length&&<div className="chat-references">{references.map((m,i)=><button type="button" key={i} onClick={()=>setReferences(old=>old.filter((_,j)=>i!==j))}>{m.type==='resource'?m.resource.name:m.name} ×</button>)}</div>}<div className="chat-composer-actions"><div ref={uploadMenu} className="chat-upload-control"><button type="button" className="chat-resource-button" aria-label={t('Upload files')} aria-expanded={uploadOpen} disabled={uploading} onClick={()=>setUploadOpen(!uploadOpen)}>+</button>{uploadOpen&&<div className="chat-upload-menu"><button type="button" onClick={()=>uploadInput.current?.click()}>{t('Upload files')}</button><button type="button" onClick={()=>folderInput.current?.click()}>{t('Upload folder')}</button></div>}</div><input ref={uploadInput} hidden type="file" multiple onChange={e=>void upload(e.target.files)}/><input ref={folderInput} hidden type="file" multiple {...{webkitdirectory:''}} onChange={e=>void upload(e.target.files)}/>{uploading&&<span role="status">{t('Uploading…')}</span>}<span>{t("Shift + Enter for a new line")}</span><button aria-label={t("Send message")} disabled={!ready||uploading||!message.trim()} title={busy?t('Queue this message'):undefined}><ArrowUp size={20}/></button></div></form>
  {picker&&<ResourcePicker pageId={page.id} onClose={()=>{setPicker(false);setTimeout(()=>composer.current?.focus(),0);}} onSelect={items=>{setReferences(old=>[...old,...items].slice(0,30));const labels=items.map(m=>'@['+(m.type==='resource'?m.resource.name:m.name)+']').join(' ');setMessage(old=>{const at=mentionAt.current;return (at===null?old+' '+labels+' ':old.slice(0,at)+labels+' '+old.slice(at+1)).slice(0,2000);});}}/>}
  <span className="sr-only" role="status">{busy?(t("Agent is replying")):''}</span>{error&&<p role="alert">{t(error)}</p>}
 </section>;
}
