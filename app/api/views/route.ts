import {sameOrigin} from '@/db/store';
import {entityDb} from '@/app/entity-db/client';
import {recordRankingView} from '@/app/entity-db/pages';
// A reader viewed a ranking page (sent by the page in the browser, once per page per session; crawlers that run
// no scripts are not counted). Feeds the "Popular rankings" of every node page.
export const dynamic='force-dynamic';
export async function POST(request:Request){
 if(!sameOrigin(request))return new Response(null,{status:403});
 const {slug}=await request.json().catch(()=>({})) as {slug?:unknown};
 if(typeof slug!=='string')return new Response(null,{status:400});
 await recordRankingView(await entityDb(),slug).catch(e=>console.warn('ranking view',(e as Error).message));
 return new Response(null,{status:204});
}
