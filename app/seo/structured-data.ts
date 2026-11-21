import {SITE_NAME} from '@/app/edition';
import type {AnswerPage} from '@/app/page-types';
import {questionKey} from './urls';
import {rankedView,type RankingBlock} from './ranking-views';
// schema.org JSON-LD for a page: an ItemList (the full order of the criterion in view) for a
// ranking page, an Article otherwise. Search engines and agents read it without running scripts.
export function structuredData(page:AnswerPage,url:string,blocks:RankingBlock[],preloaded:Record<string,Record<string,unknown>>,askTargets:Record<string,string>,origin:string,rank?:string,name?:string){
 const base={'@context':'https://schema.org',url,name:name||page.title,description:page.summary,inLanguage:page.language==='und'?undefined:page.language,
  dateModified:(page as {updatedAt?:string}).updatedAt||(page as {createdAt?:string}).createdAt,publisher:{'@type':'Organization',name:SITE_NAME,url:origin}};
 for(const b of blocks){
  const state=preloaded[b.code];if(!state)continue;
  const {criterion:c,ranked}=rankedView(b,state,rank);if(!ranked.length)continue;
  return {...base,'@type':'ItemList',itemListOrder:c.order==='asc'?'https://schema.org/ItemListOrderAscending':'https://schema.org/ItemListOrderDescending',numberOfItems:ranked.length,
   itemListElement:ranked.slice(0,100).map(e=>{const href=askTargets[questionKey(e.question)];return {'@type':'ListItem',position:e.rank,name:e.name,...(href?{url:origin+href}:{})};})};
 }
 return {...base,'@type':'Article',headline:(name||page.title).slice(0,110)};
}
// Safe inside <script type="application/ld+json">.
export const jsonLd=(v:unknown)=>JSON.stringify(v).replace(/</g,'\\u003c');
