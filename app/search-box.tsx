'use client';
import {useEffect,useId,useRef,useState} from 'react';
import {Search,Trophy,Compass,CircleDot,BarChart3,ArrowRight} from 'lucide-react';
import {useUi} from '@/app/i18n/client';
import {localePath} from '@/app/i18n/locales';
import type {SearchHit} from '@/app/entity-db/pages';
// The search field: suggestions while the reader types (by name, from /api/suggest — no model), arrow keys to
// choose, Enter to open the chosen page or, with none chosen, the results page /search?q=…

const ICONS={topic:Compass,ranking:Trophy,view:BarChart3,entity:CircleDot};
function Highlight({text,query}:{text:string;query:string}){
 const i=query?text.toLowerCase().indexOf(query.toLowerCase().trim()):-1;
 if(i<0||!query.trim())return <>{text}</>;
 const n=query.trim().length;
 return <>{text.slice(0,i)}<mark>{text.slice(i,i+n)}</mark>{text.slice(i+n)}</>;
}

export function SearchBox({initial=''}:{initial?:string}){
 const {t,locale}=useUi();
 const [q,setQ]=useState(initial);const [hits,setHits]=useState<SearchHit[]>([]);const [open,setOpen]=useState(false);const [active,setActive]=useState(-1);
 const box=useRef<HTMLFormElement>(null);const listId=useId();
 const go=(href:string)=>{window.location.assign(localePath(href,locale));};
 const searchHref=(text:string)=>'/search?q='+encodeURIComponent(text.trim());
 useEffect(()=>{
  const text=q.trim();if(!text){setHits([]);return;}
  const ctl=new AbortController();
  const timer=setTimeout(()=>{fetch('/api/suggest?q='+encodeURIComponent(text),{signal:ctl.signal}).then(r=>r.json() as Promise<{hits?:SearchHit[]}>).then(d=>{setHits(d.hits||[]);setActive(-1);}).catch(()=>{});},110);
  return ()=>{clearTimeout(timer);ctl.abort();};
 },[q]);
 useEffect(()=>{const close=(e:MouseEvent)=>{if(!box.current?.contains(e.target as Node))setOpen(false);};document.addEventListener('mousedown',close);return ()=>document.removeEventListener('mousedown',close);},[]);
 const rows=[...hits,...(q.trim()?[{kind:'search' as const,title:q.trim(),subtitle:'',href:searchHref(q),score:9}]:[])];
 const shown=open&&q.trim().length>0;
 return <form ref={box} className="address-bar search-box" role="search" action={localePath('/search',locale)} method="get"
  onSubmit={e=>{e.preventDefault();const r=rows[active];if(r)go(r.href);else if(q.trim())go(searchHref(q));}}>
  <Search size={16} className="address-icon" aria-hidden="true"/>
  <label htmlFor={listId+'-input'} className="sr-only">{t('Search')}</label>
  <input id={listId+'-input'} name="q" type="search" value={q} autoComplete="off" spellCheck={false} enterKeyHint="search" maxLength={200}
   placeholder={t('Search an entity or a ranking — e.g. Countries, iPhone 17, Perfumes')}
   role="combobox" aria-expanded={shown} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={active>=0?listId+'-'+active:undefined}
   onChange={e=>{setQ(e.target.value);setOpen(true);}} onFocus={()=>setOpen(true)}
   onKeyDown={e=>{
    if(e.key==='ArrowDown'){e.preventDefault();setOpen(true);setActive(a=>Math.min(rows.length-1,a+1));}
    else if(e.key==='ArrowUp'){e.preventDefault();setActive(a=>Math.max(-1,a-1));}
    else if(e.key==='Escape'){setOpen(false);setActive(-1);}
   }}/>
  <button type="submit" className="go-button" aria-label={t('Search')} title={t('Search')}><ArrowRight size={16}/></button>
  {shown&&<ul className="search-suggest" id={listId} role="listbox">
   {rows.map((h,i)=>{const Icon=h.kind==='search'?Search:ICONS[h.kind];return <li key={h.href} id={listId+'-'+i} role="option" aria-selected={i===active}
    className={(i===active?'on ':'')+h.kind} onMouseEnter={()=>setActive(i)} onMouseDown={e=>{e.preventDefault();go(h.href);}}>
    <Icon size={15} aria-hidden="true"/>
    {h.kind==='search'?<span className="s-title">{t('Search for “{q}”',{q:h.title})}</span>
     :<><span className="s-title"><Highlight text={h.title} query={q}/></span><span className="s-sub">{t(h.subtitle)}</span></>}
   </li>;})}
  </ul>}
 </form>;
}

export function SearchResults({query,nodes,entities,unserved}:{query:string;nodes:SearchHit[];entities:SearchHit[];unserved:boolean}){
 const {t,locale}=useUi();
 const list=(items:SearchHit[])=><ul className="search-results">{items.map(h=>{const Icon=ICONS[h.kind];return <li key={h.href}>
  <a href={h.href}><Icon size={16} aria-hidden="true"/><span className="s-title">{h.title}</span><span className="s-sub">{t(h.subtitle)}</span></a></li>;})}</ul>;
 return <>
  <header className="wiki-heading db-hero"><span className="db-kicker"><Search size={13} aria-hidden="true"/>{t('Search')}</span>
   <h1>{query?t('Results for “{q}”',{q:query}):t('Search')}</h1>
   {query&&!unserved&&<p className="lead">{t('{count} pages found.',{count:(nodes.length+entities.length).toLocaleString(locale)})}</p>}
  </header>
  {unserved&&<div className="search-empty"><p>{t('RankWiki has no page for “{q}” yet. We only publish pages built from verified data, so nothing is made up on the spot — your search has been passed to the editors, who plan which rankings and entities to add next.',{q:query})}</p></div>}
  {nodes.length>0&&<section className="rw-explore"><h2>{t('Rankings and topics')}</h2>{list(nodes)}</section>}
  {entities.length>0&&<section className="rw-explore"><h2>{t('Entities')}</h2>{list(entities)}</section>}
 </>;
}
