import type {MetadataRoute} from 'next';
import {siteUrl} from '@/app/site';
// Crawlers read the canonical pages (/p/…) listed in the sitemap. They stay out of /?ask= (it
// generates a page), /?page= (the app view of the same pages) and the API.
export const dynamic='force-dynamic';
export default function robots():MetadataRoute.Robots{
 const origin=siteUrl();
 return {rules:[{userAgent:'*',allow:'/',disallow:['/api/','/*?ask=','/*&ask=','/*?page=','/*&page=','/auth/']}],
  ...(origin?{sitemap:origin+'/sitemap.xml',host:origin}:{})};
}
