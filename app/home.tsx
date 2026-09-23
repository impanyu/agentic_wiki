'use client';
import {useEffect,useState} from 'react';
import {Clock3,LoaderCircle,AppWindow,FileText,X} from 'lucide-react';
import {useUi} from '@/app/i18n/client';
import type {HomeCard} from '@/app/api/home/route';

// The home page: recently visited pages and the newest public pages, as cards.
export function HomePage({onOpen,revision=0}:{onOpen:(card:HomeCard)=>void;revision?:number}){
 const {t,locale}=useUi();
 const [data,setData]=useState<{visited:HomeCard[]}|null>(null),[error,setError]=useState(''),[removing,setRemoving]=useState<string|null>(null);
 // Removing a card forgets that page's visits.
 async function remove(card:HomeCard){setRemoving(card.id);setError('');try{const r=await fetch('/api/history',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({pageId:card.id})});const d=await r.json() as {error?:string};if(!r.ok)throw Error(d.error||'Could not remove this page.');setData(current=>current?{visited:current.visited.filter(c=>c.id!==card.id)}:current);}catch(e){setError(e instanceof Error?e.message:'Could not remove this page.');}finally{setRemoving(null);}}
 useEffect(()=>{const controller=new AbortController();setError('');fetch('/api/home',{cache:'no-store',signal:controller.signal}).then(async r=>{const d=await r.json() as {visited:HomeCard[];error?:string};if(!r.ok)throw Error(d.error||'Could not load the home page.');setData(d);}).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Could not load the home page.');});return()=>controller.abort();},[revision]);
 const when=(at:number|null)=>at?new Date(at).toLocaleDateString(locale,{month:'short',day:'numeric'}):'';
 const section=(title:string,Icon:typeof Clock3,cards:HomeCard[]|undefined,empty:string)=><section className="home-section" aria-label={title}>
  <h2><Icon size={16} aria-hidden="true"/>{title}</h2>
  {!data&&!error&&<p className="home-empty" role="status"><LoaderCircle className="spinner" size={15}/>{t('Loading…')}</p>}
  {data&&!cards?.length&&<p className="home-empty">{empty}</p>}
  {!!cards?.length&&<div className="home-grid">{cards.map(card=><div className="home-card-shell" key={card.id}>{<button type="button" className="home-card-remove" disabled={removing!==null} aria-label={t('Remove from history')+': '+card.title} title={t('Remove from history')} onClick={()=>void remove(card)}>{removing===card.id?<LoaderCircle className="spinner" size={13}/>:<X size={13}/>}</button>}<button type="button" className={'home-card'+(card.image?' has-image':'')} onClick={()=>onOpen(card)}>
   {card.image?<span className="home-thumb" style={{backgroundImage:'url("'+card.image.replace(/["\\]/g,'')+'")'}} aria-hidden="true"/>:<span className="home-thumb home-thumb-blank" aria-hidden="true">{card.kind==='dynamic'?<AppWindow size={26}/>:<FileText size={26}/>}</span>}
   <span className="home-card-body"><strong>{card.title}</strong><small>{card.summary}</small><span className="home-card-meta"><em>{t(card.kind==='dynamic'?'Web app':'Wiki page')}</em>{card.category&&<span>{card.category}</span>}{when(card.at)&&<span>{when(card.at)}</span>}</span></span>
  </button></div>)}</div>}
 </section>;
 return <div className="home-page">
  <div className="home-intro"><p>{t("A question is an address.")}</p><span>{t("Type above and press Enter, or reopen a page below.")}</span></div>
  {error&&<p className="request-error" role="alert">{t(error)}</p>}
  {section(t('Recently visited'),Clock3,data?.visited,t('No visited pages yet.'))}
 </div>;
}
