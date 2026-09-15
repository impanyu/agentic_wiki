import {database,getPage} from '@/db/store';
import {sourceUrl} from './fetch';

// URL identity is independent of language, embeddings and the source's availability.
export async function matchSourceUrl(question:string,userId:string){
 const url=sourceUrl(question);if(!url)return null;
 const rows=await database().prepare(`SELECT p.id FROM questions q JOIN pages p ON p.id=q.page_id
  WHERE q.normalized=? AND p.kind='static' AND (p.visibility='public' OR p.owner_id=?)
  ORDER BY (p.owner_id=?) DESC,q.created_at,q.id`).bind('url:'+url.href,userId,userId).all<{id:string}>();
 for(const row of rows.results){
  const page=await getPage(row.id,userId);
  if(page?.kind==='static')return page;
 }
 return null;
}
