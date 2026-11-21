import {SITE_NAME} from '@/app/edition';
import type {AnswerPage} from '@/app/page-types';
import {blockWorkflow} from '@/app/workflows/component-block';
import {normalizeCriteria} from '@/app/workflows/viz/ranking-data';
import {questionKey} from './urls';
// schema.org JSON-LD for a page: an ItemList (the full order of the default criterion) for a
// ranking page, an Article otherwise. Search engines and agents read it without running scripts.
type Node={type?:string;props?:Record<string,unknown>;children?:Node[]};
function findRanking(n:unknown):Node|null{
 if(Array.isArray(n)){for(const c of n){const f=findRanking(c);if(f)return f;}return null;}
 if(!n||typeof n!=='object')return null;const node=n as Node;if(node.type==='ranking')return node;
 for(const c of Array.isArray(node.children)?node.children:[]){const f=findRanking(c);if(f)return f;}
 for(const v of Object.values(node))if(Array.isArray(v))for(const c of v){const f=c&&typeof c==='object'&&c!==node?findRanking(c):null;if(f)return f;}
 return null;
}
export function rankingItems(code:string,state:Record<string,unknown>|undefined,limit=100){
 if(!state)return null;
 let w;try{w=blockWorkflow(JSON.parse(code));}catch{return null;}
 const node=findRanking(w.ui);if(!node?.props)return null;
 const p=node.props,criteria=normalizeCriteria(p.criteria);if(!criteria.length)return null;
 const first=typeof p.default==='string'&&criteria.find(c=>c.key===p.default)||criteria[0];
 const src=p.rows;const key=src&&typeof src==='object'&&'$' in (src as object)?String((src as {$:string}).$).replace(/^state\./,''):'rows';
 const rows=Array.isArray(state[key])?state[key] as Record<string,unknown>[]:[];
 const nameKey=typeof p.nameKey==='string'&&p.nameKey?p.nameKey:'name';
 const num=(v:unknown)=>{const n=typeof v==='number'?v:Number(String(v??'').replace(/,/g,''));return String(v??'').trim()!==''&&Number.isFinite(n)?n:null;};
 const ranked=rows.map(r=>({r,v:num(r[first.key])})).filter(x=>x.v!=null&&typeof x.r[nameKey]==='string')
  .sort((a,b)=>first.order==='asc'?a.v!-b.v!:b.v!-a.v!);
 return {criterion:first,total:ranked.length,items:ranked.slice(0,limit).map((x,i)=>({position:i+1,name:String(x.r[nameKey]),question:String(x.r.question??x.r[nameKey]),value:x.v!}))};
}
export function structuredData(page:AnswerPage,url:string,preloaded:Record<string,Record<string,unknown>>,askTargets:Record<string,string>,origin:string){
 const base={'@context':'https://schema.org',url,name:page.title,description:page.summary,inLanguage:page.language==='und'?undefined:page.language,
  dateModified:(page as {updatedAt?:string}).updatedAt||(page as {createdAt?:string}).createdAt,publisher:{'@type':'Organization',name:SITE_NAME,url:origin}};
 if(page.labels.templateId==='ranking-v1')for(const [code,state] of Object.entries(preloaded)){
  const list=rankingItems(code,state);
  if(list)return {...base,'@type':'ItemList',itemListOrder:list.criterion.order==='asc'?'https://schema.org/ItemListOrderAscending':'https://schema.org/ItemListOrderDescending',numberOfItems:list.total,
   itemListElement:list.items.map(i=>{const href=askTargets[questionKey(i.question)];return {'@type':'ListItem',position:i.position,name:i.name,...(href?{url:origin+href}:{})};})};
 }
 return {...base,'@type':'Article',headline:page.title.slice(0,110)};
}
// Safe inside <script type="application/ld+json">.
export const jsonLd=(v:unknown)=>JSON.stringify(v).replace(/</g,'\\u003c');
