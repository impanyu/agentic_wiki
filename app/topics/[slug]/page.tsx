import {cache} from 'react';
import type {Metadata} from 'next';
import {notFound} from 'next/navigation';
import {SITE_NAME} from '@/app/edition';
import {siteUrl} from '@/app/site';
import {entityDb} from '@/app/entity-db/client';
import {loadTopicNav,topicPath} from '@/app/entity-db/pages';
import {jsonLd} from '@/app/seo/structured-data';
import {DbShell} from '@/app/rankings/view';
import {TopicGrid,RankingGrid,TypeList,Breadcrumbs} from '@/app/explore';
import {Compass} from 'lucide-react';
// /topics/<slug>: one level of the topic tree — its subtopics (each opening its own level), its rankings with
// their leaders, and the kinds of entity pages it has. Rendered from the database; the manager keeps the tree.
export const dynamic='force-dynamic';
type Props={params:Promise<{slug:string}>};
const decode=(s:string)=>{try{return decodeURIComponent(s);}catch{return s;}};
const load=cache(async(slug:string)=>loadTopicNav(await entityDb(),slug));

export async function generateMetadata(props:Props):Promise<Metadata>{
 const nav=await load(decode((await props.params).slug)).catch(()=>null);
 if(!nav?.topic)return {title:SITE_NAME,robots:{index:false}};
 const t=nav.topic;
 const description=(t.description||`${t.name}: ${t.rankings} rankings and ${t.pages} entity pages.`).slice(0,300);
 return {title:`${t.name} · ${SITE_NAME}`,description,alternates:{canonical:topicPath(t.slug)},openGraph:{title:t.name,description,url:topicPath(t.slug),siteName:SITE_NAME,type:'website'}};
}

export default async function TopicPage(props:Props){
 const nav=await load(decode((await props.params).slug));
 if(!nav?.topic)notFound();
 const t=nav.topic;const base=siteUrl();
 const ld={'@context':'https://schema.org','@graph':[
  {'@type':'CollectionPage',name:t.name,description:t.description||undefined,url:base+t.href},
  {'@type':'BreadcrumbList',itemListElement:[{name:SITE_NAME,href:'/'},...nav.trail.map(x=>({name:x.name,href:x.href})),{name:t.name,href:t.href}].map((x,i)=>({'@type':'ListItem',position:i+1,name:x.name,item:base+x.href}))}]};
 return <>
  <script type="application/ld+json" dangerouslySetInnerHTML={{__html:jsonLd(ld)}}/>
  <DbShell askTargets={{}} className="answer template-topic-v1">
   <Breadcrumbs trail={nav.trail.map(x=>({name:x.name,href:x.href}))} current={t.name}/>
   <header className="wiki-heading db-hero"><span className="db-kicker"><Compass size={13} aria-hidden="true"/>Topic</span><h1>{t.name}</h1>
    {t.description&&<p className="lead">{t.description}</p>}
    <p className="rw-hero-stats"><span><b>{t.rankings.toLocaleString('en')}</b> rankings</span>{t.pages>0&&<span><b>{t.pages.toLocaleString('en')}</b> entity pages</span>}{nav.children.length>0&&<span><b>{nav.children.length}</b> subtopics</span>}</p>
   </header>
   <TopicGrid topics={nav.children} title="Subtopics"/>
   <RankingGrid rankings={nav.rankings} title={nav.children.length?'Leading rankings':'Rankings'}/>
   <TypeList types={nav.types}/>
  </DbShell>
 </>;
}
