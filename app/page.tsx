import type {Metadata} from 'next';
import Workspace from './workspace';
import { getChatGPTUser, chatGPTSignInPath, chatGPTSignOutPath } from './chatgpt-auth';
import {SITE_NAME,PUBLIC_EDITION} from './edition';
import {entityDb} from './entity-db/client';
import {featuredRankings,loadTopicNav,type FeaturedRanking,type TopicNav} from './entity-db/pages';
import {loadPublicPage} from './seo/server';
import {pagePath} from './seo/urls';
export const dynamic = 'force-dynamic';
// /?page=<id> is the app view of a page; its canonical, crawlable address is /p/<id>/<slug>.
export async function generateMetadata({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}):Promise<Metadata>{
 const id=(await searchParams).page;if(typeof id!=='string'||!id)return {};
 const page=await loadPublicPage(id).catch(()=>null);if(!page)return {};
 return {title:`${page.title} · ${SITE_NAME}`,description:(page.summary||page.title).slice(0,300),alternates:{canonical:pagePath(page.id,page.title)}};
}
// The public edition's home shows the topic tree's first level and the published rankings, server-rendered
// (crawlers follow them from here). Read at most every five minutes.
type HomeData={featured:FeaturedRanking[];topics:TopicNav['children']};
let homeCache:{at:number;data:HomeData}|null=null;
async function homeData():Promise<HomeData>{
 if(!PUBLIC_EDITION)return {featured:[],topics:[]};
 if(homeCache&&Date.now()-homeCache.at<5*60_000)return homeCache.data;
 const data=await entityDb().then(async db=>({featured:await featuredRankings(db,12),topics:(await loadTopicNav(db,null))?.children??[]}))
  .catch(e=>{console.warn('home data',(e as Error).message);return homeCache?.data??{featured:[],topics:[]};});
 homeCache={at:Date.now(),data};return data;
}
export default async function Home(){ const [user,data] = await Promise.all([getChatGPTUser(),homeData()]); return <Workspace user={user ? {name:user.displayName,id:user.userId}:null} signIn={chatGPTSignInPath('/')} signOut={chatGPTSignOutPath('/')} featured={data.featured} topics={data.topics} />; }
