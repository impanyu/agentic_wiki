import {entityDb} from '@/app/entity-db/client';
import {suggest} from '@/app/entity-db/pages';
// Suggestions while the reader types: the best matching pages by name (topics, rankings and their criterion
// views, entities). Database only — no model — so it answers within milliseconds.
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const q=new URL(request.url).searchParams.get('q')||'';
 if(!q.trim())return Response.json({hits:[]});
 try{return Response.json({hits:await suggest(await entityDb(),q,8)},{headers:{'Cache-Control':'public, max-age=60'}});}
 catch(e){console.warn('suggest',(e as Error).message);return Response.json({hits:[]});}
}
