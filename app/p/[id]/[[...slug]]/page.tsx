import {cache} from 'react';
import type {Metadata} from 'next';
import {notFound,permanentRedirect} from 'next/navigation';
import {SITE_NAME} from '@/app/edition';
import {siteUrl} from '@/app/site';
import {loadPublicPage,preloadBlocks,linkedQuestions,resolveQuestions} from '@/app/seo/server';
import {structuredData,jsonLd} from '@/app/seo/structured-data';
import {Reader} from '@/app/seo/reader';
import {pagePath,slugify} from '@/app/seo/urls';
// The crawlable address of a public page: complete HTML (article, ranking with its data, links to
// existing pages), canonical URL, metadata and schema.org data. /?page=<id> stays the app view.
export const dynamic='force-dynamic';
type Props={params:Promise<{id:string;slug?:string[]}>};
const load=cache(async(id:string)=>{
 const page=await loadPublicPage(id);if(!page)return null;
 const preloaded=await preloadBlocks(page);
 const askTargets=await resolveQuestions(linkedQuestions(page,preloaded)).catch(()=>({}));
 return {page,preloaded,askTargets};
});
const decode=(s:string)=>{try{return decodeURIComponent(s);}catch{return s;}};
export async function generateMetadata({params}:Props):Promise<Metadata>{
 const {id}=await params;const data=await load(decode(id));if(!data)return {title:SITE_NAME,robots:{index:false}};
 const {page}=data,origin=siteUrl(),path=pagePath(page.id,page.title);
 const description=(page.summary||page.title).slice(0,300);
 return {title:`${page.title} · ${SITE_NAME}`,description,
  ...(origin?{metadataBase:new URL(origin)}:{}),
  alternates:{canonical:path},
  robots:{index:true,follow:true},
  openGraph:{type:'article',title:page.title,description,url:path,siteName:SITE_NAME,locale:page.language&&page.language!=='und'?page.language:undefined},
  twitter:{card:'summary',title:page.title,description}};
}
export default async function PublicPage({params}:Props){
 const {id,slug}=await params;const data=await load(decode(id));if(!data)notFound();
 const {page,preloaded,askTargets}=data;
 // One address per page: an old id (replaced page) or another slug redirects to the canonical one.
 if(page.id!==decode(id)||decode(slug?.[0]||'')!==slugify(page.title)||(slug?.length||0)>1)permanentRedirect(pagePath(page.id,page.title));
 const origin=siteUrl();
 return <>
  <script type="application/ld+json" dangerouslySetInnerHTML={{__html:jsonLd(structuredData(page,origin+pagePath(page.id,page.title),preloaded,askTargets,origin))}}/>
  <Reader page={page} preloaded={preloaded} askTargets={askTargets}/>
 </>;
}
