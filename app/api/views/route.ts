import {sameOrigin} from '@/db/store';
import {entityDb} from '@/app/entity-db/client';
import {recordRankingView,recordPageView} from '@/app/entity-db/pages';
// A reader viewed a ranking page (sent by the page in the browser, once per page per session; crawlers that run
// no scripts are not counted). Feeds the "Popular rankings" of every node page.
export const dynamic='force-dynamic';
export async function POST(request:Request){
 if(!sameOrigin(request))return new Response(null,{status:403});
 const {slug,kind,path}=await request.json().catch(()=>({})) as {slug?:unknown;kind?:unknown;path?:unknown};
 const db=await entityDb();
 if(typeof slug==='string')await recordRankingView(db,slug).catch(e=>console.warn('ranking view',(e as Error).message));
 if(typeof kind==='string'&&typeof path==='string')await recordPageView(db,kind,path).catch(e=>console.warn('page view',(e as Error).message));
 return new Response(null,{status:204});
}
