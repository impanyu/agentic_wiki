import {timingSafeEqual} from 'node:crypto';
import {PUBLIC_EDITION} from '@/app/edition';
// The pages the web process keeps warm (scripts/start.mjs fetches them every ten minutes): the top-level topics and
// every page readers opened in the last two weeks, in English and Chinese. With the page caches' long
// serve-stale window, a reader of these pages never waits for their data to be rebuilt.
export async function GET(request:Request){
 const token=process.env.LIVE_AGENT_TICK_TOKEN||'',given=request.headers.get('x-live-agent-token')||'';
 if(!token||given.length!==token.length||!timingSafeEqual(Buffer.from(given),Buffer.from(token)))return Response.json({error:'Forbidden.'},{status:403});
 if(!PUBLIC_EDITION)return Response.json({paths:[]});
 const {entityDb}=await import('@/app/entity-db/client');const db=await entityDb();
 const top=(await db.query<{slug:string}>("select slug from topics where parent_id is null and status <> 'archived' order by slug")).rows.map(r=>'/'+r.slug);
 const viewed=(await db.query<{key:string}>(`select key from page_views where day > current_date - 14 and kind in ('topic','ranking','entity')
   and key like '/%' and key not like '/admin%' group by key order by sum(n) desc limit 400`)).rows.map(r=>r.key);
 const base=[...new Set(['/',...top,...viewed])];
 const langs=(process.env.WARM_LOCALES||'zh').split(',').map(s=>s.trim()).filter(Boolean);
 return Response.json({paths:[...base,...base.flatMap(p=>langs.map(l=>'/'+l+(p==='/'?'':p)))]});
}
