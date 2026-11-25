import {rankingHistory} from '@/app/rankings/ranking-page';
import {isLocale} from '@/app/i18n/locales';
// /rankings/<slug>/history.json?lang=<locale>: every row of the ranking (all entities and periods), packed, in the
// reader's language. The page itself carries only the latest view and fetches this afterwards.
export const dynamic='force-dynamic';
export async function GET(request:Request,{params}:{params:Promise<{slug:string}>}){
 const {slug}=await params;const u=new URL(request.url);const lang=u.searchParams.get('lang')||'en',theme=(u.searchParams.get('theme')||'').slice(0,100);
 const rows=await rankingHistory(decodeURIComponent(slug),isLocale(lang)?lang:'en',theme).catch(()=>null);
 if(!rows)return Response.json({error:'Not found'},{status:404});
 return Response.json({rows},{headers:{'Cache-Control':'public, max-age=600'}});
}
