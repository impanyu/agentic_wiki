import {cache} from 'react';
import type {Metadata} from 'next';
import {notFound,permanentRedirect} from 'next/navigation';
import {SITE_NAME} from '@/app/edition';
import {siteUrl} from '@/app/site';
import {entityDb} from '@/app/entity-db/client';
import {loadEntityPage} from '@/app/entity-db/pages';
import {assembleEntityPage,entityPath} from '@/app/seo/assemble';
import {jsonLd} from '@/app/seo/structured-data';
import {questionKey,slugify} from '@/app/seo/urls';
import {linkParts} from '@/app/workflows/viz/ranking-data';
import {DbShell,EntityBody,LinkedText} from '@/app/rankings/view';
// /e/<type>/<slug>: one entity's page, rendered from its row in the entity database with its type's
// template (entity_types.template, or a default built from the entity's metrics). No agent at page time:
// sentences are template patterns filled with values, the card and charts are platform components.
export const dynamic='force-dynamic';
type Props={params:Promise<{type:string;slug:string}>};
const decode=(s:string)=>{try{return decodeURIComponent(s);}catch{return s;}};
const TYPE=/^[a-z][a-z0-9_]{0,40}$/;
const load=cache(async(type:string,slug:string)=>{
 if(!TYPE.test(type))return null;
 const r=await loadEntityPage(await entityDb(),type,slug);if(!r)return null;
 const model=assembleEntityPage(r.data,'en');
 return {...r,model,path:entityPath(type,r.data.entity.name)};
});
async function view(props:Props){const {type,slug}=await props.params;return {type:decode(type),slug:decode(slug),data:await load(decode(type).toLowerCase(),decode(slug))};}
const SCHEMA_TYPES:Record<string,string>={country:'Country',city:'City',us_state:'State',state:'State',region:'Place',place:'Place',mountain:'Mountain',river:'RiverBodyOfWater',lake:'LakeBodyOfWater',
 university:'CollegeOrUniversity',company:'Organization',organization:'Organization',person:'Person',book:'Book',movie:'Movie',product:'Product'};
export async function generateMetadata(props:Props):Promise<Metadata>{
 const {data}=await view(props).catch(()=>({data:null}));if(!data)return {title:SITE_NAME,robots:{index:false}};
 const origin=siteUrl(),{model,path}=data;
 return {title:`${model.title} · ${SITE_NAME}`,description:model.description,
  ...(origin?{metadataBase:new URL(origin)}:{}),
  alternates:{canonical:path},robots:{index:true,follow:true},
  openGraph:{type:'article',title:model.title,description:model.description,url:path,siteName:SITE_NAME},
  twitter:{card:'summary',title:model.title,description:model.description}};
}
const fmtDate=(s:string|null)=>{if(!s)return '';const d=new Date(s);return Number.isNaN(d.getTime())?'':d.toLocaleDateString('en',{year:'numeric',month:'long',day:'numeric',timeZone:'UTC'});};
export default async function EntityPage(props:Props){
 const {type,slug,data}=await view(props);if(!data)notFound();
 const {model,path,data:d,updatedAt}=data;const e=d.entity;
 // One address per entity: an alias's slug or another spelling redirects to the name's slug.
 if(type!==e.type||slug!==slugify(e.name)||!data.canonical)permanentRedirect(path);
 const origin=siteUrl();
 const wikidata=e.ids.wikidata;
 const ld={'@context':'https://schema.org','@type':SCHEMA_TYPES[e.type]||'Thing',name:e.name,url:origin+path,description:model.description,
  ...(e.aliases.length?{alternateName:e.aliases.slice(0,10)}:{}),...(wikidata?{sameAs:['https://www.wikidata.org/wiki/'+wikidata]}:{}),
  ...(Object.keys(e.ids).length?{identifier:Object.entries(e.ids).map(([k,v])=>({'@type':'PropertyValue',propertyID:k,value:v}))}:{}),
  ...(updatedAt?{dateModified:updatedAt}:{}),
  additionalProperty:model.properties.slice(0,60).map(p=>({'@type':'PropertyValue',name:p.name,value:p.value,...(p.unitText?{unitText:p.unitText}:{})}))};
 const askTargets:Record<string,string>={};
 for(const list of Object.values(d.peers))for(const p of list)if(p.type)askTargets[questionKey(p.name)]=entityPath(p.type,p.name);
 return <>
  <script type="application/ld+json" dangerouslySetInnerHTML={{__html:jsonLd(ld)}}/>
  <DbShell askTargets={askTargets} className="answer template-wiki-v1 template-entity-v1">
   <header className="wiki-heading db-hero"><span className="db-kicker">{d.type.label.charAt(0).toUpperCase()+d.type.label.slice(1)}</span><h1>{model.title}</h1>{model.lead.length>0&&<p className="lead">{model.leadParts.map((s,i)=><span key={i}>{i?' ':''}<LinkedText parts={s}/></span>)}</p>}</header>
   <EntityBody cards={model.cards} sections={model.sections}/>
   {model.references.length>0&&<section className="sources" aria-labelledby="references"><h2 id="references">References</h2><ol>
    {model.references.map((r,i)=><li key={i} id={'source-'+(i+1)}><div className="source-entry"><span className="source-title">{linkParts(r.source).map((p,j)=>p.href?<a key={j} href={p.href} target="_blank" rel="noopener noreferrer">{p.text}</a>:<span key={j}>{p.text}</span>)}</span>{r.what&&<span className="wf-muted"> — {r.what}</span>}</div></li>)}
   </ol></section>}
   {model.asOf&&<p className="wf-muted data-as-of">Data as of {fmtDate(model.asOf)}.</p>}
  </DbShell>
 </>;
}
