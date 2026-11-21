import type {Metadata} from 'next';
import Workspace from './workspace';
import { getChatGPTUser, chatGPTSignInPath, chatGPTSignOutPath } from './chatgpt-auth';
import {SITE_NAME,PUBLIC_EDITION} from './edition';
import {entityDb} from './entity-db/client';
import {featuredRankings,type FeaturedRanking} from './entity-db/pages';
import {loadPublicPage} from './seo/server';
import {pagePath} from './seo/urls';
export const dynamic = 'force-dynamic';
// /?page=<id> is the app view of a page; its canonical, crawlable address is /p/<id>/<slug>.
export async function generateMetadata({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}):Promise<Metadata>{
 const id=(await searchParams).page;if(typeof id!=='string'||!id)return {};
 const page=await loadPublicPage(id).catch(()=>null);if(!page)return {};
 return {title:`${page.title} · ${SITE_NAME}`,description:(page.summary||page.title).slice(0,300),alternates:{canonical:pagePath(page.id,page.title)}};
}
// The public edition's home shows the published rankings, server-rendered (crawlers follow them from here).
let featuredCache:{at:number;list:FeaturedRanking[]}|null=null;
async function featured():Promise<FeaturedRanking[]>{
 if(!PUBLIC_EDITION)return [];
 if(featuredCache&&Date.now()-featuredCache.at<5*60_000)return featuredCache.list;
 const list=await entityDb().then(db=>featuredRankings(db,12)).catch(e=>{console.warn('featured rankings',(e as Error).message);return featuredCache?.list||[];});
 featuredCache={at:Date.now(),list};return list;
}
export default async function Home(){ const [user,list] = await Promise.all([getChatGPTUser(),featured()]); return <Workspace user={user ? {name:user.displayName,id:user.userId}:null} signIn={chatGPTSignInPath('/')} signOut={chatGPTSignOutPath('/')} featured={list} />; }
