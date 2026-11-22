import {cache} from 'react';
import type {Metadata} from 'next';
import {notFound,permanentRedirect} from 'next/navigation';
import {SITE_NAME} from '@/app/edition';
import {entityDb} from '@/app/entity-db/client';
import {resolvePath} from '@/app/entity-db/pages';
import {requestLocale} from '@/app/i18n/request';
import {localizeLinks} from '@/app/i18n/locales';
import {generateMetadata as rankingMeta,RankingPage} from '@/app/rankings/ranking-page';
import {generateMetadata as entityMeta,EntityPage} from '@/app/e/entity-page';
import {generateMetadata as topicMeta,TopicPage} from '@/app/topics/topic-page';
// The address tree: /<topic>/<subtopic>/…/<ranking or entity>. Each address resolves through the topic tree to
// the topic, ranking or entity page it names (app/entity-db/pages.ts resolvePath); an address that no longer
// matches (a topic moved, another spelling) redirects to the page's current address.
export const dynamic='force-dynamic';
type Search=Record<string,string|string[]|undefined>;
type Props={params:Promise<{path:string[]}>;searchParams:Promise<Search>};
const resolve=cache(async(path:string)=>resolvePath(await entityDb(),path.split('/')));
const query=(q:Search)=>{const p=new URLSearchParams();for(const [k,v] of Object.entries(q))for(const x of [v].flat())if(typeof x==='string')p.append(k,x);const s=p.toString();return s?'?'+s:'';};

export async function generateMetadata({params,searchParams}:Props):Promise<Metadata>{
 const r=await resolve((await params).path.join('/')).catch(()=>null);
 if(!r||r.kind==='redirect')return {title:SITE_NAME,robots:{index:false}};
 if(r.kind==='topic')return topicMeta({params:Promise.resolve({slug:r.slug})});
 if(r.kind==='ranking')return rankingMeta({params:Promise.resolve({slug:r.slug}),searchParams});
 return entityMeta({params:Promise.resolve({type:r.type,slug:r.slug})});
}

export default async function TreePage({params,searchParams}:Props){
 const r=await resolve((await params).path.join('/'));
 if(!r)notFound();
 if(r.kind==='redirect')permanentRedirect(localizeLinks(r.to,await requestLocale())+query(await searchParams));
 if(r.kind==='topic')return TopicPage({params:Promise.resolve({slug:r.slug})});
 if(r.kind==='ranking')return RankingPage({params:Promise.resolve({slug:r.slug}),searchParams});
 return EntityPage({params:Promise.resolve({type:r.type,slug:r.slug})});
}
