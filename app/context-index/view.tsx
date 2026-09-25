'use client';
import {useUi} from '@/app/i18n/client';
import {useState} from 'react';import {pageAddress} from '@/app/dynamic/units';import type {AnswerPage} from '@/app/page-types';
export function ContextIndex({page,onOpen,onResult}:{page:AnswerPage;onOpen:(id:string,title:string)=>void;onResult:(page:AnswerPage)=>void}){
 const {t,locale}=useUi();
const [busy,setBusy]=useState(false),[error,setError]=useState('');const zh=page.language.startsWith('zh'),index=page.contextIndex;if(!index)return null;
 async function refresh(){setBusy(true);try{const r=await fetch('/api/pages/'+page.id+'/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(page.parameters||{})}),d=await r.json() as {page:AnswerPage;error?:string};if(!r.ok)throw Error(d.error);onResult(d.page);}catch(e){setError(String(e));}finally{setBusy(false);}}
 return <section className="context-index"><header><strong>{index.items.length} {t("results")}</strong><button disabled={busy} onClick={()=>void refresh()}>{t("Refresh")}</button></header>{!index.items.length&&<p>{index.kind==='jobs'?(t("No tasks are running right now.")):(t("No matching pages found."))}</p>}<ul>{index.items.map(item=><li key={item.id}>{item.pageId?<a href={pageAddress(item.pageId)} onClick={e=>{if(e.metaKey||e.ctrlKey||e.shiftKey||e.button!==0)return;e.preventDefault();onOpen(item.pageId!,item.title);}}>{item.title}</a>:<strong>{item.title}</strong>}<div><span>{item.kind==='static'?(t("Wiki")):t(item.kind)}</span>{item.state&&<span>{t(item.state)}</span>}<time>{item.visitedAt?t('Visited')+' '+new Date(item.visitedAt).toLocaleString(locale):new Date(item.createdAt).toLocaleString(locale)}</time></div>{item.summary&&<p>{item.summary}</p>}</li>)}</ul>{error&&<p role="alert">{t(error)}</p>}</section>;
}
