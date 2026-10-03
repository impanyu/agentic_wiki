import {database,getPage} from '@/db/store';
import {sourceUrl,urlIdentity,urlKeys} from './fetch';

// URL identity is independent of language, embeddings and the source's availability. A pasted URL
// reopens only the page that was generated from that same URL.
export async function matchSourceUrl(question:string,userId:string){
 const url=sourceUrl(question);if(!url)return null;
 const rows=await database().prepare(`SELECT p.id FROM questions q JOIN pages p ON p.id=q.page_id
  WHERE q.normalized IN (SELECT value FROM json_each(?)) AND p.kind='static' AND (p.visibility='public' OR p.owner_id=?)
  ORDER BY (p.owner_id=?) DESC,q.created_at,q.id`).bind(JSON.stringify(urlKeys(url)),userId,userId).all<{id:string}>();
 for(const row of rows.results){
  const page=await getPage(row.id,userId);
  // Only a page created from this URL counts; aliases left by subject matching do not.
  let built=false;try{const made=sourceUrl(page?.question||'');built=!!made&&urlIdentity(made)===urlIdentity(url);}catch{}
  if(page?.kind==='static'&&built)return page;
 }
 return null;
}
