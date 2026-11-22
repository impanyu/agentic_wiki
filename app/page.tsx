import type {Metadata} from 'next';
import Workspace from './workspace';
import { getChatGPTUser, chatGPTSignInPath, chatGPTSignOutPath } from './chatgpt-auth';
import {SITE_NAME,PUBLIC_EDITION} from './edition';
import {serverUi,requestLocale} from './i18n/request';
import {localizeLinks} from './i18n/locales';
import {localeMeta} from './i18n/meta';
import {entityDb} from './entity-db/client';
import {pathMaps,nodeChildren,popularRankings} from './entity-db/pages';
import {canonicalLinks} from './seo/paths';
import {loadPublicPage} from './seo/server';
import {pagePath} from './seo/urls';
export const dynamic = 'force-dynamic';
// /?page=<id> is the app view of a page; its canonical, crawlable address is /p/<id>/<slug>.
export async function generateMetadata({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}):Promise<Metadata>{
 const id=(await searchParams).page;if(typeof id!=='string'||!id)return PUBLIC_EDITION?localeMeta('/',await requestLocale()):{};
 const page=await loadPublicPage(id).catch(()=>null);if(!page)return {};
 return {title:`${page.title} · ${SITE_NAME}`,description:(page.summary||page.title).slice(0,300),alternates:{canonical:pagePath(page.id,page.title)}};
}
// The public edition's home is the root of the tree of sets: its top-level nodes, server-rendered (crawlers
// follow them down from here).
export default async function Home(){
 const [user,ui] = await Promise.all([getChatGPTUser(),serverUi()]);
 const maps=PUBLIC_EDITION?await entityDb().then(db=>pathMaps(db)).catch(e=>{console.warn('home nodes',(e as Error).message);return null;}):null;
 return <Workspace user={user ? {name:user.displayName,id:user.userId}:null} signIn={chatGPTSignInPath('/')} signOut={chatGPTSignOutPath('/')}
  nodes={maps?localizeLinks(nodeChildren(maps,''),ui.locale):[]} popular={maps?localizeLinks(canonicalLinks(await entityDb().then(db=>popularRankings(db,maps,'')).catch(()=>[]),maps),ui.locale):[]} locale={ui.locale} dictionary={ui.dict} />;
}
