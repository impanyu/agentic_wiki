import {database,getPage,normalize} from '@/db/store';
import {assessQuestion,cosine,type Candidate} from '@/app/api/ask/ai';
import {nearestQuestions} from '@/app/api/ask/ranking';
import {pageIntent} from '@/app/components-registry/chart-composer';
import {recordAction,type Agent} from '@/app/agents/runtime';
import {storagePageMismatch} from '@/app/storage/page-scope';
type Intent=Awaited<ReturnType<typeof pageIntent>>;
type RootRoute={id:string;question:string;embedding:string;target_type:'wiki_router'|'session_router'|'app';app_id:string|null;intent:string};
export function rootTarget(domain:'wiki'|'session'|'app',pageId:string){return {type:domain==='wiki'?'wiki_router':domain==='session'?'session_router':'app',appId:domain==='app'?pageId:null};}
export async function resolveRootRoute(question:string,vector:number[],language:string,userId:string,agent:Agent){
 let candidates:(Candidate&{route:RootRoute})[]=[],after='';
 while(true){
  const rows=await database().prepare(`SELECT r.* FROM root_routes r WHERE r.owner_id=? AND r.language=? AND r.id>? AND ((r.target_type IN ('wiki_router','session_router') AND r.app_id IS NULL) OR (r.target_type='app' AND EXISTS(SELECT 1 FROM pages p WHERE p.id=r.app_id AND p.kind='dynamic' AND (p.owner_id=? OR p.visibility='public')))) ORDER BY r.id LIMIT 100`).bind(userId,language,after,userId).all<RootRoute>();
  candidates=nearestQuestions([...candidates,...rows.results.map(r=>({id:r.id,question:r.question,language,score:cosine(vector,JSON.parse(r.embedding)),capability:JSON.parse(r.intent).kind,route:r}))]);
  if(rows.results.length<100)break;after=rows.results.at(-1)!.id;
 }
 const decision=candidates.length?await assessQuestion(question,candidates,language):null;
 let selected=decision?.confidence==='high'?candidates.find(c=>c.id===decision.questionId):null;
 if(selected?.route.app_id){const page=await getPage(selected.route.app_id,userId);if(!page||storagePageMismatch(question,page))selected=undefined;}
 await recordAction(agent,'Look up root routing table',{question,candidates:candidates.map(c=>({id:c.id,question:c.question,target:c.route.target_type})),matchedRouteId:selected?.id||null});
 if(selected){return {intent:JSON.parse(selected.route.intent) as Intent,appId:selected.route.app_id};}
 return {intent:await pageIntent(question,agent),appId:null};
}
export async function rememberRootRoute(question:string,vector:number[],language:string,userId:string,domain:'wiki'|'session'|'app',pageId:string,intent:Intent,addressKey?:string){
 const target=rootTarget(domain,pageId);
 await database().prepare(`INSERT INTO root_routes(id,owner_id,question,normalized,language,embedding,target_type,app_id,intent,created_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(owner_id,language,normalized) DO UPDATE SET question=excluded.question,embedding=excluded.embedding,target_type=excluded.target_type,app_id=excluded.app_id,intent=excluded.intent`).bind(crypto.randomUUID(),userId,question,addressKey??normalize(question),language,JSON.stringify(vector),target.type,target.appId,JSON.stringify(intent),new Date().toISOString()).run();
}
