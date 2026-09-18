'use client';
import {useEffect,useMemo,useState,type ReactNode} from 'react';
import {BookOpen,FileText,MessageSquare,PanelLeftClose,PanelLeftOpen} from 'lucide-react';
import {useUi} from '@/app/i18n/client';
import {readSourceFile} from '@/app/tools/sources';
import {sourcePaperPdf,type PaperSource} from './source';
import './style.css';

type PaperFile={id:string;name:string;mimeType?:string};
export function PaperWorkspace({pageId,sources,revision=0,children}:{pageId:string;sources:PaperSource[];revision?:number;children:ReactNode}){
 const remotePdf=useMemo(()=>sourcePaperPdf(sources),[sources]);
 const {t}=useUi(),[files,setFiles]=useState<PaperFile[]>([]),[selected,setSelected]=useState(remotePdf?'source':''),[url,setUrl]=useState(remotePdf),[error,setError]=useState(''),[reader,setReader]=useState(true),[busy,setBusy]=useState(false);
 useEffect(()=>{let active=true;fetch('/api/pages/'+encodeURIComponent(pageId)+'/files').then(async response=>{if(!response.ok)throw Error('Page files are inaccessible.');const data=await response.json() as {files:PaperFile[]};if(active)setFiles((data.files||[]).filter(file=>file.mimeType==='application/pdf'||/\.pdf$/i.test(file.name)));}).catch(e=>{if(active)setError(e instanceof Error?e.message:String(e));});return()=>{active=false;};},[pageId,revision]);
 useEffect(()=>()=>{if(url.startsWith('blob:'))URL.revokeObjectURL(url);},[url]);
 async function open(fileId:string){setSelected(fileId);setError('');if(fileId==='source'){setUrl(old=>{if(old.startsWith('blob:'))URL.revokeObjectURL(old);return remotePdf;});setReader(true);return;}if(!fileId){setUrl(old=>{if(old.startsWith('blob:'))URL.revokeObjectURL(old);return '';});return;}setBusy(true);try{const file=await readSourceFile({page:pageId,file:fileId});if(file.type!=='application/pdf'&&!/\.pdf$/i.test(file.name))throw Error('Choose a PDF paper.');const next=URL.createObjectURL(file);setUrl(old=>{if(old.startsWith('blob:'))URL.revokeObjectURL(old);return next;});setReader(true);}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
 function ask(){document.querySelector<HTMLTextAreaElement>('.page-chat textarea')?.focus({preventScroll:false});document.querySelector('.page-chat')?.scrollIntoView({behavior:'smooth',block:'start'});}
 return <section className={'paper-workspace '+(reader?'paper-reader-open':'paper-reader-closed')}>
  <header className="paper-toolbar"><div><BookOpen size={20}/><strong>{t('Paper Reader')}</strong><span>{t('Read the paper beside its detailed wiki.')}</span></div><div><select aria-label={t('Paper PDF')} value={selected} disabled={busy} onChange={e=>void open(e.target.value)}><option value="">{t(files.length?'Choose a page PDF':'Upload a PDF in Page files')}</option>{remotePdf&&<option value="source">{t('Original paper PDF')}</option>}{files.map(file=><option key={file.id} value={file.id}>{file.name}</option>)}</select>{remotePdf&&<a className="paper-source-link" href={remotePdf} target="_blank" rel="noreferrer">{t('Open PDF')}</a>}<button type="button" onClick={()=>setReader(!reader)}>{reader?<PanelLeftClose size={16}/>:<PanelLeftOpen size={16}/>} {t(reader?'Hide reader':'Show reader')}</button><button type="button" onClick={ask}><MessageSquare size={16}/>{t('Ask page agent')}</button></div></header>
  <div className="paper-layout">
   {reader&&<aside className="paper-document" aria-label={t('Paper document')}>{url?<iframe title={selected==='source'?t('Original paper PDF'):files.find(f=>f.id===selected)?.name||t('Paper PDF')} src={url}/>:<div className="paper-empty"><FileText size={38}/><strong>{t('Open the original paper')}</strong><p>{t('Upload the PDF to Page files, then choose it here. The page agent can read selected PDF pages and update this wiki after you approve its proposal.')}</p></div>}{busy&&<p role="status">{t('Loading…')}</p>}{error&&<p role="alert">{t(error)}</p>}</aside>}
   <div className="paper-wiki">{children}</div>
  </div>
 </section>;
}
