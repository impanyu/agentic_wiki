import {siteUrl} from '@/app/site';
import {sitemapPages} from '@/app/seo/server';
import {pagePath} from '@/app/seo/urls';
import {rankingBlocks} from '@/app/seo/ranking-views';
// /sitemaps/pages-<n>.xml: the canonical addresses of public pages, oldest first, with last change.
export const dynamic='force-dynamic';
const xml=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
const lastmod=(s:string)=>{const d=new Date(String(s).replace(' ','T')+(/[zZ]|[+-]\d\d:?\d\d$/.test(s)?'':'Z'));return Number.isNaN(d.getTime())?'':d.toISOString();};
export async function GET(request:Request,{params}:{params:Promise<{file:string}>}){
 const m=/^pages-(\d{1,6})\.xml$/.exec((await params).file);if(!m)return new Response('Not found',{status:404});
 const origin=siteUrl()||new URL(request.url).origin;
 const rows=await sitemapPages(Number(m[1]));
 if(!rows.length&&m[1]!=='0')return new Response('Not found',{status:404});
 const body='<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
  +rows.flatMap(r=>{const mod=lastmod(r.updatedAt),base=pagePath(r.id,r.title);
   // A ranking page: its plain address (default criterion) and one per other criterion.
   const blocks=r.body?rankingBlocks(r.body):[],defaults=new Set(blocks.map(b=>b.defaultKey));
   const extra=[...new Set(blocks.flatMap(b=>b.criteria.map(c=>c.key)))].filter(k=>!defaults.has(k)).slice(0,8);
   return [base,...extra.map(k=>base+'?rank='+encodeURIComponent(k))].map(u=>`<url><loc>${xml(origin+u)}</loc>${mod?`<lastmod>${mod}</lastmod>`:''}</url>`);}).join('\n')+'\n</urlset>\n';
 return new Response(body,{headers:{'Content-Type':'application/xml; charset=utf-8','Cache-Control':'public, max-age=3600'}});
}
