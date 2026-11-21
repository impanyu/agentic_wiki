import {cache} from 'react';
import type {Metadata} from 'next';
import {notFound,permanentRedirect} from 'next/navigation';
import {SITE_NAME} from '@/app/edition';
import {siteUrl} from '@/app/site';
import {loadPublicPage,preloadBlocks,linkedQuestions,resolveQuestions} from '@/app/seo/server';
import {rankingBlocks,rankCriterion,rankingChartSvgs,blockPeriods} from '@/app/seo/ranking-views';
import {structuredData,jsonLd} from '@/app/seo/structured-data';
import {Reader} from '@/app/seo/reader';
import {pagePath,slugify} from '@/app/seo/urls';
// The crawlable address of a public page: complete HTML (article, ranking with its data and chart,
// links to existing pages), canonical URL, metadata and schema.org data. A ranking page also has
// one address per criterion (?rank=<key>), sorted and titled by it. /?page=<id> stays the app view.
// Everything here is rendered from the page and its data by templates; no agent runs.
export const dynamic='force-dynamic';
type Props={params:Promise<{id:string;slug?:string[]}>;searchParams:Promise<Record<string,string|string[]|undefined>>};
const load=cache(async(id:string)=>{
 const page=await loadPublicPage(id);if(!page)return null;
 const preloaded=await preloadBlocks(page);
 const askTargets=await resolveQuestions(linkedQuestions(page,preloaded)).catch(()=>({}));
 return {page,preloaded,askTargets,blocks:rankingBlocks(page.body)};
});
const decode=(s:string)=>{try{return decodeURIComponent(s);}catch{return s;}};
const one=(v:string|string[]|undefined)=>typeof v==='string'?v:undefined;
// The view a ?rank= value selects: a criterion other than the default one (the default is the plain address).
async function view(props:Props){
 const [{id},q]=await Promise.all([props.params,props.searchParams]);
 const data=await load(decode(id));if(!data)return null;
 const rank=one(q.rank),c=rankCriterion(data.blocks,rank);
 // ?year=<period>: the ranking as of that period (rows in long form); unknown periods redirect.
 const year=one(q.year),periods=new Set(data.blocks.flatMap(b=>blockPeriods(b,data.preloaded[b.code])));
 const period=year&&periods.has(year)?year:undefined;
 const isDefault=!!c&&data.blocks.some(b=>b.defaultKey===c.key);
 const criterion=c&&!isDefault?c:null;
 const base=pagePath(data.page.id,data.page.title);
 const zh=/^zh/.test(data.page.language||'');
 const defaults=new Set(data.blocks.map(b=>b.defaultKey));
 const titleFor=(key:string,label:string)=>defaults.has(key)?data.page.title:zh?`${data.page.title}（按${label}）`:`${data.page.title} by ${label}`;
 const titles=Object.fromEntries(data.blocks.flatMap(b=>b.criteria.map(x=>[x.key,titleFor(x.key,x.label)])));
 const name=(criterion?titleFor(criterion.key,criterion.label):data.page.title)+(period?(zh?`（${period}年）`:` (${period})`):'');
 const params=[criterion?'rank='+encodeURIComponent(criterion.key):'',period?'year='+encodeURIComponent(period):''].filter(Boolean).join('&');
 return {...data,rank,criterion,base,path:params?base+'?'+params:base,name,titles,year,period};
}
export async function generateMetadata(props:Props):Promise<Metadata>{
 const v=await view(props);if(!v)return {title:SITE_NAME,robots:{index:false}};
 const {page,criterion,name,path}=v,origin=siteUrl();
 const description=(criterion?`${page.title} ranked by ${criterion.label}${criterion.year?' ('+criterion.year+')':''}. `:'')+(page.summary||page.title);
 return {title:`${name} · ${SITE_NAME}`,description:description.slice(0,300),
  ...(origin?{metadataBase:new URL(origin)}:{}),
  alternates:{canonical:path},
  robots:{index:true,follow:true},
  openGraph:{type:'article',title:name,description:description.slice(0,300),url:path,siteName:SITE_NAME,locale:page.language&&page.language!=='und'?page.language:undefined},
  twitter:{card:'summary',title:name,description:description.slice(0,300)}};
}
export default async function PublicPage(props:Props){
 const {id,slug}=await props.params;const v=await view(props);if(!v)notFound();
 const {page,preloaded,askTargets,blocks,rank,criterion,base,path,name,titles,year,period}=v;
 // One address per page and view: an old id, another slug, an unknown or default ?rank= redirects.
 if(page.id!==decode(id)||decode(slug?.[0]||'')!==slugify(page.title)||(slug?.length||0)>1||(rank!==undefined&&!criterion)||(year!==undefined&&!period))permanentRedirect(path);
 const origin=siteUrl();
 const charts=await rankingChartSvgs(blocks,preloaded,criterion?.key,page.language&&page.language!=='und'?page.language:'en',period);
 return <>
  <script type="application/ld+json" dangerouslySetInnerHTML={{__html:jsonLd(structuredData(page,origin+path,blocks,preloaded,askTargets,origin,criterion?.key,name,period))}}/>
  <Reader page={page} title={name} titles={titles} period={period} preloaded={preloaded} askTargets={askTargets} rank={criterion?.key} basePath={base} defaultRanks={blocks.map(b=>b.defaultKey)} charts={charts}/>
 </>;
}
