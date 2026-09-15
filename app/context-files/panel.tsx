'use client';
import {useUi} from '@/app/i18n/client';
import {canWritePage} from '@/app/page-permissions';
import {useEffect,useState} from 'react';import {Paperclip,X} from 'lucide-react';import type {ContextFile} from './server';import type {AnswerPage} from '@/app/page-types';
export function ContextFiles({page,revision,onUpload,busy}:{page:AnswerPage;revision:number;onUpload:()=>void;busy:boolean}){
 const {t,locale}=useUi();

 const [files,setFiles]=useState<ContextFile[]>([]),[error,setError]=useState('');const zh=page.language.startsWith('zh');
 useEffect(()=>{const c=new AbortController();fetch('/api/pages/'+page.id+'/files',{signal:c.signal}).then(async r=>{if(!r.ok)throw Error('Could not load attachments.');return r.json() as Promise<{files:ContextFile[]}>;}).then(r=>{setFiles(r.files);setError('');}).catch(e=>{if(!c.signal.aborted)setError(String(e));});return()=>c.abort();},[page.id,revision,page.visibility,page.publicWrite]);
 async function remove(file:ContextFile){try{const r=await fetch(file.url,{method:'DELETE'});if(!r.ok)throw Error('Could not remove attachment.');setFiles(f=>f.filter(x=>x.id!==file.id));}catch(e){setError(String(e));}}
 return <section className="context-files" aria-label={t("Context files")}><div><h2><Paperclip size={18}/>{t("Context files")}</h2><button disabled={busy} onClick={onUpload}>{t("Add files")}</button></div><p>{page.kind==='static'&&canWritePage(page)?(t("Attachments are shared with everyone who can view this page and can be used by its agent.")):(t("Files stay in your session for this page and are available to its agent."))} {t("Up to 10 MB per file.")}</p>{files.length>0&&<ul>{files.map(f=><li key={f.id}><a href={f.url}>{f.name}</a><small>{Math.max(1,Math.round(f.size/1024))}{t("KB")}</small>{f.removable&&<button disabled={busy} title={t("Remove from context")} aria-label={t("Remove ")+f.name} onClick={()=>void remove(f)}><X size={14}/></button>}</li>)}</ul>}{error&&<p role="alert">{t(error)}</p>}</section>;
}
