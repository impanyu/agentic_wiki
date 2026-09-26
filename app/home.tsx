'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Clock3,LoaderCircle,AppWindow,FileText,X,Bot} from 'lucide-react';
import {useUi} from '@/app/i18n/client';
import type {HomeCard,CardStatus} from '@/app/api/home/route';

// The home page: recently visited pages and the newest public pages, as cards.
export function HomePage({onOpen,revision=0}:{onOpen:(card:HomeCard)=>void;revision?:number}){
 const {t,locale}=useUi();
 const [data,setData]=useState<{visited:HomeCard[];next:number|null}|null>(null),[error,setError]=useState(''),[removing,setRemoving]=useState<string|null>(null),[loadingMore,setLoadingMore]=useState(false);
 const sentinel=useRef<HTMLDivElement|null>(null);
 // Removing a card forgets that page's visits.
 async function remove(card:HomeCard){setRemoving(card.id);setError('');try{const r=await fetch('/api/history',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({pageId:card.id})});const d=await r.json() as {error?:string};if(!r.ok)throw Error(d.error||'Could not remove this page.');setData(current=>current?{...current,visited:current.visited.filter(c=>c.id!==card.id)}:current);}catch(e){setError(e instanceof Error?e.message:'Could not remove this page.');}finally{setRemoving(null);}}
 useEffect(()=>{const controller=new AbortController();setError('');fetch('/api/home',{cache:'no-store',signal:controller.signal}).then(async r=>{const d=await r.json() as {visited:HomeCard[];next?:number|null;error?:string};if(!r.ok)throw Error(d.error||'Could not load the home page.');setData({visited:d.visited,next:d.next??null});}).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Could not load the home page.');});return()=>controller.abort();},[revision]);
 // Infinite scroll: load the next 24 cards when the end of the list comes into view.
 const loadMore=useCallback(async()=>{if(!data?.next||loadingMore)return;setLoadingMore(true);try{const r=await fetch('/api/home?before='+data.next,{cache:'no-store'}),d=await r.json() as {visited:HomeCard[];next?:number|null;error?:string};if(!r.ok)throw Error(d.error||'Could not load more pages.');setData(current=>current?{visited:[...current.visited,...d.visited.filter(c=>!current.visited.some(x=>x.id===c.id))],next:d.next??null}:current);}catch(e){setError(e instanceof Error?e.message:'Could not load more pages.');}finally{setLoadingMore(false);}},[data?.next,loadingMore]);
 useEffect(()=>{const el=sentinel.current;if(!el||!data?.next)return;const io=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting))void loadMore();},{rootMargin:'400px'});io.observe(el);return()=>io.disconnect();},[data?.next,loadMore]);
 // Keep the agent badges current: poll the shown cards' statuses (faster while an agent is running).
 const anyRunning=!!data?.visited.some(c=>c.agentRunning);
 useEffect(()=>{if(!data?.visited.length)return;const ids=data.visited.map(c=>c.id).join(',');const timer=setInterval(()=>{if(document.hidden)return;fetch('/api/home?ids='+ids,{cache:'no-store'}).then(r=>r.json() as Promise<{statuses?:Record<string,CardStatus>}>).then(d=>{if(d.statuses)setData(current=>current?{...current,visited:current.visited.map(c=>d.statuses![c.id]?{...c,...d.statuses![c.id]}:c)}:current);}).catch(()=>{});},anyRunning?8000:30000);return()=>clearInterval(timer);},[data?.visited.length,anyRunning]);
 const when=(at:number|null)=>at?new Date(at).toLocaleDateString(locale,{month:'short',day:'numeric'}):'';
 const section=(title:string,Icon:typeof Clock3,cards:HomeCard[]|undefined,empty:string)=><section className="home-section" aria-label={title}>
  <h2><Icon size={16} aria-hidden="true"/>{title}</h2>
  {!data&&!error&&<p className="home-empty" role="status"><LoaderCircle className="spinner" size={15}/>{t('Loading…')}</p>}
  {data&&!cards?.length&&<p className="home-empty">{empty}</p>}
  {!!cards?.length&&<div className="home-grid">{cards.map(card=><div className="home-card-shell" key={card.id}>{<button type="button" className="home-card-remove" disabled={removing!==null} aria-label={t('Remove from history')+': '+card.title} title={t('Remove from history')} onClick={()=>void remove(card)}>{removing===card.id?<LoaderCircle className="spinner" size={13}/>:<X size={13}/>}</button>}<button type="button" className={'home-card'+(card.image?' has-image':'')} onClick={()=>onOpen(card)}>
   {card.image?<span className="home-thumb" style={{backgroundImage:'url("'+card.image.replace(/["\\]/g,'')+'")'}} aria-hidden="true"/>:<span className="home-thumb home-thumb-blank" aria-hidden="true">{card.kind==='dynamic'?<AppWindow size={26}/>:<FileText size={26}/>}</span>}
   <span className="home-card-body"><strong>{card.title}</strong><small>{card.summary}</small><span className="home-card-meta"><em>{t(card.kind==='dynamic'?'Web app':'Wiki page')}</em>{card.category&&<span>{card.category}</span>}{when(card.at)&&<span>{when(card.at)}</span>}</span>{(card.liveAgent||card.agentRunning)&&<span className="home-card-agents">{card.agentRunning&&<span className="home-agent running" title={t('An agent is working on this page now')}><LoaderCircle className="spinner" size={11}/>{t('Agent running')}</span>}{card.liveAgent&&<span className="home-agent live" title={t('Under live agent maintenance')}><Bot size={11}/>{t('Live agent on')}</span>}</span>}</span>
  </button></div>)}</div>}
  {!!cards?.length&&data?.next!=null&&<div ref={sentinel} className="home-more">{loadingMore?<><LoaderCircle className="spinner" size={15}/>{t('Loading more…')}</>:<button type="button" onClick={()=>void loadMore()}>{t('Load more')}</button>}</div>}
 </section>;
 return <div className="home-page">
  <div className="home-intro"><p>{t("A question is an address.")}</p><span>{t("Type above and press Enter, or reopen a page below.")}</span></div>
  {error&&<p className="request-error" role="alert">{t(error)}</p>}
  {section(t('Recently visited'),Clock3,data?.visited,t('No visited pages yet.'))}
 </div>;
}
