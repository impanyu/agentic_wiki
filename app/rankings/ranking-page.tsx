import {serverUi,requestLocale} from '@/app/i18n/request';
import {localizeLinks} from '@/app/i18n/locales';
import {localizeContent} from '@/app/i18n/content';
import {localeMeta} from '@/app/i18n/meta';
import {cookies} from 'next/headers';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {cache} from 'react';
import {ttlCache} from '@/app/entity-db/ttl-cache';
import {packRows} from '@/app/seo/pack-rows';
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
import {linkParts} from '@/app/workflows/viz/ranking-data';
import {DbShell,RankingBody} from './view';
import {pathMaps,nodeTrail,nodeChildren,popularRankings} from '@/app/entity-db/pages';
import {Breadcrumbs,RankingGrid} from '@/app/explore';
import {canonicalPath,canonicalLinks} from '@/app/seo/paths';
// A ranking page, at its place in the address tree (/<topic>/…/<slug>; /rankings/<slug> redirects there, and
// serves rankings without a topic). A ranking definition rendered from the entity database by templates (no agent at page
// time). Rows come from metric_table over the definition's scope and criteria (every period in long form:
// year picker, time views), at most the top 1,000 per criterion. Like /p, every criterion has its own
// address (?rank=<key>, the default criterion is the plain address) and every period too (?year=).
export type Props={params:Promise<{slug:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>;legacy?:boolean};
const decode=(s:string)=>{try{return decodeURIComponent(s);}catch{return s;}};
const one=(v:string|string[]|undefined)=>typeof v==='string'?v:undefined;
// Ranking data and server-drawn charts are kept for ten minutes (data changes on the collectors' schedules).
const rankingData=ttlCache<Awaited<ReturnType<typeof loadUncached>>>(10*60_000,60),chartSvgs=ttlCache<Record<string,string>>(10*60_000,300);
const load=cache((slug:string)=>rankingData.get(slug,()=>loadUncached(slug)));
async function loadUncached(slug:string){
 const db=await entityDb();const input=await loadRankingPage(db,slug);if(!input)return null;
 const model=assembleRankingPage(input,'en');
 const props:Record<string,unknown>={criteria:model.criteria,rows:model.rows,default:model.defaultKey,periodKey:'period',
  ...(model.groupKey?{groupKey:model.groupKey}:{}),...(Array.isArray(input.def.config.views)?{views:input.def.config.views}:{}),
  ...(model.sources.length?{source:model.sources.join('; ')}:{})};
 const block=propsRankingBlock(props)!;
 // Members link to their pages; one without a page (too little data yet) is plain text.
 const pages=await withPages(db,model.rows.map(r=>String(r.entity_id||'')));
 const askTargets:Record<string,string>={};
 for(const r of model.rows){const n=String(r.name||''),t=String(r.type||''),id=String(r.entity_id||'');if(n&&t&&pages.has(id)&&!askTargets[questionKey(n)])askTargets[questionKey(n)]=entityPath(t,n,pages.get(id));}
 return {input,model,props,block,state:{rows:model.rows},askTargets};
}
async function view(props:Props){
 const [{slug},q]=await Promise.all([props.params,props.searchParams]);
 const data=await load(decode(slug));if(!data)return null;
 const {model,block,state}=data;
 const rank=one(q.rank),c=model.criteria.length?rankCriterion([block],rank):null;
 const year=one(q.year),period=year&&blockPeriods(block,state).includes(year)?year:undefined;
 const criterion=c&&c.key!==block.defaultKey?c:null;
 const maps=await pathMaps(await entityDb());
 const internal=rankingPath(data.input.def.slug),base=canonicalPath(internal,maps);
 const titleFor=(key:string,label:string)=>key===block.defaultKey?model.title:`${model.title} by ${label}`;
 const titles=Object.fromEntries(model.criteria.map(x=>[x.key,titleFor(x.key,x.label)]));
 const name=(criterion?titleFor(criterion.key,criterion.label):model.title)+(period?` (${period})`:'');
 const params=[criterion?'rank='+encodeURIComponent(criterion.key):'',period?'year='+encodeURIComponent(period):''].filter(Boolean).join('&');
 return {...data,slug:decode(slug),rank,criterion,year,period,base,internal,maps,path:params?base+'?'+params:base,name,titles};
}
export async function generateMetadata(props:Props):Promise<Metadata>{
 const v=await view(props).catch(()=>null);if(!v)return {title:SITE_NAME,robots:{index:false}};
 const {model,criterion,path,period}=v,origin=siteUrl(),locale=await requestLocale();
 const loc=await localizeContent(await entityDb(),{name:v.name,description:(criterion?`${model.title} ranked by ${criterion.label}${period?' ('+period+')':criterion.year?' ('+criterion.year+')':''}. `:'')+(model.description||model.title)},locale);
 const {name,description}=loc.model;
 return {title:`${name} · ${SITE_NAME}`,description:description.slice(0,300),
  ...(origin?{metadataBase:new URL(origin)}:{}),
  ...localeMeta(path,locale,loc.complete),
  openGraph:{type:'article',title:name,description:description.slice(0,300),url:path,siteName:SITE_NAME},
  twitter:{card:'summary',title:name,description:description.slice(0,300)}};
}
export async function RankingPage(props:Props){
 const v=await view(props);if(!v)notFound();
 const {input,model,props:rawProps,block,state,askTargets,rank,criterion,year,period,base,internal,maps,path,slug}=v;
 const {locale,dict,t}=await serverUi();const L=<T,>(v:T)=>localizeLinks(canonicalLinks(v,maps),locale);
 // The page's own words in the reader's language (queued for translation when not translated yet; rows keep their names).
 const loc=(await localizeContent(await entityDb(),{name:v.name,baseTitle:model.title,lead:model.lead,titles:Object.entries(v.titles).map(([key,title])=>({key,title})),
  related:model.related,subsets:nodeChildren(maps,base),props:rawProps},locale)).model;
 const name=loc.name,rprops=loc.props,titles=Object.fromEntries(loc.titles.map(x=>[x.key,x.title]));
 // One address per view: the old /rankings/ address, another spelling of the slug, an unknown or default ?rank=,
 // an unknown ?year= redirect.
 if((props.legacy&&base!==internal)||slug!==input.def.slug||(rank!==undefined&&!criterion)||(year!==undefined&&!period))permanentRedirect(localizeLinks(path,locale));
 const origin=siteUrl();
 const dark=(await cookies()).get('rw-theme')?.value==='dark';
 const account=await getChatGPTUser().then(u=>u?{name:u.displayName}:null).catch(()=>null);
 const popular=base!==internal?await popularRankings(await entityDb(),maps,base).catch(()=>[]):[];
 const charts=await chartSvgs.get([slug,criterion?.key??'',period??'',locale,dark?1:0].join('|'),()=>rankingChartSvgs([block],{[block.code]:state},criterion?.key,locale,period,dark));
 const {criterion:c,ranked}=rankedView(block,state,criterion?.key,period);
 const ld={'@context':'https://schema.org','@type':'ItemList',url:origin+path,name,description:model.description,
  ...(input.def.updatedAt?{dateModified:input.def.updatedAt}:{}),publisher:{'@type':'Organization',name:SITE_NAME,url:origin},
  itemListOrder:c.order==='asc'?'https://schema.org/ItemListOrderAscending':'https://schema.org/ItemListOrderDescending',numberOfItems:ranked.length,
  itemListElement:ranked.slice(0,100).map(e=>{const href=L(askTargets[questionKey(e.name)]);return {'@type':'ListItem',position:e.rank,name:e.name,...(href?{url:origin+href}:{})};})};
 return <>
  <script type="application/ld+json" dangerouslySetInnerHTML={{__html:jsonLd(ld)}}/>
  <DbShell locale={locale} dictionary={dict} askTargets={L(askTargets)} className="answer template-ranking-v1" account={account} references={<>
{model.about.length>0&&<section aria-labelledby="about-ranking"><h2 id="about-ranking">{t('About this ranking')}</h2><ul>{model.about.map((x,i)=><li key={i}>{linkParts(x).map((p,j)=>p.href?<a key={j} href={p.href} target="_blank" rel="noopener noreferrer" className="ext">{p.text}</a>:<span key={j}>{p.text}</span>)}</li>)}</ul></section>}
  </>}>
   {base!==internal&&<Breadcrumbs trail={L(nodeTrail(maps,base))} current={maps.nodes.get(base)?.name??model.title}/>}
   <RankingBody slug={input.def.slug} kicker={t('Ranking')+(input.def.status==='draft'?' · '+t('Draft'):'')} subsets={L(loc.subsets)} title={name} baseTitle={loc.baseTitle} titles={titles} basePath={localizeLinks(base,locale)} defaultRank={block.defaultKey} rank={criterion?.key} period={period} charts={charts} props={L({...rprops,rows:packRows(rprops.rows as Record<string,unknown>[])})} lead={loc.lead}/>
   <p className="data-twin-files"><a href={internal+'/data.csv'} download>{t('Download the data (CSV)')}</a></p>

   <RankingGrid rankings={L(popular)} title={t('Popular rankings')}/>
   {loc.related.length>0&&<section aria-labelledby="related-rankings"><h2 id="related-rankings">{t('Related rankings')}</h2><ul>{loc.related.map(r=><li key={r.href}><a href={L(r.href)}>{r.title}</a></li>)}</ul></section>}
  </DbShell>
 </>;
}
