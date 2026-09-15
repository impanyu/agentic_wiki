'use client';
import {useUi} from '@/app/i18n/client';
import {useEffect,useRef,useState} from 'react';
import {History,LoaderCircle,X} from 'lucide-react';
import type {ConversionInput} from './dynamic/units';
export type HistoryEntry={id:string;pageId:string;title:string;question:string;parameters?:import('./components-registry/contracts').Parameters;visitedAt:number|null;available:boolean};
export function HistoryMenu({onOpen,beforeLoad,disabled,saveError}:{onOpen:(entry:HistoryEntry)=>void;beforeLoad:()=>Promise<unknown>;disabled:boolean;saveError:string}){
 const {t,locale}=useUi();

 const [open,setOpen]=useState(false),[entries,setEntries]=useState<HistoryEntry[]>([]),[nextOffset,setNextOffset]=useState<number|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
 const root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),close=useRef<HTMLButtonElement>(null),request=useRef<AbortController|null>(null);
 async function load(offset=0){request.current?.abort();const controller=new AbortController();request.current=controller;setLoading(true);setError('');try{await beforeLoad();if(controller.signal.aborted)return;const response=await fetch('/api/history?offset='+offset,{cache:'no-store',signal:controller.signal});const data=await response.json() as {entries:HistoryEntry[];nextOffset:number|null;error?:string};if(!response.ok)throw new Error(data.error||'Could not load history.');setEntries(current=>offset?current.concat(data.entries):data.entries);setNextOffset(data.nextOffset);}catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Could not load history.');}finally{if(!controller.signal.aborted)setLoading(false);}}
 useEffect(()=>{if(!open)return;close.current?.focus();const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false);};const keyboard=(event:KeyboardEvent)=>{if(event.key==='Escape'){setOpen(false);trigger.current?.focus();}};document.addEventListener('pointerdown',outside);document.addEventListener('keydown',keyboard);return()=>{request.current?.abort();document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',keyboard);};},[open]);
 return <div className="history-menu" ref={root}>
  <button ref={trigger} type="button" aria-label={t("History")} title={t("History")} aria-expanded={open} aria-controls="visit-history" onClick={()=>{if(open)setOpen(false);else{setOpen(true);void load();}}}><History size={19}/></button>
  {open&&<section id="visit-history" className="history-panel" aria-label={t("Visited pages")}><header><div><strong>{t("History")}</strong><span>{t("Newest first")}</span></div><button ref={close} type="button" aria-label={t("Close history")} onClick={()=>{setOpen(false);trigger.current?.focus();}}><X size={17}/></button></header>
   {(error||saveError)&&<p className="history-error" role="alert">{t(error||saveError)} <button type="button" onClick={()=>void load()}>{t("Retry")}</button></p>}
   <div className="history-list">{entries.map((entry,i)=>{const date=entry.visitedAt===null?t('Earlier visits · time unavailable'):new Date(entry.visitedAt).toLocaleDateString(locale,{weekday:'short',year:'numeric',month:'short',day:'numeric'});const previous=i?entries[i-1]:null;const previousDate=previous?.visitedAt==null?t('Earlier visits · time unavailable'):new Date(previous.visitedAt).toLocaleDateString(locale,{weekday:'short',year:'numeric',month:'short',day:'numeric'});return <div key={entry.id}>{(i===0||date!==previousDate)&&<h3>{date}</h3>}<button className="history-entry" type="button" disabled={disabled||!entry.available} onClick={()=>{setOpen(false);trigger.current?.focus();onOpen(entry);}}><span><strong>{entry.title}</strong>{entry.question&&entry.question!==entry.title&&<small>{entry.question}</small>}{!entry.available&&<small>{t("Page unavailable")}</small>}</span>{entry.visitedAt!==null&&<time dateTime={new Date(entry.visitedAt).toISOString()}>{new Date(entry.visitedAt).toLocaleTimeString(locale,{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</time>}</button></div>;})}
   {!entries.length&&!loading&&!error&&<p className="history-empty">{t("No visited pages yet.")}</p>}</div>
   {loading?<p className="history-loading" role="status"><LoaderCircle className="spinner" size={16}/>{t("Loading history…")}</p>:nextOffset!==null&&<button className="history-more" type="button" onClick={()=>void load(nextOffset)}>{t("Load older visits")}</button>}
  </section>}
 </div>;
}
