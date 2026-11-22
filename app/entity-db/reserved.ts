// First segments of addresses that are routes of their own, and the language codes: no topic may take one as
// its slug (a topic's slug is a segment of its pages' addresses, see app/seo/paths.ts).
export const RESERVED_SEGMENTS=new Set(['api','e','p','rankings','topics','data','sitemaps','sitemap.xml','robots.txt','geo','favicon.ico','favicon.svg','_next','static','public','search','about',
 'en','zh','es','fr','de','ja','ko','ru','pt','ar','hi','it','id','tr','vi','pl']);
