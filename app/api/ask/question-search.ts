import {importSessionRoutes} from '@/app/chat/session';
import {ensureRoutingScopes,importWikiRoutes} from '@/db/routing-tables';
import {repairKnownMappings} from '@/db/known-mapping-repairs';
import {database,getPage,normalize} from '@/db/store';
import {reviewMappedPage} from './review-mapped-page';
import {cosine,assessQuestion,type Candidate} from './ai';
import {nearestQuestions} from './ranking';
import {recordAction,type Agent} from '@/app/components-registry/agents';
// Page routing uses the question pool, not page titles or component descriptions.
export async function matchQuestion(question:string,vector:number[],language:string,userId:string,agent:Agent,signal?:AbortSignal,domain:'wiki'|'session'|'app'|'all'='all'){
 await repairKnownMappings(database(),userId);
 await ensureRoutingScopes(database(),userId);
 if(domain==='wiki')await importWikiRoutes(database(),userId);
 if(domain==='session')await importSessionRoutes(userId);
 const routeJoin=domain==='wiki'?' JOIN wiki_routes wr ON wr.question_id=q.id AND wr.page_id=q.page_id':domain==='session'?' JOIN (SELECT DISTINCT question_id,page_id FROM session_routes) sr ON sr.question_id=q.id AND sr.page_id=q.page_id':'';
 let candidates:(Candidate&{page_id:string})[]=[],after='';
 while(true){
  const rows=await database().prepare(`SELECT q.id,q.question,q.normalized,q.embedding,q.capability,p.language,q.page_id,p.question canonical_question,json_extract(p.labels,'$.templateId') template_id,p.labels page_labels FROM questions q JOIN pages p ON p.id=q.page_id${routeJoin} WHERE NOT (q.normalized LIKE 'url:%' AND q.question=substr(q.normalized,5)) AND p.language=? AND q.id>? AND (?='all' OR q.routing_scope=?) AND (p.visibility='public' OR p.owner_id=?) AND (q.routing_scope<>'session' OR p.owner_id=? OR EXISTS(SELECT 1 FROM session_routes r WHERE r.owner_id=? AND r.question_id=q.id AND r.page_id=p.id)) AND NOT EXISTS(SELECT 1 FROM page_aliases a WHERE a.id=p.id) AND NOT EXISTS(SELECT 1 FROM page_replacements r WHERE r.source_id=p.id AND r.user_id=?) ORDER BY q.id LIMIT 100`).bind(language,after,domain,domain,userId,userId,userId,userId).all<Candidate&{page_id:string;embedding:string;normalized:string;canonical_question:string;template_id:string;page_labels:string}>();
  // An index represents its original umbrella query. Previously learned narrow
  // aliases cannot become exact-match shortcuts back to that umbrella.
  candidates=nearestQuestions([...candidates,...rows.results.filter(row=>row.template_id!=='disambiguation-v1'||row.normalized===normalize(row.canonical_question)).map(({embedding,page_labels,...row})=>({...row,capability:row.template_id==='disambiguation-v1'?'disambiguation':row.capability,indexMeanings:row.template_id==='disambiguation-v1'?(JSON.parse(page_labels).indexEntries||[]).map((entry:{question:string})=>entry.question):undefined,score:cosine(vector,JSON.parse(embedding))}))]);
  if(rows.results.length<100)break;after=rows.results.at(-1)!.id;
 }
 // Select once from the top five. Rejection is a cache miss, not a fallback search.
 const decision=await assessQuestion(question,candidates,language,signal),id=decision.questionId;
 const selected=candidates.find(c=>c.id===id);if(!selected)return null;
 const differentIndexTerm=selected.capability==='disambiguation'&&normalize(question)!==normalize(selected.question);
 const listedMeaning=differentIndexTerm&&selected.indexMeanings?.some(meaning=>normalize(meaning)===normalize(question));
 // A specific sense of an ambiguous term must inspect its mapped page. Never
 // allow the model's high confidence to silently pick one interpretation.
 const confidence=listedMeaning||(differentIndexTerm&&decision.confidence==='high')?'uncertain':decision.confidence;
 await recordAction(agent,'Match top five questions',{question,candidates:candidates.map(c=>({id:c.id,question:c.question,score:c.score})),matchedQuestionId:id,confidence,modelConfidence:decision.confidence,reason:confidence!==decision.confidence?'Ambiguous index candidate requires mapped-page inspection.':decision.reason});
 if(confidence==='none')return null;
 if(confidence==='high')return selected.page_id;
 const page=await getPage(selected.page_id,userId);
 const verdict=page?await reviewMappedPage(question,page,signal):{accepted:false,reason:'Mapped page is no longer accessible.'};
 await recordAction(agent,'Check mapped page answers question',{question,matchedQuestionId:id,pageId:selected.page_id,...verdict});
 return verdict.accepted?selected.page_id:null;
}
