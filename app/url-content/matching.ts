import {database,getPage} from '@/db/store';
import {sourceUrl} from './fetch';

// URL identity is independent of language, embeddings and the source's availability.
export async function matchSourceUrl(question:string,userId:string){
 const text=question.trim();
 let url:URL|null=null;
 if(/^\S+$/.test(text))url=sourceUrl(text);
 else{
  const urls=new Set<string>();
  for(const match of text.matchAll(/(?:https?:\/\/|www\.)[^\s<>"'，。！？；（）]+/gi)){
   let candidate=match[0].replace(/[.,;!?]+$/,'');
   while(candidate.endsWith(')')&&(candidate.match(/\)/g)?.length||0)>(candidate.match(/\(/g)?.length||0))candidate=candidate.slice(0,-1);
   try{const parsed=sourceUrl(candidate);if(parsed)urls.add(parsed.href);}catch{}
  }
  // Multiple distinct sources need normal intent analysis rather than an arbitrary redirect.
  if(urls.size===1)url=new URL([...urls][0]);
 }
 if(!url)return null;
 const rows=await database().prepare(`SELECT p.id FROM questions q JOIN pages p ON p.id=q.page_id
  WHERE q.normalized=? AND p.kind='static' AND (p.visibility='public' OR p.owner_id=?)
  ORDER BY (p.owner_id=?) DESC,q.created_at,q.id`).bind('url:'+url.href,userId,userId).all<{id:string}>();
 for(const row of rows.results){
  const page=await getPage(row.id,userId);
  if(page?.kind==='static')return page;
 }
 return null;
}
