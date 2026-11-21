'use client';
import {useState} from 'react';
import {Layers,ArrowRight} from 'lucide-react';
import {UiContext,usePageUi} from '@/app/i18n/client';
import {AnswerText} from '@/app/answer-text';
import {SITE_NAME,PUBLIC_EDITION} from '@/app/edition';
import type {AnswerPage} from '@/app/page-types';
import {AskTargets,RankingView} from './link-context';
import {pagePath} from './urls';
// The server-rendered reader of one public page (/p/<id>/<slug>): the same article renderer as the
// workspace, with the data of its components already loaded, so the full page is in the HTML that
// search engines and readers receive. Interactive parts (criterion picker, chart) hydrate in the browser.
// title: the page title, or "<title> by <criterion>" on a ?rank= view; rank/basePath/defaultRanks/charts: see RankingView.
// titles: the title of each criterion's view (key → title), so a switch in the browser retitles the page.
export function Reader({page,title:initialTitle,titles,preloaded,askTargets,rank,basePath,defaultRanks,charts,period:initialPeriod}:{period?:string;page:AnswerPage;title:string;titles:Record<string,string>;preloaded:Record<string,Record<string,unknown>>;askTargets:Record<string,string>;rank?:string;basePath:string;defaultRanks:string[];charts:Record<string,string>}){
 const ui=usePageUi(page.language||'en'),{t,locale}=ui;
 const rtl=['ar','he','fa','ur','ps','dv','yi'].includes(page.language);
 // The title names the criterion and the period in view; switches in the browser retitle the page.
 const [title,setTitle]=useState(initialTitle);
 const [state,setState]=useState<{rank?:string;period?:string}>({rank,period:initialPeriod});
 const retitle=(next:{rank?:string;period?:string})=>{setState(next);const base=(next.rank&&titles[next.rank])||page.title;
  const p=next.period&&next.period!=='latest'?(/^zh/.test(page.language||'')?`（${next.period}年）`:` (${next.period})`):'';setTitle(base+p);document.title=base+p+' · '+SITE_NAME;};
 const rankingView={rank,charts,period:initialPeriod,rankHref:(key:string)=>defaultRanks.includes(key)?basePath:basePath+'?rank='+encodeURIComponent(key),
  onRank:(key:string)=>retitle({...state,rank:key}),onPeriod:(p:string)=>retitle({...state,period:p})};
 return <UiContext.Provider value={ui}><AskTargets.Provider value={askTargets}><RankingView.Provider value={rankingView}><div className="browser-shell" lang={locale}>
  <header className="browser-toolbar">
   <a className="browser-brand" href="/" title={t('Home')} aria-label={SITE_NAME}><Layers size={22} aria-hidden="true"/><span>{SITE_NAME}</span></a>
   <form className="address-bar" action="/" method="get" role="search">
    <label htmlFor="address" className="sr-only">{t('Question or context')}</label>
    <input id="address" name="ask" type="text" placeholder={PUBLIC_EDITION?t('Search an entity or a ranking — e.g. Countries, iPhone 17, Perfumes'):t('Enter a question or context')} maxLength={4000} autoComplete="off" enterKeyHint="go" spellCheck={false}/>
    <button type="submit" className="go-button" aria-label={t('Open answer')} title={t('Open answer · Enter')}><ArrowRight size={18}/></button>
   </form>
  </header>
  <main className="browser-content">
   <article className={'answer template-'+(page.labels.templateId||'wiki-v1')} lang={page.language==='und'?undefined:page.language} dir={rtl?'rtl':'ltr'}>
    <div className="page-meta"><span>{page.category}</span></div>
    <AnswerText pageId={page.id} sources={page.sources} labels={page.labels} title={title} summary={page.summary} body={page.body}
     highlights={[]} concepts={[]} links={page.links||[]} preloadedBlocks={preloaded} dataTwins
     onOpen={link=>{location.assign(pagePath(link.targetId,link.targetTitle));}} onJump={()=>{}}/>
   </article>
  </main>
 </div></RankingView.Provider></AskTargets.Provider></UiContext.Provider>;
}
