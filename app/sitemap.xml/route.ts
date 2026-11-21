import {siteUrl} from '@/app/site';
import {PUBLIC_EDITION} from '@/app/edition';
import {countSitemapPages,SITEMAP_SIZE} from '@/app/seo/server';
import {entityDb} from '@/app/entity-db/client';
import {countSitemapEntities,ENTITY_SITEMAP_SIZE} from '@/app/entity-db/pages';
// Sitemap index: one child sitemap per SITEMAP_SIZE public pages (the protocol allows 50,000 URLs per file),
// plus the database-driven pages: rankings-0.xml (every ranking and its ?rank= views) and entities-<n>.xml.
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const origin=siteUrl()||new URL(request.url).origin;
 // The public edition lists only pages built from the database (rankings, entities).
 const parts=PUBLIC_EDITION?0:Math.max(1,Math.ceil(await countSitemapPages()/SITEMAP_SIZE));
 const files=Array.from({length:parts},(_,i)=>`pages-${i}.xml`);
 // The entity database is optional here: without it the index lists the pages only.
 try{const n=await countSitemapEntities(await entityDb());files.push('rankings-0.xml',...Array.from({length:Math.ceil(n/ENTITY_SITEMAP_SIZE)},(_,i)=>`entities-${i}.xml`));}
 catch(e){console.warn('sitemap: entity database unavailable',(e as Error).message);}
 const now=new Date().toISOString();
 const body='<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
  +files.map(f=>`<sitemap><loc>${origin}/sitemaps/${f}</loc><lastmod>${now}</lastmod></sitemap>`).join('\n')+'\n</sitemapindex>\n';
 return new Response(body,{headers:{'Content-Type':'application/xml; charset=utf-8','Cache-Control':'public, max-age=3600'}});
}
