import {serverUi,requestLocale} from '@/app/i18n/request';
import {localizeLinks} from '@/app/i18n/locales';
import {localeMeta} from '@/app/i18n/meta';
import {cache} from 'react';
import type {Metadata} from 'next';
import {notFound} from 'next/navigation';
import {SITE_NAME} from '@/app/edition';
import {siteUrl} from '@/app/site';
import {entityDb} from '@/app/entity-db/client';
import {loadTopicNav,topicPath,pathMaps} from '@/app/entity-db/pages';
import {canonicalPath,canonicalLinks} from '@/app/seo/paths';
import {permanentRedirect} from 'next/navigation';
import {jsonLd} from '@/app/seo/structured-data';
import {DbShell} from '@/app/rankings/view';
import {TopicGrid,RankingGrid,TypeList,Breadcrumbs} from '@/app/explore';
import {Compass} from 'lucide-react';
// A topic page at its place in the address tree (/<root>/…/<slug>; /topics/<slug> redirects there): one level of the topic tree — its subtopics (each opening its own level), its rankings with
// their leaders, and the kinds of entity pages it has. Rendered from the database; the manager keeps the tree.
export type Props={params:Promise<{slug:string}>;legacy?:boolean};
const decode=(s:string)=>{try{return decodeURIComponent(s);}catch{return s;}};
const load=cache(async(slug:string)=>loadTopicNav(await entityDb(),slug));

export async function generateMetadata(props:Props):Promise<Metadata>{
 const nav=await load(decode((await props.params).slug)).catch(()=>null);
 if(!nav?.topic)return {title:SITE_NAME,robots:{index:false}};
 const t=nav.topic;
 const description=(t.description||`${t.name}: ${t.rankings} rankings and ${t.pages} entity pages.`).slice(0,300);
 return {title:`${t.name} · ${SITE_NAME}`,description,...localeMeta(canonicalPath(topicPath(t.slug),await pathMaps(await entityDb())),await requestLocale()),openGraph:{title:t.name,description,url:canonicalPath(topicPath(t.slug),await pathMaps(await entityDb())),siteName:SITE_NAME,type:'website'}};
}

export async function TopicPage(props:Props){
 const nav=await load(decode((await props.params).slug));
 if(!nav?.topic)notFound();
 const t=nav.topic;const base=siteUrl();
 const ui=await serverUi();const maps=await pathMaps(await entityDb());const L=<T,>(v:T)=>localizeLinks(canonicalLinks(v,maps),ui.locale);
 const here=canonicalPath(t.href,maps);if(props.legacy&&here!==t.href)permanentRedirect(localizeLinks(here,ui.locale));const n=(x:number)=>x.toLocaleString(ui.locale);
 const ld={'@context':'https://schema.org','@graph':[
  {'@type':'CollectionPage',name:t.name,description:t.description||undefined,url:base+here},
  {'@type':'BreadcrumbList',itemListElement:[{name:SITE_NAME,href:'/'},...nav.trail.map(x=>({name:x.name,href:x.href})),{name:t.name,href:t.href}].map((x,i)=>({'@type':'ListItem',position:i+1,name:x.name,item:base+canonicalPath(x.href,maps)}))}]};
 return <>
  <script type="application/ld+json" dangerouslySetInnerHTML={{__html:jsonLd(ld)}}/>
  <DbShell locale={ui.locale} dictionary={ui.dict} askTargets={{}} className="answer template-topic-v1">
   <Breadcrumbs trail={L(nav.trail.map(x=>({name:x.name,href:x.href})))} current={t.name}/>
   <header className="wiki-heading db-hero"><span className="db-kicker"><Compass size={13} aria-hidden="true"/>{ui.t('Topic')}</span><h1>{t.name}</h1>
    {t.description&&<p className="lead">{t.description}</p>}
    <p className="rw-hero-stats"><span>{ui.t('{count} rankings',{count:n(t.rankings)})}</span>{t.pages>0&&<span>{ui.t('{count} pages',{count:n(t.pages)})}</span>}{nav.children.length>0&&<span>{ui.t('{count} subtopics',{count:n(nav.children.length)})}</span>}</p>
   </header>
   <TopicGrid topics={L(nav.children)} title={ui.t('Subtopics')}/>
   <RankingGrid rankings={L(nav.rankings)} title={nav.children.length?ui.t('Leading rankings'):ui.t('Rankings')}/>
   <TypeList types={L(nav.types)}/>
  </DbShell>
 </>;
}
