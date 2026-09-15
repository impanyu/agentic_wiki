import {pageForksSql} from './page-forks';
import {repairKnownMappings} from './known-mapping-repairs';
import {hydrateComponents} from '@/app/components-registry/runtime';
import {env} from '@/server/runtime';
import type {AnswerPage} from '@/app/page-types';
export function database(){if(!env.DB)throw new Error('The answer database is not available. Please try again later.');return env.DB;}
export function aiKey(){return (env as unknown as Record<string,string>).OPENAI_API_KEY || process.env.OPENAI_API_KEY || '';}
export function model(){return (env as unknown as Record<string,string>).OPENAI_MODEL || process.env.OPENAI_MODEL || 'gpt-5.4-mini';}
export function normalize(text:string){return text.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('en-US');}
export type Row={id:string;kind:'static'|'dynamic';dynamic_config:string|null;language:string;labels:string;owner_id:string;question:string;title:string;summary:string;body:string;category:string;sources:string;visibility:'public'|'private';created_at:string;updated_at:string|null;checked_at:string|null;question_count:number;public_write:number};
export async function getPage(id:string,userId:string):Promise<AnswerPage|null>{
 await repairKnownMappings(database(),userId);
 const replacement=await database().prepare("SELECT r.page_id FROM page_replacements r JOIN pages p ON p.id=r.page_id WHERE r.user_id=? AND r.source_id=COALESCE((SELECT page_id FROM page_aliases WHERE id=?),?) AND (p.visibility='public' OR p.owner_id=?)").bind(userId,id,id,userId).first<{page_id:string}>();
 if(replacement)id=replacement.page_id;
 const row=await database().prepare(`SELECT p.*, (SELECT count(*) FROM questions q WHERE q.page_id=p.id) question_count FROM pages p WHERE p.id=COALESCE((SELECT page_id FROM page_aliases WHERE id=?),?) AND (p.visibility='public' OR p.owner_id=?)`).bind(id,id,userId).first<Row>();
 if(!row){
  const c=await database().prepare("SELECT c.*,(SELECT count(*) FROM component_questions q WHERE q.component_id=c.id) question_count FROM components c WHERE c.id=? AND c.type<>'page' AND (c.visibility='public' OR c.owner_id=?)").bind(id,userId).first<{id:string;type:string;version:number;owner_id:string;visibility:'public'|'private';language:string;title:string;description:string;payload:string;created_at:string;updated_at:string|null;checked_at:string|null;question_count:number}>();
  if(!c)return null;
  const dependencies=await database().prepare("SELECT d.role,c.id,c.version,c.type,c.title FROM component_dependencies d JOIN components c ON c.id=d.component_id AND c.version=d.version WHERE d.parent_id=? AND (c.visibility='public' OR c.owner_id=?) ORDER BY d.role").bind(c.id,userId).all<{role:string;id:string;version:number;type:string;title:string}>();
  return {id:c.id,kind:'resource',component:{type:c.type,version:c.version,payload:JSON.parse(c.payload),links:dependencies.results},title:c.title,question:c.title,summary:c.description,body:'',category:c.type.replaceAll('_',' '),language:c.language,labels:{},sources:[],links:[],visibility:c.visibility,owned:c.owner_id===userId,createdAt:c.created_at,questionCount:c.question_count};
 }

 const links=await database().prepare(`SELECT l.id,l.quote,l.segments,l.parameters,t.id targetId,t.title targetTitle FROM internal_links l JOIN pages t ON t.id=COALESCE((SELECT page_id FROM page_replacements WHERE user_id=? AND source_id=COALESCE((SELECT page_id FROM page_aliases WHERE id=l.target_id),l.target_id)),(SELECT page_id FROM page_aliases WHERE id=l.target_id),l.target_id) WHERE l.source_id=? AND (t.visibility='public' OR t.owner_id=?) ORDER BY l.created_at,l.id`).bind(userId,row.id,userId).all<{id:string;quote:string;segments:string;parameters:string;targetId:string;targetTitle:string}>();
 const forks=await database().prepare(pageForksSql).bind(userId,row.id,userId,userId).all<{id:string;title:string;visibility:'public'|'private';createdAt:string}>();
 return hydrateComponents({forks:forks.results.length?forks.results.map(f=>({...f,publicWrite:Boolean((f as typeof f&{publicWrite?:number}).publicWrite)})):[{id:row.id,title:row.title,visibility:row.visibility,publicWrite:row.public_write===1,createdAt:row.created_at,isOriginal:true,removable:row.owner_id===userId}],links:links.results.map(link=>({...link,segments:JSON.parse(link.segments),parameters:JSON.parse(link.parameters)})),kind:row.kind,dynamic:row.dynamic_config?JSON.parse(row.dynamic_config):undefined,id:row.id,question:row.question,language:row.language,labels:JSON.parse(row.labels),title:row.title,summary:row.summary,body:row.body,category:row.category,sources:JSON.parse(row.sources),visibility:row.visibility,publicWrite:row.public_write===1,owned:row.owner_id===userId,createdAt:row.created_at,updatedAt:row.updated_at||undefined,checkedAt:row.checked_at||undefined,questionCount:row.question_count},userId);
}
export async function lock(name:string,ttl=240000){const token=crypto.randomUUID();const now=Date.now();const result=await database().prepare(`INSERT INTO generation_locks(name,token,expires) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET token=excluded.token,expires=excluded.expires WHERE generation_locks.expires < ?`).bind(name,token,now+ttl,now).run();return result.meta.changes?token:null;}
export async function unlock(token:string){await database().prepare(`DELETE FROM generation_locks WHERE token=?`).bind(token).run();}
export function reply(data:unknown,status=200){return Response.json(data,{status,headers:{'Cache-Control':'no-store, private','Vary':'Cookie','X-Content-Type-Options':'nosniff'}});}
export function sameOrigin(request:Request){return request.headers.get('Origin')===(process.env.APP_URL ? new URL(process.env.APP_URL).origin : new URL(request.url).origin);}
