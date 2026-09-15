import {generationProgress} from '@/app/generation-progress';
import {importWikiRoutes} from '@/db/routing-tables';
import {ensurePageSession,rememberSessionRoutes} from '@/app/chat/session';
import {startJob,finishJob} from '@/app/context-index/jobs';
import {routeInputs,programNavigationInput} from '@/app/page-programs/inputs';
import {answerStream} from '@/app/answer-stream';
import {generateContext} from '@/app/page-programs/generate-context';
import {selectTemplate} from '@/app/templates/select';
import {matchQuestion} from './question-search';
import {refreshMatchedPage} from './refresh-matched-page';
import {resolveRootRoute,rememberRootRoute} from '@/app/routing/root-table';
import {spawnAgent,recordAction} from '@/app/components-registry/agents';
import {attachComponents,type AgentContext} from '@/app/components-registry/registry';
import {extractApplicationInputs} from '@/app/components-registry/composer';
import {executePage} from '@/app/components-registry/runtime';
import type {AnswerPage} from '@/app/page-types';
import {getActor} from '@/app/actor';
import {database,getPage,reply,sameOrigin,normalize,lock,unlock,aiKey} from '@/db/store';
import {embed,detectLanguages,parseConversion,MATCH_VERSION,type ResearchUpdate} from './ai';

export async function POST(request:Request){
 const actor=await getActor(request);
 if(!sameOrigin(request)||!request.headers.get('accept')?.includes('text/event-stream'))return routeAnswer(request,actor);
 // Buffer once so a busy-generation retry can safely read the same input.
 const body=await request.text();
 let progress:ReturnType<typeof generationProgress>|undefined;
 try{const {generationId}=JSON.parse(body);if(typeof generationId==='string'&&/^[0-9a-f-]{36}$/.test(generationId)){await database().prepare('DELETE FROM generation_progress WHERE expires<?').bind(Date.now()).run();progress=generationProgress(generationId,actor.userId);}}catch{}
 return actor.finish(answerStream(signal=>routeAnswer(new Request(request.url,{method:'POST',headers:request.headers,body,signal}),actor),request.signal,'Finding the right page…',progress));
}
async function routeAnswer(request:Request,actor:Awaited<ReturnType<typeof getActor>>){
 let jobId:string|null=null,jobState='completed';
 let token:string|null=null;const respond=(data:unknown,status=200)=>actor.finish(reply(data,status));
 try{
  if(!sameOrigin(request))return respond({error:'This request must come from the site.'},403);
  const data=await request.json() as {question?:unknown;visibility?:unknown;fork?:{sourceId?:unknown;requestId?:unknown}};
  if(typeof data.question!=='string'||!data.question.trim()||data.question.length>4000)return respond({error:'Enter between 1 and 4,000 characters.'},400);
  const question=data.question.trim(),uid=actor.userId;
  let fork: {sourceId:string;requestId:string;groupId:string;createdAt:string}|undefined;
  if(data.fork){
   if(typeof data.fork.sourceId!=='string'||typeof data.fork.requestId!=='string'||!/^[0-9a-f-]{36}$/.test(data.fork.requestId))return respond({error:'Invalid fork request.'},400);
   const source=await getPage(data.fork.sourceId,uid);if(!source)return respond({error:'This context is not accessible.'},404);
   const prior=await database().prepare('SELECT p.id FROM pages p JOIN page_forks f ON f.page_id=p.id WHERE p.id=? AND p.owner_id=? AND f.parent_id=?').bind(data.fork.requestId,uid,source.id).first<{id:string}>();
   if(prior)return respond({page:await getPage(prior.id,uid),reused:false});
   const family=await database().prepare('SELECT group_id FROM page_forks WHERE page_id=?').bind(source.id).first<{group_id:string}>();
   fork={sourceId:source.id,requestId:data.fork.requestId,groupId:family?.group_id||source.id,createdAt:source.createdAt};
  }
  jobId=await startJob(uid,'navigation',question);
  if(!aiKey())return respond({error:'The AI connection is not configured yet.'},503);
  const language=(await detectLanguages([{id:'question',text:question}])).get('question')!;
  // Classify legacy articles by their actual prose, never by their original query.
  // This repairs language metadata without changing saved content or page IDs.
  while(true){
   const legacy=await database().prepare("SELECT id,title,summary,body FROM pages WHERE language='und' AND owner_id=? LIMIT 12").bind(uid).all<{id:string;title:string;summary:string;body:string}>();
   if(!legacy.results.length)break;
   const languages=await detectLanguages(legacy.results.map(p=>({id:p.id,text:p.title+'\n'+p.summary+'\n'+p.body.slice(0,6000)})));
   await database().batch(legacy.results.map(p=>database().prepare("UPDATE pages SET language=? WHERE id=? AND language='und'").bind(languages.get(p.id)!,p.id)));
  }
  const context:AgentContext={userId:uid,ownerId:uid,language,visibility:'private'};
  const rootRouter=await spawnAgent('root-routing',context.ownerId);
  const vector=await embed(question);
  const rootRoute=await resolveRootRoute(question,vector,language,uid,rootRouter);
  const requested=rootRoute.intent;context.pageIntent=requested.kind;
  const domain=requested.kind==='article'?'wiki':requested.service!=='none'?'app':requested.route==='session'?'session':'app';
  const router=await spawnAgent(domain+'-routing',context.ownerId,rootRouter);context.agent=router;
  const parameterRouter=domain==='app'?rootRouter:router;
  await recordAction(rootRouter,'Route to context branch',{question,domain,agentId:router.id,intent:requested});
  const destination=question;
  const destinationKey=normalize(destination);
  const originalKey=normalize(question);
  // Every visit embeds and verifies the nearest question-pool entries, including exact repeats.
  // Reuse this request’s embedding in the selected child table.
  let intentPromise:ReturnType<typeof parseConversion>|undefined;
  const conversion=()=>intentPromise??=parseConversion(destination);
  async function resolvePage(pageId:string){
   const page=await getPage(pageId,uid);
   if(page?.dynamic?.template==='agent-chat-v1'){const session=await ensurePageSession(page.id,uid);await rememberSessionRoutes(page.id,uid,session.id);await recordAction(router,'Open persistent chat session',{pageId:page.id,sessionId:session.id});return {...page,sessionId:session.id};}
   if(page?.dynamic?.template==='context-index-v1'){const parameters=await routeInputs(destination,page,parameterRouter);return executePage(page,parameters,uid);}
   if(page?.dynamic?.template==='page-program-v1'){const parameters=await routeInputs(destination,page,parameterRouter);return executePage({...page,parameters},programNavigationInput(parameters),uid);}
   if(page?.dynamic?.template==='file-browser-v1')return {...page,parameters:await routeInputs(destination,page,parameterRouter)};
   if(['component-chart-v1','component-sandbox-v1','google-drive-folders-v1','agent-chat-v1','file-browser-v1'].includes(page?.dynamic?.template||''))return page;
   if(page?.dynamic?.template==='component-form-v1'&&page.dynamic.form){const input=await extractApplicationInputs(destination,page.dynamic.form,parameterRouter);page.parameters=input;try{return await executePage(page,input,uid);}catch{return page;}}
   if(page?.kind==='dynamic'&&page.dynamic){const intent=await conversion();if(intent.intent!=='unit_conversion')throw new Error('AI_UNAVAILABLE');if(intent.input){try{Object.assign(page,await executePage(page,intent.input,uid));}catch{page.runtimeError=page.dynamic.labels.invalid;}}}
   return page;
  }
  async function remember(pageId:string,page:AnswerPage){
   await rememberRootRoute(question,vector,language,uid,domain,pageId,requested);
   const now=new Date().toISOString();
   const entries=originalKey===destinationKey?[[originalKey,question]]:[[originalKey,question],[destinationKey,destination]];
   await database().batch([...entries.map(([key,text])=>database().prepare(`INSERT OR IGNORE INTO questions(id,page_id,normalized,question,embedding,created_at,match_version,capability,parameters,routing_scope) SELECT ?,id,?,?,?,?,?,CASE WHEN kind='dynamic' THEN COALESCE(json_extract(dynamic_config,'$.capability'),'unit-converter-v1') WHEN json_extract(labels,'$.templateId')='disambiguation-v1' THEN 'disambiguation' ELSE 'article' END,?,? FROM pages WHERE id=? AND (visibility='public' OR owner_id=?)`).bind(crypto.randomUUID(),key,text,JSON.stringify(vector),now,MATCH_VERSION,JSON.stringify(page.parameters||page.runtime?.input||{}),domain,pageId,uid))]);
   if(domain==='wiki')await importWikiRoutes(database(),uid);
   if(domain==='session'){const session=await ensurePageSession(pageId,uid);await rememberSessionRoutes(pageId,uid,session.id);}
   page.forks=(await getPage(page.id,uid))?.forks;
  }
  async function findMatch(signal?:AbortSignal){
   const rootApp=rootRoute.appId?await getPage(rootRoute.appId,uid):null;
   const id=rootApp?.kind==='dynamic'?rootApp.id:await matchQuestion(destination,vector,language,uid,router,signal,domain);
   if(!id)return null;
   const page=await getPage(id,uid);
   if(!page)return null;
   // Equivalent text must also lead to the requested kind of context.
   if(requested.kind==='application'&&page.kind!=='dynamic')return null;
   if(requested.kind==='article'&&page.kind!=='static')return null;
   if(requested.kind==='chart'&&page.dynamic?.capability!=='chart')return null;
   if(requested.service==='context_pages'&&page.dynamic?.indexKind!=='pages')return null;
   if(requested.service==='user_jobs'&&page.dynamic?.indexKind!=='jobs')return null;
   if(requested.service==='google_drive_folders'&&!['file-browser-v1','google-drive-folders-v1'].includes(page.dynamic?.template||''))return null;
   return id;
  }

  let matched=fork?null:await findMatch();
  if(matched){const page=await resolvePage(matched);if(!page)return respond({error:'This page is no longer accessible. Please try again.'},404);await remember(page.id,page);const updated=await refreshMatchedPage(page,destination,requested.fresh,uid,router);return respond({page:updated,reused:true,destination});}
  // The content generator chooses article versus disambiguation after reuse misses.
  const presentation=requested.kind==='article'?'wiki-v1':domain==='session'?'chat-v1':requested.service==='google_drive_folders'?'files-v1':['context_pages','user_jobs'].includes(requested.service)?'wiki-v1':await selectTemplate(destination,router,undefined,requested.kind);
  const visibility='private' as const;
  const keyBytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([language,destinationKey,uid])));
  const generationKey=fork?'fork:'+fork.requestId:'question:'+Array.from(new Uint8Array(keyBytes),b=>b.toString(16).padStart(2,'0')).join('');
  token=await lock(generationKey,300000);
  if(!token)return respond({error:'This question is already being prepared.',retryAfter:2},409);
  const lease=token;
  const deadline=AbortSignal.timeout(240000);

  async function generate(emit?:(event:ResearchUpdate)=>void,signal?:AbortSignal){
   signal=signal?AbortSignal.any([signal,deadline]):deadline;
   signal.throwIfAborted();
   if(domain==='app')await recordAction(router,'Return app cache miss to root',{question:destination,rootAgentId:rootRouter.id});
   const generated=await generateContext({question:destination,templateId:presentation,fresh:requested.fresh,service:requested.service,route:domain},context,domain==='app'?rootRouter:router,emit,signal);
   const {answer,definition}=generated,dependencies=definition?.components||[],id=fork?.requestId||crypto.randomUUID(),now=new Date().toISOString();
  const active=await database().prepare("SELECT token FROM generation_locks WHERE token=? AND expires>?").bind(lease,Date.now()).first();
  if(!active)throw new Error('The request took too long. Please try again.');
   signal?.throwIfAborted();
  // Only final cache reconciliation is serialized. Research for unrelated
  // questions runs concurrently; equivalent parallel drafts still share one page.
  let publishToken:string|null=null;
  while(!publishToken){
   signal.throwIfAborted();publishToken=await lock('publish:'+language,90000);
   if(!publishToken)await new Promise(resolve=>setTimeout(resolve,300));
  }
  try{
   signal.throwIfAborted();
   const existing=fork?null:await findMatch(signal);
   signal.throwIfAborted();
   const live=await database().prepare('SELECT count(*) n FROM generation_locks WHERE token IN (?,?) AND expires>?').bind(lease,publishToken,Date.now()).first<{n:number}>();
   if(live?.n!==2)throw new Error('Generation was cancelled or timed out. Please try again.');
   if(existing){const page=await resolvePage(existing);if(page){await remember(existing,page);return {page,reused:true,destination};}}
  const entries=originalKey===destinationKey?[[originalKey,question]]:[[originalKey,question],[destinationKey,destination]];
  if(fork&&!await getPage(fork.sourceId,uid))throw Error('The original context is no longer accessible.');
  await database().batch([
   ...(fork?[
    database().prepare('INSERT OR IGNORE INTO page_forks(page_id,group_id,parent_id,created_at) VALUES(?,?,NULL,?)').bind(fork.sourceId,fork.groupId,fork.createdAt),
   ]:[]),
   database().prepare('INSERT INTO pages(id,owner_id,question,title,summary,body,category,sources,visibility,created_at,language,labels,kind,dynamic_config) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,context.ownerId,destination,answer.title,answer.summary,answer.body,answer.category,JSON.stringify(answer.sources),visibility,now,language,JSON.stringify({...answer.labels,templateId:generated.templateId}),definition?'dynamic':'static',definition?JSON.stringify({...definition.config,contextDomain:domain,form:undefined}):null),
   ...(fork?[database().prepare('INSERT INTO page_forks(page_id,group_id,parent_id,created_at) VALUES(?,?,?,?)').bind(id,fork.groupId,fork.sourceId,now)]:[]),
   ...(fork?[]:entries).map(([key,text])=>database().prepare('INSERT INTO questions(id,page_id,normalized,question,embedding,created_at,match_version,capability,parameters,routing_scope) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),id,key,text,JSON.stringify(vector),now,MATCH_VERSION,(definition&&'capability'in definition.config?definition.config.capability:null)||(definition?'application':generated.templateId==='disambiguation-v1'?'disambiguation':'article'),JSON.stringify(definition?.parameters||{}),domain))
  ]);
  if(dependencies.length)await attachComponents(id,dependencies,context);
  if(domain==='wiki')await importWikiRoutes(database(),uid);
  const page=await resolvePage(id);if(!page)throw new Error('Could not load the saved page.');
  if(!fork)await rememberRootRoute(question,vector,language,uid,domain,page.id,requested);
  if(domain==='app')await recordAction(rootRouter,'Route original question to generated app',{pageId:page.id,parameters:page.parameters||page.runtime?.input||{}});
  return {page,reused:false,destination};
  }finally{await unlock(publishToken).catch(()=>{});}

  }
  if(!request.headers.get('accept')?.includes('text/event-stream'))return respond(await generate());
  const cancellation=new AbortController();
  const onDisconnect=()=>cancellation.abort();
  request.signal.addEventListener('abort',onDisconnect,{once:true});
  if(request.signal.aborted)cancellation.abort();
  // The stream now owns the lease; the outer finally must not release it early.
  token=null;const streamJob=jobId;jobId=null;
  const encoder=new TextEncoder();
  const stream=new ReadableStream<Uint8Array>({
   start(controller){
    let closed=false;
    const emit=(event:unknown)=>{if(!closed&&!cancellation.signal.aborted){try{controller.enqueue(encoder.encode('data: '+JSON.stringify(event)+'\n\n'));}catch{cancellation.abort();}}};
    const heartbeat=setInterval(()=>emit({type:'ping'}),10000);
    let checking=false;
    const cancellationCheck=setInterval(()=>{if(checking)return;checking=true;void database().prepare('SELECT token FROM generation_locks WHERE token=?').bind(lease).first().then(active=>{if(!active)cancellation.abort();}).catch(()=>{}).finally(()=>{checking=false;});},2000);
    emit({type:'start',question,language,cancelToken:lease});
    emit({type:'status',message:'Finding or composing the right page…'});
    void (async()=>{
     try{const result=await generate(emit,cancellation.signal);emit({type:'done',...result});}
     catch(e){jobState='failed';if(!cancellation.signal.aborted){console.error('Streamed answer failed',e instanceof Error?e.message.slice(0,200):'Unknown error');emit({type:'error',message:e instanceof Error&&e.message==='DISAMBIGUATION_INCOMPLETE'?'The possible meanings could not be organized into a valid index. Please retry or specify which meaning you want. No page was saved.':e instanceof Error&&e.message==='INCOMPLETE_ANSWER'?'The answer could not be verified after revision. No page was saved.':e instanceof Error&&e.message.startsWith('SANDBOX_')?'This application needs the sandbox service. Open Sandboxes to check its connection.':e instanceof Error&&e.message==='APPLICATION_CAPABILITY_UNAVAILABLE'?'This application needs an execution capability that is not configured yet. No placeholder page was saved.':'Generation did not finish. This draft has not been saved. Please try again.'});}}
     finally{if(streamJob)await finishJob(streamJob,cancellation.signal.aborted?'cancelled':jobState).catch(()=>{});clearInterval(heartbeat);clearInterval(cancellationCheck);request.signal.removeEventListener('abort',onDisconnect);await unlock(lease).catch(()=>{});closed=true;try{controller.close();}catch{}}
    })();
   },
   cancel(){cancellation.abort();},
  });
  return actor.finish(new Response(stream,{headers:{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store, private, no-transform','Vary':'Cookie, Accept','X-Accel-Buffering':'no','X-Content-Type-Options':'nosniff'}}));

 }catch(e){jobState='failed';const message=e instanceof Error?e.message:'';console.error('Answer navigation failed',message.slice(0,300));return respond({error:message==='AI_LIMIT'?'The AI service has reached its usage limit. Please try again later.':message==='AI_SETUP'?'The AI connection is not configured yet.':'Could not complete this answer. Your text is preserved; please try again.'},503);}
 finally{if(jobId)await finishJob(jobId,jobState).catch(()=>{});if(token)await unlock(token).catch(()=>{});}
}

// A per-request capability lets Back/Forward cancel even through proxies that
// do not propagate a disconnected browser's AbortSignal to the Worker.
export async function DELETE(request:Request){
 if(!sameOrigin(request))return reply({error:'This request must come from the site.'},403);
 try{
  const {cancelToken}=await request.json() as {cancelToken?:unknown};
  if(typeof cancelToken!=='string'||!/^[0-9a-f-]{36}$/.test(cancelToken))return reply({error:'Invalid cancellation request.'},400);
  await unlock(cancelToken);
  return new Response(null,{status:204,headers:{'Cache-Control':'no-store'}});
 }catch{return reply({error:'Could not cancel generation.'},503);}
}

export async function GET(request:Request){
 const actor=await getActor(request),id=new URL(request.url).searchParams.get('generationId');
 if(!id||!/^[0-9a-f-]{36}$/.test(id))return actor.finish(reply({error:'Invalid generation ID.'},400));
 const row=await database().prepare('SELECT data FROM generation_progress WHERE id=? AND owner_id=? AND expires>?').bind(id,actor.userId,Date.now()).first<{data:string}>();
 return actor.finish(reply(row?JSON.parse(row.data):{pending:true}));
}
