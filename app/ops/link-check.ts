import type {Queryable} from '@/app/entity-db/client';
import {siteUrl} from '@/app/site';
import {raiseIssue} from './issues';
// Every link a reader can click must open. Each pass opens a sample of the site's pages as a reader does (rankings
// at their tree addresses, entity pages, topic pages), collects every link to our own site on them and follows each
// one: a link that does not end on a working page (404, error) is an issue, with the page it was found on. Readers
// and crawlers find broken links within the hour, and the operators see them in the issue list.
const SKIP=/^\/(auth|_next|api|sitemaps|me)(\/|$|\?)/;
async function status(base:string,path:string,signal:AbortSignal):Promise<number>{
 try{const r=await fetch(base+path,{redirect:'follow',signal,headers:{'user-agent':'RankWiki link check'}});await r.arrayBuffer().catch(()=>null);return r.status;}
 catch{return -1;}
}
async function hrefs(base:string,path:string,signal:AbortSignal):Promise<{status:number;links:string[]}>{
 try{
  const r=await fetch(base+path,{redirect:'follow',signal,headers:{'user-agent':'RankWiki link check'}});const html=await r.text();
  const links=new Set<string>();
  for(const m of html.matchAll(/href="(\/[^"#]*)"/g)){const h=m[1].replace(/&amp;/g,'&');if(!h.startsWith('//')&&!SKIP.test(h))links.add(h);}
  return {status:r.status,links:[...links]};
 }catch{return {status:-1,links:[]};}
}
async function pool<T,R>(items:T[],n:number,f:(x:T)=>Promise<R>):Promise<R[]>{
 const out:R[]=new Array(items.length);let i=0;
 await Promise.all(Array.from({length:Math.min(n,items.length)},async()=>{while(i<items.length){const k=i++;out[k]=await f(items[k]);}}));
 return out;
}
export async function linkCheck(db:Queryable,{pages=Number(process.env.LINK_CHECK_PAGES||120),maxLinks=3000}={}):Promise<{pages:number;links:number;broken:number}>{
 const base=process.env.LINK_CHECK_ORIGIN||siteUrl();if(!base)return {pages:0,links:0,broken:0};
 const {pathMaps}=await import('@/app/entity-db/pages');const {entityPath}=await import('@/app/seo/assemble');
 const maps=await pathMaps(db);
 const tree=[...maps.nodes.keys()].sort(()=>Math.random()-0.5).slice(0,Math.ceil(pages/2));
 const ents=(await db.query<{type:string;name:string;num:string}>(`select type, name, num::text from entities tablesample system (2) where has_page limit $1::int`,[Math.ceil(pages/2)])).rows
  .map(e=>entityPath(e.type,e.name,e.num));
 const signal=AbortSignal.timeout(40*60_000);
 const found=new Map<string,string>();
 const opened=await pool([...tree,...ents],6,async p=>({p,...await hrefs(base,p,signal)}));
 for(const o of opened){
  if(o.status!==200&&o.status!==-1)await raiseIssue(db,{source:'link-check',severity:'major',title:`page does not open (${o.status}): ${o.p}`,detail:'Found in the address tree or the entity pages list.',fingerprint:'link-check|'+o.p});
  for(const h of o.links)if(!found.has(h))found.set(h,o.p);
 }
 const links=[...found.keys()].slice(0,maxLinks);
 const st=await pool(links,8,h=>status(base,h,signal));
 let broken=0;
 for(let i=0;i<links.length;i++){if(st[i]===200||st[i]===-1)continue;broken++;
  await raiseIssue(db,{source:'link-check',severity:'major',title:`broken link (${st[i]}): ${links[i]}`.slice(0,300),detail:`On ${found.get(links[i])}. The link must lead to a working page (its current address, or a redirect to where its content went).`,fingerprint:'link-check|'+links[i].split('?')[0]});}
 return {pages:opened.length,links:links.length,broken};
}
