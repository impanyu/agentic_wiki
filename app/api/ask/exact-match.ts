import {database,getPage,normalize} from '@/db/store';
import {repairKnownMappings} from '@/db/known-mapping-repairs';
import {MATCH_VERSION} from './ai';
import {needsReview} from './refresh-matched-page';
import {parametersSchema} from '@/app/components-registry/contracts';
import {storagePageMismatch} from '@/app/storage/page-scope';
import {requireValidIndex} from '@/app/disambiguation/graph';
import {deferPageExecution} from '@/app/page-programs/deferred';
// Only reuse an already learned, exact, current-version mapping for this user.
// Semantic uncertainty, stale articles, ambiguous forks, and fresh-data requests
// continue through the existing routing workflow.
export async function exactSavedQuestion(question:string,userId:string){
 if(/\b(latest|current|currently|today|tonight|now|recent|price|weather|news)\b|最新|目前|今天|现在|当前|实时/i.test(question))return null;
 await repairKnownMappings(database(),userId);
 const rows=await database().prepare(`SELECT q.page_id,q.parameters FROM questions q JOIN pages p ON p.id=q.page_id JOIN root_routes r ON r.owner_id=? AND r.normalized=q.normalized AND r.language=p.language WHERE q.normalized=? AND q.match_version=? AND json_extract(r.intent,'$.fresh')=0 AND (r.target_type<>'app' OR r.app_id=p.id) AND (p.owner_id=? OR p.visibility='public') AND (q.routing_scope<>'session' OR p.owner_id=? OR EXISTS(SELECT 1 FROM session_routes sr WHERE sr.owner_id=? AND sr.page_id=p.id)) AND NOT EXISTS(SELECT 1 FROM page_aliases a WHERE a.id=p.id) AND NOT EXISTS(SELECT 1 FROM page_replacements pr WHERE pr.user_id=? AND pr.source_id=p.id) ORDER BY q.created_at DESC LIMIT 8`).bind(userId,normalize(question),MATCH_VERSION,userId,userId,userId,userId).all<{page_id:string;parameters:string}>();
 if(!rows.results.length||new Set(rows.results.map(r=>r.page_id)).size!==1)return null;
 const row=rows.results[0],page=await getPage(row.page_id,userId);
 if(!page||storagePageMismatch(question,page))return null;
 if(page.kind==='static'&&needsReview(page,false))return null;
 if(page.labels.templateId==='disambiguation-v1'){
  if(normalize(page.question||'')!==normalize(question))return null;
  await requireValidIndex(userId,page.id,question);
 }
 if(!page.dynamic)return page;
 let raw:unknown;try{raw=JSON.parse(row.parameters);}catch{return null;}
 const parsed=parametersSchema.safeParse(raw);if(!parsed.success)return null;
 const parameters=parsed.data;
 // Preserve explicitly supplied arguments; never guess values on the fast path.
 if(page.dynamic.inputFields?.some(f=>f.required&&!Object.hasOwn(parameters,f.name)))return null;
 if(page.dynamic.template==='page-program-v1')return deferPageExecution(page,{...parameters,query:question});
 if(['file-browser-v1','agent-chat-v1'].includes(page.dynamic.template))return {...page,parameters};
 // Cheap calculations and indexes keep their existing execution/refresh semantics.
 return null;
}
