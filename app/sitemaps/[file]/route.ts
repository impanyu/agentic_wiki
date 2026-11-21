import {siteUrl} from '@/app/site';
import {sitemapPages} from '@/app/seo/server';
import {pagePath} from '@/app/seo/urls';
import {rankingBlocks} from '@/app/seo/ranking-views';
import {entityDb} from '@/app/entity-db/client';
import {sitemapEntities,sitemapRankings,topicTree,ENTITY_SITEMAP_SIZE} from '@/app/entity-db/pages';
// /sitemaps/pages-<n>.xml: the canonical addresses of public pages, oldest first, with last change.
// /sitemaps/rankings-0.xml: every ranking definition (/rankings/<slug>) and one address per other criterion,
// and every topic page (/topics/<slug>) with something published.
// /sitemaps/entities-<n>.xml: entity pages (/e/<type>/<slug>) of types with a template or a ranking.
export const dynamic='force-dynamic';
const xml=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
const lastmod=(s:string)=>{const d=new Date(String(s).replace(' ','T')+(/[zZ]|[+-]\d\d:?\d\d$/.test(s)?'':'Z'));return Number.isNaN(d.getTime())?'':d.toISOString();};
const urlset=(urls:{loc:string;mod:string}[])=>new Response('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
 +urls.map(u=>`<url><loc>${xml(u.loc)}</loc>${u.mod?`<lastmod>${u.mod}</lastmod>`:''}</url>`).join('\n')+'\n</urlset>\n',
 {headers:{'Content-Type':'application/xml; charset=utf-8','Cache-Control':'public, max-age=3600'}});
export async function GET(request:Request,{params}:{params:Promise<{file:string}>}){
 const file=(await params).file;const origin=siteUrl()||new URL(request.url).origin;
 const db=/^(rankings|entities)-(\d{1,6})\.xml$/.exec(file);
 if(db){
  try{
   const rows=db[1]==='rankings'?(db[2]==='0'?[...await sitemapRankings(await entityDb()),...(await topicTree(await entityDb())).map(t=>({path:t.href,updatedAt:null as string|null}))]:[]):await sitemapEntities(await entityDb(),Number(db[2]),ENTITY_SITEMAP_SIZE);
   if(!rows.length&&db[2]!=='0')return new Response('Not found',{status:404});
   return urlset(rows.map(r=>({loc:origin+r.path,mod:r.updatedAt?lastmod(r.updatedAt):''})));
  }catch(e){console.warn('sitemap: entity database unavailable',(e as Error).message);return new Response('Not found',{status:404});}
 }
 const m=/^pages-(\d{1,6})\.xml$/.exec(file);if(!m)return new Response('Not found',{status:404});
 const rows=await sitemapPages(Number(m[1]));
 if(!rows.length&&m[1]!=='0')return new Response('Not found',{status:404});
 return urlset(rows.flatMap(r=>{const mod=lastmod(r.updatedAt),base=pagePath(r.id,r.title);
  // A ranking page: its plain address (default criterion) and one per other criterion.
  const blocks=r.body?rankingBlocks(r.body):[],defaults=new Set(blocks.map(b=>b.defaultKey));
  const extra=[...new Set(blocks.flatMap(b=>b.criteria.map(c=>c.key)))].filter(k=>!defaults.has(k)).slice(0,12);
  return [base,...extra.map(k=>base+'?rank='+encodeURIComponent(k))].map(u=>({loc:origin+u,mod}));}));
}
