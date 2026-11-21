import {cache} from 'react';
import type {Metadata} from 'next';
import {notFound,permanentRedirect} from 'next/navigation';
import {SITE_NAME} from '@/app/edition';
import {siteUrl} from '@/app/site';
import {entityDb} from '@/app/entity-db/client';
import {loadRankingPage,withPages} from '@/app/entity-db/pages';
import {assembleRankingPage,entityPath,rankingPath} from '@/app/seo/assemble';
import {propsRankingBlock,rankCriterion,blockPeriods,rankedView,rankingChartSvgs} from '@/app/seo/ranking-views';
import {jsonLd} from '@/app/seo/structured-data';
import {questionKey} from '@/app/seo/urls';
import {DbShell,RankingBody} from '../view';
// /rankings/<slug>: a ranking definition rendered from the entity database by templates (no agent at page
// time). Rows come from metric_table over the definition's scope and criteria (every period in long form:
// year picker, time views), at most the top 1,000 per criterion. Like /p, every criterion has its own
// address (?rank=<key>, the default criterion is the plain address) and every period too (?year=).
export const dynamic='force-dynamic';
type Props={params:Promise<{slug:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>};
const decode=(s:string)=>{try{return decodeURIComponent(s);}catch{return s;}};
const one=(v:string|string[]|undefined)=>typeof v==='string'?v:undefined;
const load=cache(async(slug:string)=>{
 const db=await entityDb();const input=await loadRankingPage(db,slug);if(!input)return null;
 const model=assembleRankingPage(input,'en');
 const props:Record<string,unknown>={criteria:model.criteria,rows:model.rows,default:model.defaultKey,periodKey:'period',
  ...(model.groupKey?{groupKey:model.groupKey}:{}),...(Array.isArray(input.def.config.views)?{views:input.def.config.views}:{}),
  ...(model.sources.length?{source:model.sources.join('; ')}:{})};
 const block=propsRankingBlock(props)!;
 // Members link to their pages; one without a page (too little data yet) is plain text.
 const pages=await withPages(db,model.rows.map(r=>String(r.entity_id||'')));
 const askTargets:Record<string,string>={};
 for(const r of model.rows){const n=String(r.name||''),t=String(r.type||'');if(n&&t&&pages.has(String(r.entity_id||''))&&!askTargets[questionKey(n)])askTargets[questionKey(n)]=entityPath(t,n);}
 return {input,model,props,block,state:{rows:model.rows},askTargets};
});
async function view(props:Props){
 const [{slug},q]=await Promise.all([props.params,props.searchParams]);
 const data=await load(decode(slug));if(!data)return null;
 const {model,block,state}=data;
 const rank=one(q.rank),c=model.criteria.length?rankCriterion([block],rank):null;
 const year=one(q.year),period=year&&blockPeriods(block,state).includes(year)?year:undefined;
 const criterion=c&&c.key!==block.defaultKey?c:null;
 const base=rankingPath(data.input.def.slug);
 const titleFor=(key:string,label:string)=>key===block.defaultKey?model.title:`${model.title} by ${label}`;
 const titles=Object.fromEntries(model.criteria.map(x=>[x.key,titleFor(x.key,x.label)]));
 const name=(criterion?titleFor(criterion.key,criterion.label):model.title)+(period?` (${period})`:'');
 const params=[criterion?'rank='+encodeURIComponent(criterion.key):'',period?'year='+encodeURIComponent(period):''].filter(Boolean).join('&');
 return {...data,slug:decode(slug),rank,criterion,year,period,base,path:params?base+'?'+params:base,name,titles};
}
export async function generateMetadata(props:Props):Promise<Metadata>{
 const v=await view(props).catch(()=>null);if(!v)return {title:SITE_NAME,robots:{index:false}};
 const {model,criterion,name,path,period}=v,origin=siteUrl();
 const description=(criterion?`${model.title} ranked by ${criterion.label}${period?' ('+period+')':criterion.year?' ('+criterion.year+')':''}. `:'')+(model.description||model.title);
 return {title:`${name} · ${SITE_NAME}`,description:description.slice(0,300),
  ...(origin?{metadataBase:new URL(origin)}:{}),
  alternates:{canonical:path},robots:{index:true,follow:true},
  openGraph:{type:'article',title:name,description:description.slice(0,300),url:path,siteName:SITE_NAME},
  twitter:{card:'summary',title:name,description:description.slice(0,300)}};
}
export default async function RankingPage(props:Props){
 const v=await view(props);if(!v)notFound();
 const {input,model,props:rprops,block,state,askTargets,rank,criterion,year,period,base,path,name,titles,slug}=v;
 // One address per view: another spelling of the slug, an unknown or default ?rank=, an unknown ?year= redirect.
 if(slug!==input.def.slug||(rank!==undefined&&!criterion)||(year!==undefined&&!period))permanentRedirect(path);
 const origin=siteUrl();
 const charts=await rankingChartSvgs([block],{[block.code]:state},criterion?.key,'en',period);
 const {criterion:c,ranked}=rankedView(block,state,criterion?.key,period);
 const ld={'@context':'https://schema.org','@type':'ItemList',url:origin+path,name,description:model.description,
  ...(input.def.updatedAt?{dateModified:input.def.updatedAt}:{}),publisher:{'@type':'Organization',name:SITE_NAME,url:origin},
  itemListOrder:c.order==='asc'?'https://schema.org/ItemListOrderAscending':'https://schema.org/ItemListOrderDescending',numberOfItems:ranked.length,
  itemListElement:ranked.slice(0,100).map(e=>{const href=askTargets[questionKey(e.name)];return {'@type':'ListItem',position:e.rank,name:e.name,...(href?{url:origin+href}:{})};})};
 return <>
  <script type="application/ld+json" dangerouslySetInnerHTML={{__html:jsonLd(ld)}}/>
  <DbShell askTargets={askTargets} className="answer template-ranking-v1">
   <div className="page-meta"><span>Ranking</span>{input.def.status==='draft'&&<span> · Draft</span>}</div>
   <RankingBody title={name} baseTitle={model.title} titles={titles} basePath={base} defaultRank={block.defaultKey} rank={criterion?.key} period={period} charts={charts} props={rprops} lead={model.lead}/>
   <p className="data-twin-files"><a href={base+'/data.csv'} download>Download the data (CSV)</a></p>
   {model.about.length>0&&<section aria-labelledby="about-ranking"><h2 id="about-ranking">About this ranking</h2><ul>{model.about.map((x,i)=><li key={i}>{x}</li>)}</ul></section>}
   {model.related.length>0&&<section aria-labelledby="related-rankings"><h2 id="related-rankings">Related rankings</h2><ul>{model.related.map(r=><li key={r.href}><a href={r.href}>{r.title}</a></li>)}</ul></section>}
  </DbShell>
 </>;
}
