'use client';
import {Layers,ArrowRight} from 'lucide-react';
import {UiContext,usePageUi} from '@/app/i18n/client';
import {AnswerText} from '@/app/answer-text';
import {SITE_NAME,PUBLIC_EDITION} from '@/app/edition';
import type {AnswerPage} from '@/app/page-types';
import {AskTargets} from './link-context';
import {pagePath} from './urls';
// The server-rendered reader of one public page (/p/<id>/<slug>): the same article renderer as the
// workspace, with the data of its components already loaded, so the full page is in the HTML that
// search engines and readers receive. Interactive parts (criterion picker, chart) hydrate in the browser.
export function Reader({page,preloaded,askTargets}:{page:AnswerPage;preloaded:Record<string,Record<string,unknown>>;askTargets:Record<string,string>}){
 const ui=usePageUi(page.language||'en'),{t,locale}=ui;
 const rtl=['ar','he','fa','ur','ps','dv','yi'].includes(page.language);
 return <UiContext.Provider value={ui}><AskTargets.Provider value={askTargets}><div className="browser-shell" lang={locale}>
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
    <AnswerText pageId={page.id} sources={page.sources} labels={page.labels} title={page.title} summary={page.summary} body={page.body}
     highlights={[]} concepts={[]} links={page.links||[]} preloadedBlocks={preloaded}
     onOpen={link=>{location.assign(pagePath(link.targetId,link.targetTitle));}} onJump={()=>{}}/>
   </article>
  </main>
 </div></AskTargets.Provider></UiContext.Provider>;
}
