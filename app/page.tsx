import type {Metadata} from 'next';
import Workspace from './workspace';
import { getChatGPTUser, chatGPTSignInPath, chatGPTSignOutPath } from './chatgpt-auth';
import {SITE_NAME} from './edition';
import {loadPublicPage} from './seo/server';
import {pagePath} from './seo/urls';
export const dynamic = 'force-dynamic';
// /?page=<id> is the app view of a page; its canonical, crawlable address is /p/<id>/<slug>.
export async function generateMetadata({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}):Promise<Metadata>{
 const id=(await searchParams).page;if(typeof id!=='string'||!id)return {};
 const page=await loadPublicPage(id).catch(()=>null);if(!page)return {};
 return {title:`${page.title} · ${SITE_NAME}`,description:(page.summary||page.title).slice(0,300),alternates:{canonical:pagePath(page.id,page.title)}};
}
export default async function Home(){ const user = await getChatGPTUser(); return <Workspace user={user ? {name:user.displayName,id:user.userId}:null} signIn={chatGPTSignInPath('/')} signOut={chatGPTSignOutPath('/')} />; }
