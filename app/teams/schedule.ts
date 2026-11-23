import {entityDb} from '@/app/entity-db/client';
import {addRoadmapItem,listRoadmap} from '@/app/entity-db/repo';
import {listRecipes,getEntityType,embedRankings,type Recipe} from './config';
import {embedPending} from '@/app/entity-db/repo';
import {getEmbedder,setEmbedder} from '@/app/entity-db/embeddings';
import {storedEmbedDim} from '@/app/entity-db/schema';
import {embedder as llmEmbedder} from '@/app/llm';
import {runRecipe} from './recipes';
import {topicEditorId} from './tools';
// The crawler's schedule: every minute (the live-agent heartbeat) it runs recipes whose schedule is due, one at
// a time. A failed or drifting run (a site redesign: far fewer rows, a field suddenly empty) marks the recipe
// failed and adds a "refresh" item to the topic plan so the collector repairs it — no person in the loop.
const INTERVAL:Record<string,number>={hourly:3600e3,daily:86400e3,weekly:7*86400e3,monthly:30*86400e3,quarterly:91*86400e3,yearly:365*86400e3};
export function due(r:Pick<Recipe,'schedule'|'status'|'lastRunAt'>,now=Date.now()){
 const every=INTERVAL[r.schedule];if(!every||r.status==='paused')return false;
 if(!r.lastRunAt)return true;
 // A failed recipe is retried after a day at most (the collector is repairing it meanwhile).
 const gap=r.status==='failed'?Math.min(every,86400e3):every;
 return now-new Date(r.lastRunAt).getTime()>=gap;
}
// Up to CRAWLER_CONCURRENCY recipes run at once (default 3); each heartbeat starts what is due into free slots.
let running=false,lastRan='';const active=new Set<string>();
const activeTypes=new Set<string>();
export async function runDueRecipes(limit=Math.max(1,Number(process.env.CRAWLER_CONCURRENCY||3))){
 if(running)return {ran:0};running=true;
 try{
  // A long bulk load continuing over many ticks takes turns with the other due recipes.
  // One recipe per entity type at a time: two loads writing the same entities (217 countries from twelve indicator
  // recipes) deadlock each other; different types run side by side.
  const db=await entityDb();const ready=(await listRecipes(db)).filter(r=>due(r)&&!active.has(r.id)&&!activeTypes.has(r.type)).sort((a,b)=>Number(a.id===lastRan)-Number(b.id===lastRan));let ran=0;
  for(const r of ready){
   if(active.size>=limit)break;if(activeTypes.has(r.type))continue;
   lastRan=r.id;active.add(r.id);activeTypes.add(r.type);ran++;
   void runOne(db,r).finally(()=>{active.delete(r.id);activeTypes.delete(r.type);});
  }
  return {ran};
 }finally{running=false;}
}
async function runOne(db:Awaited<ReturnType<typeof entityDb>>,r:Recipe){
 const result=await runRecipe(db,r).catch(e=>({ok:false,steps:[],error:(e as Error).message}));
 if(!result.ok)await reportFailure(r,result).catch(e=>console.error('crawler: report failed',(e as Error).message));
 // Fresh data: the editors' indices over this type are recomputed from it at once.
 else if(!(result as {partial?:boolean}).partial)await recomputeIndices(r.type).catch(e=>console.error('crawler: index recompute failed',(e as Error).message));
 console.log('[crawler]',r.type+'/'+r.name,result.ok?((result as {partial?:boolean}).partial?'partial (continues next tick)':'ok'):'failed');
}
async function reportFailure(r:Recipe,result:{steps?:{id:string;ok:boolean;error?:string}[];drift?:string[];error?:string}){
 const db=await entityDb();const t=await getEntityType(db,r.type);const editorId=await topicEditorId(db,t?.topicId??null);if(!editorId)return;
 const title='Repair recipe '+r.type+'/'+r.name;
 // Failing again before the editor's team repaired it: the operators hear of it (one issue per recipe).
 if((await listRoadmap(db,editorId)).some(i=>i.title===title&&(i.status==='pending'||i.status==='running'))){
  const {raiseIssue}=await import('@/app/ops/issues');const f=result.steps?.find(s=>!s.ok);
  await raiseIssue(db,{source:'crawler',topic:r.type,severity:'major',title:'Recipe keeps failing: '+r.type+'/'+r.name,
   detail:'It failed again while its repair is still waiting for the team.\nFailed step: '+(f?.id??'-')+'\nError: '+String(f?.error||result.error||'-')+(result.drift?.length?'\nDrift: '+result.drift.join('; '):''),fingerprint:'recipe:'+r.type+'/'+r.name}).catch(()=>{});
  return;}
 const failed=result.steps?.find(s=>!s.ok);
 await addRoadmapItem(db,{editorId,kind:'refresh',title,priority:85,origin:'review',
  spec:{recipe:r.name,type:r.type,failedStep:failed?.id,error:failed?.error||result.error||null,drift:result.drift||null,
   advice:'The source may have changed (redesign, moved URL, renamed fields). Inspect a sample page or response again, fix the steps, save_recipe, run_recipe, then close this item.'}});
}

// Search vectors are prepared ahead of queries: on save, and here on the heartbeat for anything still missing
// (entities loaded by recipes, rankings whose embedding failed at save time).
let embedding=false;
export async function fillVectors(){
 if(embedding)return;embedding=true;
 try{const db=await entityDb();if(!getEmbedder())setEmbedder(t=>llmEmbedder()(t));const e=getEmbedder();if(!e)return;
  await embedRankings(db,e,await storedEmbedDim(db),20);
  await embedPending(db,1000);
 }catch(err){console.warn('vectors: fill failed',(err as Error).message);}finally{embedding=false;}
}

// The manager's daily review and the team queue, on the same heartbeat (one review at a time).
let reviewing=false,lastMaintenance=0;
export async function manageTeams(){
 const {entityDb}=await import('@/app/entity-db/client');const {managerDue,runManagerDaily,runTeamQueue}=await import('./manager');
 const {llmSpend}=await import('@/app/llm');
 const db=await entityDb();
 if(!reviewing&&await managerDue(db)){reviewing=true;void runManagerDaily(e=>console.log('[manager]',JSON.stringify(e))).catch(e=>console.error('[manager] failed',(e as Error).message)).finally(()=>{reviewing=false;});}
 // Every few hours the manager tends one branch of the tree (missing subtopics, duplicates).
 if(!reviewing){const {tendTree}=await import('./manager');reviewing=true;void tendTree(e=>console.log('[manager]',JSON.stringify(e))).catch(e=>console.error('[manager] tend failed',(e as Error).message)).finally(()=>{reviewing=false;});}
 // At most hourly: teams return to topics that need them.
 const now=Date.now();if(now-lastMaintenance>3600_000){lastMaintenance=now;const {scheduleMaintenance}=await import('./manager');const q=await scheduleMaintenance(db).catch(e=>{console.error('[queue] maintenance failed',(e as Error).message);return [];});if(q.length)console.log('[queue] queued',q.join(', '));}
 const started=await runTeamQueue(async()=>(await llmSpend()).spentUsd,(slug,e)=>console.log('[team:'+slug+']',JSON.stringify(e)));
 if(started.length)console.log('[queue] started',started.join(', '));
}

// Recomputes every published derived metric (an editor's index) whose scope is this entity type or a type it extends
// (an index invented higher in the tree is computed for every subtype's entities too).
export async function recomputeIndices(type:string):Promise<string[]>{
 const {computeDerivedMetric}=await import('@/app/entity-db/repo');
 const db=await entityDb();
 const rows=(await db.query<{key:string;version:number}>(`select distinct on (key) key, version from metrics where kind = 'derived' and status = 'published'
  and definition->'scope'->>'type' = any($1::text[]) order by key, version desc`,[(await (await import('@/app/entity-db/inherit')).typeChain(db,type)).map(t=>t.type).concat(type)])).rows;
 const done:string[]=[];
 for(const m of rows){try{await computeDerivedMetric(db,m.key,m.version);done.push(m.key);}catch(e){console.warn('index',m.key,(e as Error).message);}}
 if(done.length)console.log('[crawler] recomputed indices',type,done.join(', '));
 return done;
}

// Content translation on the heartbeat: the texts readers met in other languages since the last tick, a few batches
// a minute (CONTENT_TRANSLATE_BATCHES, default 6; 0 stops it).
export async function translateContent(){
 const batches=Number(process.env.CONTENT_TRANSLATE_BATCHES??20);if(!(batches>0))return 0;
 const db=await entityDb();const {queueTreeTranslations}=await import('@/app/i18n/content');
 // Once a day the topic tree's names and descriptions are queued for the most-read languages.
 {const {getState,setState}=await import('./manager');const st=await getState(db,'translate.tree').catch(()=>null);
  if(!st||Date.now()-Date.parse(String(st.at))>20*3600_000){await setState(db,'translate.tree',{at:new Date().toISOString()});void queueTreeTranslations(db).then(q=>console.log('[translate] queued',q,'tree texts')).catch(e=>console.error('[translate] queue failed',(e as Error).message));}}
 const {startTranslationPool}=await import('@/app/i18n/content');startTranslationPool(db,Number(process.env.CONTENT_TRANSLATE_WORKERS||6));const n=0;
 if(n)console.log('[translate]',n,'texts');
 return n;
}

// Landing pages in every language ahead of readers: the home page (top-level subjects and popular rankings) first
// (priority 3), then each subject's page (its children, priority 2). Every hour; only new or waiting texts are touched.
let landingAt=0;
export async function pretranslateLanding(){
 if(Date.now()-landingAt<60*60_000)return 0;landingAt=Date.now();
 const db=await entityDb();
 const {pathMaps,nodeChildren,popularRankings}=await import('@/app/entity-db/pages');
 const {queueTexts}=await import('@/app/i18n/content');const {LOCALES}=await import('@/app/i18n/locales');
 const langs=LOCALES.map(l=>l.code);
 try{
  const maps=await pathMaps(db);const top=nodeChildren(maps,'');
  const popular=await popularRankings(db,maps,'').catch(()=>[]);
  let n=await queueTexts(db,{v:top,p:popular},langs,3);
  for(const t of top)n+=await queueTexts(db,{v:nodeChildren(maps,t.href)},langs,2);
  if(n)console.log('[translate] landing pages queued',n);
  return n;
 }catch(e){console.error('[translate] landing failed',(e as Error).message);landingAt=0;return 0;}
}

// Wikidata starter (app/teams/fastlane.ts): topics without a ranking get a first ranking and entity pages from
// Wikidata while they wait for their team; the team's workflow then deepens them. FASTLANE_WORKERS (default 2).
export async function startFastLaneOnce(){
 const n=Number(process.env.FASTLANE_WORKERS??2);if(!(n>0))return 0;
 const db=await entityDb();const {startFastLane}=await import('./fastlane');return startFastLane(db,n);
}

// Topic counts (rankings, types, pages over each subtree) for the tree pages, every three minutes.
let statsAt=0;
export async function refreshStats(){
 if(Date.now()-statsAt<3*60_000)return 0;statsAt=Date.now();
 const db=await entityDb();const {refreshTopicStats}=await import('@/app/entity-db/pages');
 return refreshTopicStats(db).catch(e=>{console.error('[stats] failed',(e as Error).message);return 0;});
}

// Precomputed pages: rebuild the ranking and entity pages whose data changed, and build the ones never built.
export async function refreshPageData(){
 const db=await entityDb();const {refreshSnapshots}=await import('@/app/entity-db/snapshot-refresh');
 const r=await refreshSnapshots(db).catch(e=>{console.error('[pages] refresh failed',(e as Error).message);return null;});
 if(r&&(r.built||r.failed))console.log('[pages] rebuilt',r.built,'failed',r.failed,'due',r.due);return r;
}

// Entity introductions and pictures from Wikipedia where collectors left them out (a few each minute).
let enriching=false;
export async function enrichEntities(){
 if(enriching)return 0;enriching=true;
 try{
 const db=await entityDb();const {fillIntroductions}=await import('./enrich');
 const n=await fillIntroductions(db,Number(process.env.INTRO_PER_TICK||40)).catch(e=>{console.error('[intro] failed',(e as Error).message);return 0;});
 if(n)console.log('[intro]',n,'entities');return n;
 }finally{enriching=false;}
}
