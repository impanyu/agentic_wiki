import {siteUrl} from '@/app/site';
import {countSitemapPages,SITEMAP_SIZE} from '@/app/seo/server';
// Sitemap index: one child sitemap per SITEMAP_SIZE public pages (the protocol allows 50,000 URLs per file).
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const origin=siteUrl()||new URL(request.url).origin;
 const parts=Math.max(1,Math.ceil(await countSitemapPages()/SITEMAP_SIZE));
 const now=new Date().toISOString();
 const body='<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
  +Array.from({length:parts},(_,i)=>`<sitemap><loc>${origin}/sitemaps/pages-${i}.xml</loc><lastmod>${now}</lastmod></sitemap>`).join('\n')+'\n</sitemapindex>\n';
 return new Response(body,{headers:{'Content-Type':'application/xml; charset=utf-8','Cache-Control':'public, max-age=3600'}});
}
