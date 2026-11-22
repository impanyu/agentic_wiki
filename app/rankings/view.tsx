'use client';
import {useEffect,useMemo,useState,type ReactNode} from 'react';
import {Layers,ArrowRight,Trophy} from 'lucide-react';
import {UiContext,useStaticUi,useUi} from '@/app/i18n/client';
import {localePath,dirOf} from '@/app/i18n/locales';
import {LanguageSwitcher} from '@/app/i18n/switcher';
import {SearchBox} from '@/app/search-box';
import {NodeGrid,recordVisit,RecentlyViewed} from '@/app/explore';
import type {NodeCard} from '@/app/entity-db/pages';
import {SITE_NAME,PUBLIC_EDITION} from '@/app/edition';
import {AskTargets,RankingView} from '@/app/seo/link-context';
import {ThemeToggle} from '@/app/theme';
import Ranking from '@/app/workflows/viz/ranking';
import {StatCards,Position,PeerCompare,Timeline} from '@/app/workflows/viz/entity-viz';
import {Trend,RadarProfile,LocationMap,RelationGraph} from '@/app/workflows/viz/entity-charts';
import type {VizProps} from '@/app/workflows/viz/types';
import type {PageSection} from '@/app/seo/assemble';
// Browser side of the database-driven pages (/rankings/<slug>, /e/<type>/<slug>): the same shell as the
// crawlable reader (app/seo/reader.tsx) and the platform components rendered with props the server
// assembled. Everything is server-rendered; charts hydrate in the browser.

// The reader shell: header with search, article. askTargets: names → their pages (links in rankings, peers, relations).
export function DbShell({locale='en',dictionary={},askTargets,className,query='',children}:{locale?:string;dictionary?:Record<string,string>;askTargets:Record<string,string>;className:string;query?:string;children:ReactNode}){
 const ui=useStaticUi(locale,dictionary),{t}=ui;
 // Remember this page in the reader's history (this device only).
 useEffect(()=>{if(/template-search/.test(className))return;const kind=/template-ranking/.test(className)?'ranking':/template-entity/.test(className)?'entity':'topic';
  recordVisit({title:document.title.replace(/ · [^·]+$/,''),href:location.pathname+location.search,kind});},[className]);
 return <UiContext.Provider value={ui}><AskTargets.Provider value={askTargets}><div className="browser-shell" lang={locale} dir={dirOf(locale)}>
  <header className="browser-toolbar">
   <a className="browser-brand" href={localePath('/',locale)} title={t('Home')} aria-label={SITE_NAME}><Layers size={22} aria-hidden="true"/><span>{SITE_NAME}</span></a>
   <SearchBox initial={query}/>
   <LanguageSwitcher/>
   <ThemeToggle label={t('Switch theme')}/>
  </header>
  <main className="browser-content">
   {/* Page content is written in English for now; the interface around it is in the reader's language. */}
   <article className={className} lang="en" dir={dirOf(locale)}>{children}<RecentlyViewed/></article>
  </main>
 </div></AskTargets.Provider></UiContext.Provider>;
}

function useVizCtx():VizProps['ctx']{
 const {t,locale}=useUi();
 return useMemo(()=>({pageId:'',writable:false,running:{},errors:{},traces:{},locale,t,state:{}}),[t,locale]);
}
const noop=()=>{};

// The ranking with its title: a criterion or period switch retitles the page and its address (as /p does).
export function RankingBody({slug,kicker,subsets=[],title:initialTitle,baseTitle,titles,basePath,defaultRank,rank,period:initialPeriod,charts,props,lead}:{slug?:string;kicker?:string;subsets?:NodeCard[];title:string;baseTitle:string;titles:Record<string,string>;basePath:string;defaultRank:string;
 rank?:string;period?:string;charts:Record<string,string>;props:Record<string,unknown>;lead:string|null}){
 const ctx=useVizCtx();const {t}=useUi();
 const [title,setTitle]=useState(initialTitle);
 // One view per ranking per session, from the browser (what makes a ranking "popular").
 useEffect(()=>{if(!slug)return;const k='rw-viewed:'+slug;try{if(sessionStorage.getItem(k))return;sessionStorage.setItem(k,'1');}catch{}
  void fetch('/api/views',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({slug}),keepalive:true}).catch(()=>{});},[slug]);
 const [state,setState]=useState<{rank?:string;period?:string}>({rank,period:initialPeriod});
 const retitle=(next:{rank?:string;period?:string})=>{setState(next);const base=(next.rank&&titles[next.rank])||baseTitle;
  const p=next.period&&next.period!=='latest'?` (${next.period})`:'';setTitle(base+p);document.title=base+p+' · '+SITE_NAME;};
 const view={rank,charts,period:initialPeriod,rankHref:(key:string)=>key===defaultRank?basePath:basePath+'?rank='+encodeURIComponent(key),
  onRank:(key:string)=>retitle({...state,rank:key}),onPeriod:(p:string)=>retitle({...state,period:p})};
 return <RankingView.Provider value={view}>
  <header className="wiki-heading db-hero">{kicker&&<span className="db-kicker"><Trophy size={13} aria-hidden="true"/>{kicker}</span>}<h1>{title}</h1>{lead&&<p className="lead">{lead}</p>}</header>
  {subsets.length>0&&<><h2 className="rw-nodes-title">{t('Narrow down')}</h2><NodeGrid nodes={subsets} compact/></>}
  <Ranking props={props} setValue={noop} fire={noop} ctx={ctx}/>
 </RankingView.Provider>;
}

// Entity page: key figures and the template's sections, each a platform component (or a list or text).
export function EntityBody({cards,sections}:{cards:Record<string,unknown>[];sections:PageSection[]}){
 const ctx=useVizCtx();
 const viz=(s:PageSection)=>{const p={props:s.props||{},setValue:noop,fire:noop,ctx};
  switch(s.component){
   case 'trend':return <Trend {...p}/>;case 'position':return <Position {...p}/>;case 'peer_compare':return <PeerCompare {...p}/>;
   case 'radar_profile':return <RadarProfile {...p}/>;case 'location_map':return <LocationMap {...p}/>;case 'relation_graph':return <RelationGraph {...p}/>;
   case 'timeline':return <Timeline {...p}/>;
   case 'rankings':return <ul className="entity-rankings">{(s.links||[]).map(l=><li key={l.href}><a className="er-title" href={l.href}><Trophy size={15} aria-hidden="true"/><strong>{l.title}</strong></a>{l.ranks?.length?<span className="entity-ranks">{l.ranks.map((x,i)=><a key={i} className={'er-chip'+(/^(1st|2nd|3rd)\b/.test(x.text)?' top':'')} href={x.href}><span>{x.label}</span><b>{x.text}</b></a>)}</span>:l.detail&&<span className="wf-muted er-detail">{l.detail}</span>}</li>)}</ul>;
   case 'text':return <>{(s.paragraphParts||(s.paragraphs||[]).map(x=>[{text:x}])).map((x,i)=><p key={i}><LinkedText parts={x}/></p>)}</>;
   default:return null;
  }};
 return <>
  {cards.length>0&&<StatCards props={{items:cards}} setValue={noop} fire={noop} ctx={ctx}/>}
  {sections.map((s,i)=><section key={i} className="entity-section" aria-label={s.title||undefined}>{s.title&&<h2 id={'section-'+i}>{s.title}</h2>}{viz(s)}</section>)}
 </>;
}
// Assembled text with links to the pages it mentions.
export function LinkedText({parts}:{parts:{text:string;href?:string}[]}){
 return <>{parts.map((p,i)=>p.href?<a key={i} href={p.href}>{p.text}</a>:<span key={i}>{p.text}</span>)}</>;
}
