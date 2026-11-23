import {serverUi,requestLocale} from '@/app/i18n/request';
import {localizeLinks} from '@/app/i18n/locales';
import {localeMeta} from '@/app/i18n/meta';
import {cache} from 'react';
import {ttlCache} from '@/app/entity-db/ttl-cache';
import type {Metadata} from 'next';
import {notFound,permanentRedirect} from 'next/navigation';
import {SITE_NAME} from '@/app/edition';
import {siteUrl} from '@/app/site';
import {entityDb} from '@/app/entity-db/client';
import {loadEntityPage,loadEntityPageByNum,pathMaps,nodeTrail} from '@/app/entity-db/pages';
import {autolinker} from '@/app/seo/autolink';
import {Breadcrumbs} from '@/app/explore';
import {canonicalLinks,canonicalPath} from '@/app/seo/paths';
import {assembleEntityPage,entityPath,rankingPath,type EntityPageModel} from '@/app/seo/assemble';
import {jsonLd} from '@/app/seo/structured-data';
import {questionKey,slugify} from '@/app/seo/urls';
import {linkParts} from '@/app/workflows/viz/ranking-data';
import {outboundLinks} from '@/app/seo/outbound';
import {localizeContent} from '@/app/i18n/content';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {ArrowUpRight} from 'lucide-react';
import {DbShell,EntityBody,LinkedText} from '@/app/rankings/view';
// An entity's page, at its place in the address tree (/<topic>/…/<slug>; /e/<type>/<slug> redirects there and
// serves types without a topic): one entity's page, rendered from its row in the entity database with its type's
// template (entity_types.template, or a default built from the entity's metrics). No agent at page time:
// sentences are template patterns filled with values, the card and charts are platform components.
export type Props={params:Promise<{type:string;slug:string}>};
const decode=(s:string)=>{try{return decodeURIComponent(s);}catch{return s;}};
const TYPE=/^[a-z][a-z0-9_]{0,40}$/;
// /e/<num>/<slug> by number; /e/<type>/<slug> (older addresses) by type and name, redirected to the number.
const entityData=ttlCache<Awaited<ReturnType<typeof loadUncached>>>(10*60_000,2000);
const load=cache((first:string,slug:string)=>entityData.get(first+'/'+slug,()=>loadUncached(first,slug)));
async function loadUncached(first:string,slug:string){
 const db=await entityDb();
 const r=/^\d+$/.test(first)?await loadEntityPageByNum(db,first):TYPE.test(first)?await loadEntityPage(db,first,slug):null;if(!r)return null;
 const model=assembleEntityPage(r.data,'en');const maps=await pathMaps(db);
 const path=entityPath(r.data.entity.type,r.data.entity.name,r.num);
 return {...r,model,maps,path};
}
// The page's own words in the reader's language (queued for translation when not translated yet).
// Outbound link labels ("Official website") are passed joined by newlines so the cache key stays a string.
const localized=cache(async(model:EntityPageModel,kicker:string,locale:string,intro='',labels='')=>localizeContent(await entityDb(),{model,kicker,intro:{text:intro},links:labels?labels.split('\n').map(label=>({label})):[]},locale));
async function view(props:Props){const {type,slug}=await props.params;return {first:decode(type),slug:decode(slug),data:await load(decode(type).toLowerCase(),decode(slug))};}
const SCHEMA_TYPES:Record<string,string>={country:'Country',city:'City',us_state:'State',state:'State',region:'Place',place:'Place',mountain:'Mountain',river:'RiverBodyOfWater',lake:'LakeBodyOfWater',
 university:'CollegeOrUniversity',company:'Organization',organization:'Organization',person:'Person',book:'Book',movie:'Movie',product:'Product'};
export async function generateMetadata(props:Props):Promise<Metadata>{
 const {data}=await view(props).catch(()=>({data:null}));if(!data)return {title:SITE_NAME,robots:{index:false}};
 const origin=siteUrl(),{path}=data,locale=await requestLocale();
 const {model:{model},complete}=await localized(data.model,data.data.type.label,locale);
 return {title:`${model.title} · ${SITE_NAME}`,description:model.description,
  ...(origin?{metadataBase:new URL(origin)}:{}),
  ...localeMeta(path,locale,complete),
  openGraph:{type:'article',title:model.title,description:model.description,url:path,siteName:SITE_NAME},
  twitter:{card:'summary',title:model.title,description:model.description}};
}
const fmtDate=(s:string|null,locale='en')=>{if(!s)return '';const d=new Date(s);return Number.isNaN(d.getTime())?'':d.toLocaleDateString(locale,{year:'numeric',month:'long',day:'numeric',timeZone:'UTC'});};
export async function EntityPage(props:Props){
 const {first,slug,data}=await view(props);if(!data)notFound();
 const {path,maps,data:d,updatedAt}=data;const e=d.entity;
 const {locale,dict,t}=await serverUi();
 // A short introduction (the collector's, or the lead of the Wikipedia article, credited).
 const introSource=typeof e.attributes?.description_source==='string'?String(e.attributes.description_source):'';
 const links=outboundLinks(e);
 const {model:{model,kicker,intro,links:linkLabels}}=await localized(data.model,d.type.label,locale,e.description||'',links.map(l=>l.label).join('\n'));
 // Mentions of other entities with pages link to them (Wikipedia-style), first mention only, never the page itself.
 const link=await autolinker(await entityDb(),path);
 const leadParts=model.leadParts.map(link),introParts=intro.text?link([{text:intro.text}]):[];
 const sections=model.sections.map(x=>x.paragraphParts?{...x,paragraphParts:x.paragraphParts.map(link)}:x);
 // Where the entity sits in the tree: the trail to its type's topic, and its type's main ranking.
 const typeTopic=(await (await entityDb()).query<{slug:string}>('select t.slug from entity_types et join topics t on t.id=et.topic_id where et.type=$1::text',[e.type])).rows[0]?.slug;
 const topicPath=typeTopic?maps.topics.get(typeTopic):undefined;
 const trail=topicPath?[...nodeTrail(maps,topicPath),{name:maps.nodes.get(topicPath)?.name||kicker,href:topicPath}]:[];
 // The way here in the reader's language.
 const ltrail=(await localizeContent(await entityDb(),{trail},locale)).model.trail;
 const main=d.rankings.find(r=>!r.filters||!Object.keys(r.filters).length);const mainHref=main?canonicalPath(rankingPath(main.slug),maps):topicPath;const L=<T,>(v:T)=>localizeLinks(canonicalLinks(v,maps),locale);
 // One address per entity: an alias's slug or another spelling redirects to the name's slug.
 if(first!==data.num||slug!==slugify(e.name)||!data.canonical)permanentRedirect(localizeLinks(path,locale));
 const origin=siteUrl();
 const wikidata=e.ids.wikidata;
 const account=await getChatGPTUser().then(u=>u?{name:u.displayName}:null).catch(()=>null);
 const ld={'@context':'https://schema.org','@type':SCHEMA_TYPES[e.type]||'Thing',name:e.name,url:origin+path,description:model.description,
  ...(e.aliases.length?{alternateName:e.aliases.slice(0,10)}:{}),...(links.length?{sameAs:links.map(l=>l.href)}:{}),
  ...(Object.keys(e.ids).length?{identifier:Object.entries(e.ids).map(([k,v])=>({'@type':'PropertyValue',propertyID:k,value:v}))}:{}),
  ...(updatedAt?{dateModified:updatedAt}:{}),
  additionalProperty:model.properties.slice(0,60).map(p=>({'@type':'PropertyValue',name:p.name,value:p.value,...(p.unitText?{unitText:p.unitText}:{})}))};
 const askTargets:Record<string,string>={};
 for(const list of Object.values(d.peers))for(const p of list)if(p.type)askTargets[questionKey(p.name)]=entityPath(p.type,p.name,p.num);
 return <>
  <script type="application/ld+json" dangerouslySetInnerHTML={{__html:jsonLd(ld)}}/>
  <DbShell locale={locale} dictionary={dict} askTargets={L(askTargets)} className="answer template-wiki-v1 template-entity-v1" account={account} references={<>
{model.references.length>0&&<section className="sources" aria-labelledby="references"><h2 id="references">{t('References')}</h2><ol>
    {model.references.map((r,i)=><li key={i} id={'source-'+(i+1)}><div className="source-entry"><span className="source-title">{linkParts(r.source).map((p,j)=>p.href?<a key={j} href={p.href} target="_blank" rel="noopener noreferrer">{p.text}</a>:<span key={j}>{p.text}</span>)}</span>{r.what&&<span className="wf-muted"> — {r.what}</span>}</div></li>)}
   </ol></section>}
   {model.asOf&&<p className="wf-muted data-as-of">{t('Data as of {date}.',{date:fmtDate(model.asOf,locale)})}</p>}
  </>}>
   {ltrail.length>0&&<Breadcrumbs trail={L(ltrail.slice(0,-1).map(x=>({name:x.name,href:x.href})))} current={ltrail[ltrail.length-1].name}/>}
   <header className={'wiki-heading db-hero entity-hero'+(model.image?' has-image':'')}>
    {model.image&&<img className="entity-picture" src={model.image} alt={model.title} loading="eager" referrerPolicy="no-referrer"/>}
    <div className="entity-hero-text">{mainHref?<a className="db-kicker" href={L(mainHref)}>{kicker.charAt(0).toUpperCase()+kicker.slice(1)}</a>:<span className="db-kicker">{kicker.charAt(0).toUpperCase()+kicker.slice(1)}</span>}<h1>{model.title}</h1>{intro.text&&<p className="entity-intro"><LinkedText parts={L(introParts)}/>{/wikipedia\.org/.test(introSource)&&<> <a className="intro-source" href={introSource} target="_blank" rel="noopener noreferrer">{t('From Wikipedia')}</a></>}</p>}{model.lead.length>0&&<p className="lead">{L(leadParts).map((s,i)=><span key={i}>{i?' ':''}<LinkedText parts={s}/></span>)}</p>}
       {model.highlights.length>0&&<ul className="entity-highlights" aria-label={t('Standout ranks')}>{L(model.highlights).map(h=><li key={h.href}><a href={h.href}>
     <b>#{h.rank.toLocaleString(locale)}</b><span>{h.label}</span>{h.of&&<small>{t('of {count}',{count:h.of.toLocaleString(locale)})}</small>}</a></li>)}{model.rankCount>model.highlights.length&&<li className="all-ranks"><a href="#all-rankings"><b>{model.rankCount.toLocaleString(locale)}</b><span>{t('All rankings')}</span></a></li>}</ul>}
    {links.length>0&&<div className="ext-links">{links.map((l,i)=><a key={l.href} className={'ext-link'+(l.primary?' primary':'')} href={l.href} target="_blank" rel="noopener noreferrer"><span>{linkLabels[i]?.label||l.label}</span><small>{l.host}</small><ArrowUpRight size={15} aria-hidden="true"/></a>)}</div>}
    </div>
   </header>
   <EntityBody cards={L(model.cards)} sections={L(sections)}/>

  </DbShell>
 </>;
}
