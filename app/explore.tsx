'use client';
import {useEffect,useState} from 'react';
import {ArrowUpRight,ChevronRight,Compass,Trophy,Layers,BarChart3,History,CircleDot} from 'lucide-react';
import {useUi} from '@/app/i18n/client';
import {localePath} from '@/app/i18n/locales';
import type {FeaturedRanking,TopicNav,NodeCard} from '@/app/entity-db/pages';
// Browsing blocks shared by the home page and the topic pages: topic tiles (each opening its own level of the
// tree) and ranking cards with their top three.

// A stable hue per topic, so a topic keeps its colour wherever it appears.
const hue=(s:string)=>{let h=0;for(const ch of s)h=(h*31+ch.charCodeAt(0))%360;return h;};

export function TopicGrid({topics,title}:{topics:TopicNav['children'];title?:string}){
 const {t,locale}=useUi();
 if(!topics.length)return null;
 return <section className="rw-explore" aria-labelledby="rw-topics-title">
  <h2 id="rw-topics-title"><Compass size={18} aria-hidden="true"/>{title||t('Browse topics')}</h2>
  <div className="rw-topics">{topics.map((x,i)=><article key={x.slug} className="rw-topic" style={{['--h' as string]:hue(x.slug),['--d' as string]:i*40+'ms'}}>
   <a className="rw-card-link" href={x.href} aria-label={x.name}/>
   <span className="rw-topic-icon" aria-hidden="true">{x.name.slice(0,1).toUpperCase()}</span>
   <div className="rw-topic-body">
    <h3>{x.name}<ChevronRight size={17} aria-hidden="true"/></h3>
    {x.description&&<p>{x.description}</p>}
    <span className="rw-topic-stats">
     {x.rankings>0&&<span><Trophy size={13} aria-hidden="true"/>{t('{count} rankings',{count:x.rankings.toLocaleString(locale)})}</span>}
     {x.pages>0&&<span><Layers size={13} aria-hidden="true"/>{t('{count} pages',{count:x.pages.toLocaleString(locale)})}</span>}
    </span>
    {x.sub.length>0&&<span className="rw-topic-sub">{x.sub.map(k=><a key={k.slug} href={k.href}>{k.name}</a>)}</span>}
   </div>
  </article>)}</div>
 </section>;
}

export function RankingGrid({rankings,title}:{rankings:FeaturedRanking[];title?:string}){
 const {t}=useUi();
 if(!rankings.length)return null;
 return <section className="rw-explore" aria-labelledby="rw-rankings-title">
  <h2 id="rw-rankings-title"><Trophy size={18} aria-hidden="true"/>{title||t('Explore rankings')}</h2>
  <div className="rw-grid">{rankings.map((r,i)=><article key={r.slug} className="rw-card" style={{['--d' as string]:Math.min(i,12)*40+'ms'}}>
   <a className="rw-card-link" href={r.href} aria-label={r.title}/>
   <header><h3>{r.title}</h3><ArrowUpRight size={18} aria-hidden="true"/></header>
   <p className="rw-card-crit">{t('By')} {r.criterion}</p>
   <ol className="rw-podium">{r.top.map(x=><li key={x.rank+x.name} className={'m'+x.rank}>
    <span className="rw-medal">{x.rank}</span>
    {x.href?<a href={x.href}>{x.name}</a>:<span className="rw-name">{x.name}</span>}
    <span className="rw-val">{x.value}</span></li>)}</ol>
   <footer>{r.criteria.map(c=><span key={c}>{c}</span>)}{r.more>0&&<span className="rw-more">+{r.more}</span>}</footer>
  </article>)}</div>
 </section>;
}

export function TypeList({types}:{types:TopicNav['types']}){
 const {t,locale}=useUi();
 if(!types.length)return null;
 return <section className="rw-explore" aria-labelledby="rw-types-title">
  <h2 id="rw-types-title"><BarChart3 size={18} aria-hidden="true"/>{t('Entity pages')}</h2>
  <div className="rw-types">{types.map(x=>{const body=<><strong>{x.plural.charAt(0).toUpperCase()+x.plural.slice(1)}</strong><span>{t('{count} pages',{count:x.pages.toLocaleString(locale)})}</span></>;
   return x.href?<a key={x.type} className="rw-type" href={x.href}>{body}<ChevronRight size={16} aria-hidden="true"/></a>:<div key={x.type} className="rw-type">{body}</div>;})}</div>
 </section>;
}

export function Breadcrumbs({trail,current}:{trail:{name:string;href:string}[];current:string}){
 const {t,locale}=useUi();
 return <nav className="rw-crumbs" aria-label={t('Breadcrumb')}><ol>
  <li><a href={localePath('/',locale)}>{t('Home')}</a></li>
  {trail.map(x=><li key={x.href}><a href={x.href}>{x.name}</a></li>)}
  <li aria-current="page">{current}</li>
 </ol></nav>;
}

// The direct children of a node in the tree of sets, the same on every node page (and the home page, the
// root): each card opens the next level. A ranking card is a set of one kind of entity; a topic card a
// broader subject.
export function NodeGrid({nodes,compact=false}:{nodes:NodeCard[];compact?:boolean}){
 const {t,locale}=useUi();
 if(!nodes.length)return null;
 return <section className={'rw-explore rw-nodes'+(compact?' compact':'')} aria-label={t('Browse')}>
  <div className="rw-topics">{nodes.map((x,i)=><article key={x.href} className={'rw-topic'+(x.live===false?' building':'')} style={{['--h' as string]:hue(x.href),['--d' as string]:Math.min(i,12)*35+'ms'}}>
   <a className="rw-card-link" href={x.href} aria-label={x.name}/>
   <span className="rw-topic-icon" aria-hidden="true">{x.kind==='ranking'?<Trophy size={compact?17:21}/>:x.name.slice(0,1).toUpperCase()}</span>
   <div className="rw-topic-body">
    <h3>{x.name}<ChevronRight size={17} aria-hidden="true"/></h3>
    {!compact&&x.description&&<p>{x.description}</p>}
    {(x.more>0||x.live===false)&&<span className="rw-topic-stats">{x.more>0&&<span><Layers size={13} aria-hidden="true"/>{t('{count} below',{count:x.more.toLocaleString(locale)})}</span>}{x.live===false&&<span className="rw-badge-building">{t('Being built')}</span>}</span>}
   </div>
  </article>)}</div>
 </section>;
}

// The reader's own history: pages opened on this device (kept in the browser only, never sent anywhere).
type Visit={title:string;href:string;kind:'ranking'|'entity'|'topic';at:number};
const VISITS='rw-visits';
const readVisits=():Visit[]=>{try{const v=JSON.parse(localStorage.getItem(VISITS)||'[]');return Array.isArray(v)?v.filter(x=>x&&typeof x.href==='string'&&typeof x.title==='string'):[];}catch{return [];}};
export function recordVisit(v:Omit<Visit,'at'>){
 try{const list=[{...v,at:Date.now()},...readVisits().filter(x=>x.href!==v.href)].slice(0,24);localStorage.setItem(VISITS,JSON.stringify(list));}catch{}
}
export function RecentlyViewed(){
 const {t}=useUi();
 const [list,setList]=useState<Visit[]>([]);
 useEffect(()=>{const here=location.pathname+location.search;setList(readVisits().filter(x=>x.href!==here).slice(0,12));},[]);
 if(!list.length)return null;
 return <section className="rw-explore rw-recent" aria-labelledby="rw-recent-title">
  <h2 id="rw-recent-title"><History size={18} aria-hidden="true"/>{t('Recently viewed')}</h2>
  <div className="rw-recent-list">{list.map(x=><a key={x.href} href={x.href} className={'rw-recent-item '+x.kind}>
   {x.kind==='ranking'?<Trophy size={14} aria-hidden="true"/>:x.kind==='entity'?<CircleDot size={14} aria-hidden="true"/>:<Compass size={14} aria-hidden="true"/>}<span>{x.title}</span></a>)}</div>
 </section>;
}
