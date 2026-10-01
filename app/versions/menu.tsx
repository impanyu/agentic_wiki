'use client';
import {useEffect,useRef,useState} from 'react';
import {History,X,RotateCcw,Eye} from 'lucide-react';
import {useUi} from '@/app/i18n/client';
import {ChatMarkdown} from '@/app/chat/markdown';

// The page's version history in the toolbar: every saved change is a version that can be
// previewed and switched to; the list marks the version the page currently shows.
type Version={id:string;number:number;source:string;summary:string;title:string;createdAt:string;current:boolean};
type Detail={number:number;title:string;description:string;body:string;createdAt:string;app:{template:string;customFrontend:boolean}|null};
const SOURCES:Record<string,string>={original:'Original',['agent-edit']:'Page agent',['app-revision']:'App revision',editor:'Page editor',refresh:'Refresh',index:'Index update',['live-agent']:'Live agent'};
export function VersionMenu({pageId,disabled}:{pageId:string;disabled?:boolean}){
 const {t,locale}=useUi(),[open,setOpen]=useState(false),[versions,setVersions]=useState<Version[]|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[confirm,setConfirm]=useState(''),[preview,setPreview]=useState<Detail|null>(null),box=useRef<HTMLDivElement>(null);
 const api='/api/pages/'+encodeURIComponent(pageId)+'/versions';
 const load=async()=>{setError('');try{const r=await fetch(api,{cache:'no-store'}),d=await r.json() as {versions?:Version[];error?:string};if(!r.ok)throw Error(d.error||'Versions are unavailable.');setVersions(d.versions||[]);}catch(e){setError(e instanceof Error?e.message:'Versions are unavailable.');}};
 useEffect(()=>{if(open)void load();},[open]);
 useEffect(()=>{if(!open)return;const close=(e:MouseEvent)=>{if(box.current&&!box.current.contains(e.target as Node)&&!preview)setOpen(false);};const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){if(preview)setPreview(null);else setOpen(false);}};document.addEventListener('mousedown',close);window.addEventListener('keydown',key);return ()=>{document.removeEventListener('mousedown',close);window.removeEventListener('keydown',key);};},[open,preview]);
 const when=(iso:string)=>new Date(iso).toLocaleString(locale,{dateStyle:'medium',timeStyle:'short'});
 async function show(v:Version){setBusy(true);setError('');try{const r=await fetch(api+'?version='+v.id,{cache:'no-store'}),d=await r.json() as {version?:Detail;error?:string};if(!r.ok||!d.version)throw Error(d.error||'This version could not be opened.');setPreview(d.version);}catch(e){setError(e instanceof Error?e.message:'This version could not be opened.');}finally{setBusy(false);}}
 async function restore(v:Version){setBusy(true);setError('');try{const r=await fetch(api,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'restore',versionId:v.id})}),d=await r.json() as {error?:string};if(!r.ok)throw Error(d.error||'The version could not be restored.');location.reload();}catch(e){setError(e instanceof Error?e.message:'The version could not be restored.');setBusy(false);}}
 return <div className="version-menu" ref={box}>
  <button type="button" aria-expanded={open} aria-haspopup="dialog" disabled={disabled} onClick={()=>setOpen(!open)} title={t('Previous versions of this page')}><History size={15}/>{t('Versions')}{versions?.length?' ('+versions.length+')':''}</button>
  {open&&<div className="version-panel" role="dialog" aria-label={t('Versions')}>
   <header><strong>{t('Versions')}</strong><button type="button" onClick={()=>setOpen(false)} aria-label={t('Close')}><X size={15}/></button></header>
   {error&&<p role="alert" className="version-error">{error}</p>}
   {versions===null&&!error&&<p className="version-empty">{t('Loading…')}</p>}
   {versions&&!versions.length&&<p className="version-empty">{t('No earlier versions yet. Each saved change from now on becomes a version you can restore.')}</p>}
   {versions&&!!versions.length&&<ol>{versions.map(v=><li key={v.id} className={v.current?'current':''}>
    <div className="version-line"><span className="version-number">v{v.number}</span><span className="version-when">{when(v.createdAt)}</span>{v.current&&<span className="version-badge">{t('Current')}</span>}</div>
    <div className="version-what">{t(SOURCES[v.source]||v.source)}{v.summary&&v.summary!==SOURCES[v.source]?' · '+t(v.summary):''}</div>
    {v.title&&<div className="version-title">{v.title}</div>}
    {!v.current&&(confirm===v.id?<div className="version-actions"><span>{t('Switch the page to this version? All versions stay in the list.')}</span><button type="button" disabled={busy} onClick={()=>void restore(v)}>{t('Switch')}</button><button type="button" disabled={busy} onClick={()=>setConfirm('')}>{t('Cancel')}</button></div>:<div className="version-actions"><button type="button" disabled={busy} onClick={()=>void show(v)}><Eye size={13}/>{t('Preview')}</button><button type="button" disabled={busy} onClick={()=>setConfirm(v.id)}><RotateCcw size={13}/>{t('Switch to this version')}</button></div>)}
   </li>)}</ol>}
   <small className="version-note">{t('Versions cover the page text and app definition; Page files are kept as they are.')}</small>
  </div>}
  {preview&&<div className="version-preview-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setPreview(null);}}><div className="version-preview" role="dialog" aria-modal="true" aria-label={t('Version')+' '+preview.number}>
   <header><strong>v{preview.number} · {when(preview.createdAt)}</strong><button type="button" onClick={()=>setPreview(null)} aria-label={t('Close')}><X size={16}/></button></header>
   <div className="version-preview-body"><h2>{preview.title}</h2>{preview.description&&<p className="version-preview-summary">{preview.description}</p>}{preview.app&&<p className="version-preview-app">{t('Web app')} · {preview.app.template}{preview.app.customFrontend?' · '+t('custom interface'):''} — {t('switch to this version to run it.')}</p>}{preview.body?<ChatMarkdown text={preview.body}/>:!preview.app&&<p>{t('This version has no article text.')}</p>}</div>
  </div></div>}
 </div>;
}
