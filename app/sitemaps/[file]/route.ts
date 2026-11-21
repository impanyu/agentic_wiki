import {siteUrl} from '@/app/site';
import {sitemapPages} from '@/app/seo/server';
import {pagePath} from '@/app/seo/urls';
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
  +rows.map(r=>{const mod=lastmod(r.updatedAt);return `<url><loc>${xml(origin+pagePath(r.id,r.title))}</loc>${mod?`<lastmod>${mod}</lastmod>`:''}</url>`;}).join('\n')+'\n</urlset>\n';
 return new Response(body,{headers:{'Content-Type':'application/xml; charset=utf-8','Cache-Control':'public, max-age=3600'}});
}
