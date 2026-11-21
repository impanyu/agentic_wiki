import {entityDb} from '@/app/entity-db/client';
import {loadRankingPage} from '@/app/entity-db/pages';
import {assembleRankingPage,rowsCsv} from '@/app/seo/assemble';
// /rankings/<slug>/data.csv: the rows the ranking page shows (long form: one row per entity and period).
export const dynamic='force-dynamic';
export async function GET(_request:Request,{params}:{params:Promise<{slug:string}>}){
 const {slug}=await params;
 const input=await loadRankingPage(await entityDb(),decodeURIComponent(slug)).catch(()=>null);
 if(!input)return new Response('Not found',{status:404});
 const model=assembleRankingPage(input,'en');
 const columns=['name','type','period',...(model.groupKey?[model.groupKey]:[]),...model.criteria.map(c=>c.key)];
 return new Response(rowsCsv(model.rows,columns),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="${input.def.slug}.csv"`,'Cache-Control':'public, max-age=3600'}});
}
