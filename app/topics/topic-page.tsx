import {getChatGPTUser} from '@/app/chatgpt-auth';
import {serverUi,requestLocale} from '@/app/i18n/request';
import {localizeLinks} from '@/app/i18n/locales';
import {localeMeta} from '@/app/i18n/meta';
import {localizeContent} from '@/app/i18n/content';
import {cache} from 'react';
import {ttlCache} from '@/app/entity-db/ttl-cache';
import type {Metadata} from 'next';
import {notFound} from 'next/navigation';
import {SITE_NAME} from '@/app/edition';
import {siteUrl} from '@/app/site';
import {entityDb} from '@/app/entity-db/client';
import {loadTopicNav,topicPath,pathMaps,nodeChildren,popularRankings} from '@/app/entity-db/pages';
import {canonicalPath,canonicalLinks} from '@/app/seo/paths';
import {permanentRedirect} from 'next/navigation';
import {jsonLd} from '@/app/seo/structured-data';
import {DbShell} from '@/app/rankings/view';
import {NodeGrid,RankingGrid,Breadcrumbs,FollowButton} from '@/app/explore';
import {Compass,Hammer} from 'lucide-react';
import type {TopicBuild} from '@/app/entity-db/pages';
// A broad topic's page (a node over several kinds of entity, so no ranking of its own) at its place in the
// address tree; /topics/<slug> redirects there. Like every node page it lists its direct children. One level of the topic tree — its subtopics (each opening its own level), its rankings with
// their leaders, and the kinds of entity pages it has. Rendered from the database; the manager keeps the tree.
export type Props={params:Promise<{slug:string}>;legacy?:boolean};
const decode=(s:string)=>{try{return decodeURIComponent(s);}catch{return s;}};
const topicData=ttlCache<Awaited<ReturnType<typeof loadTopicNav>>>(5*60_000,500);
const load=cache((slug:string)=>topicData.get(slug,async()=>loadTopicNav(await entityDb(),slug,{rankings:false})));

export async function generateMetadata(props:Props):Promise<Metadata>{
 const nav=await load(decode((await props.params).slug)).catch(()=>null);
 if(!nav?.topic)return {title:SITE_NAME,robots:{index:false}};
 const t=nav.topic;
 const description=(t.description||`${t.name}: ${t.rankings} rankings and ${t.pages} entity pages.`).slice(0,300);
 // A topic still being built (no published ranking yet) is browsable but kept out of search engines until it has content.
 const building=t.rankings===0;
 return {title:`${t.name} · ${SITE_NAME}`,description,...localeMeta(canonicalPath(topicPath(t.slug),await pathMaps(await entityDb())),await requestLocale()),openGraph:{title:t.name,description,url:canonicalPath(topicPath(t.slug),await pathMaps(await entityDb())),siteName:SITE_NAME,type:'website'},...(building?{robots:{index:false,follow:true}}:{})};
}

export async function TopicPage(props:Props){
 const raw=await load(decode((await props.params).slug));
 if(!raw?.topic)notFound();
 const ui=await serverUi();const maps=await pathMaps(await entityDb());const L=<T,>(v:T)=>localizeLinks(canonicalLinks(v,maps),ui.locale);
 // The topic's own words in the reader's language (queued for translation when not translated yet).
 const nav=(await localizeContent(await entityDb(),raw,ui.locale)).model;
 const t=nav.topic!;const base=siteUrl();
 const here=canonicalPath(t.href,maps);if(props.legacy&&here!==t.href)permanentRedirect(localizeLinks(here,ui.locale));const n=(x:number)=>x.toLocaleString(ui.locale);
 const ld={'@context':'https://schema.org','@graph':[
  {'@type':'CollectionPage',name:t.name,description:t.description||undefined,url:base+here},
  {'@type':'BreadcrumbList',itemListElement:[{name:SITE_NAME,href:'/'},...nav.trail.map(x=>({name:x.name,href:x.href})),{name:t.name,href:t.href}].map((x,i)=>({'@type':'ListItem',position:i+1,name:x.name,item:base+canonicalPath(x.href,maps)}))}]};
 return <>
  <script type="application/ld+json" dangerouslySetInnerHTML={{__html:jsonLd(ld)}}/>
  <DbShell locale={ui.locale} dictionary={ui.dict} askTargets={{}} className="answer template-topic-v1" account={await getChatGPTUser().then(u=>u?{name:u.displayName}:null).catch(()=>null)}>
   <Breadcrumbs trail={L(nav.trail.map(x=>({name:x.name,href:x.href})))} current={t.name}/>
   <header className="wiki-heading db-hero"><span className="db-kicker"><Compass size={13} aria-hidden="true"/>{ui.t('Topic')}</span><h1>{t.name}</h1>
    {t.description&&<p className="lead">{t.description}</p>}
    <FollowButton name={t.name} href={localizeLinks(here,ui.locale)}/>
    {t.rankings>0&&<p className="rw-hero-stats"><span>{ui.t('{count} rankings',{count:n(t.rankings)})}</span>{t.pages>0&&<span>{ui.t('{count} pages',{count:n(t.pages)})}</span>}</p>}
   </header>
   {nav.build&&<BuildStatus build={nav.build} t={ui.t} n={n}/>}
   <NodeGrid nodes={L((await localizeContent(await entityDb(),{n:nodeChildren(maps,here)},ui.locale)).model.n)}/>
   <RankingGrid rankings={L(await popularRankings(await entityDb(),maps,here).catch(()=>[]))} title={ui.t('Popular rankings')}/>
  </DbShell>
 </>;
}

// A topic whose pages are not published yet says where its team stands, so the tree is useful from the start.
function BuildStatus({build,t,n}:{build:TopicBuild;t:(k:string,v?:Record<string,string|number>)=>string;n:(x:number)=>string}){
 const state=build.status==='running'?t('Its team is researching sources and collecting data now.')
  :build.status==='queued'?t('Its team starts soon ({count} topics ahead in the queue).',{count:n(build.ahead)})
  :build.status==='done'?t('Its first pass is done; the pages are waiting for the reviewer\'s approval.')
  :t('Its team has not been scheduled yet.');
 return <section className="rw-build" aria-label={t('Being built')}>
  <Hammer size={18} aria-hidden="true"/>
  <div><strong>{t('Being built')}</strong><p>{t('Rankings and entity pages for this topic are being built from public data.')} {state}</p>
   {(build.entities>0||build.sources>0)&&<p className="rw-build-stats">{build.sources>0&&<span>{t('{count} sources found',{count:n(build.sources)})}</span>}{build.entities>0&&<span>{t('{count} entities collected',{count:n(build.entities)})}</span>}</p>}</div>
 </section>;
}
