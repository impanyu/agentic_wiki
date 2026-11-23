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
export async function runDueRecipes(limit=Math.max(1,Number(process.env.CRAWLER_CONCURRENCY||3))){
 if(running)return {ran:0};running=true;
 try{
  // A long bulk load continuing over many ticks takes turns with the other due recipes.
  const db=await entityDb();const ready=(await listRecipes(db)).filter(r=>due(r)&&!active.has(r.id)).sort((a,b)=>Number(a.id===lastRan)-Number(b.id===lastRan));let ran=0;
  for(const r of ready.slice(0,Math.max(0,limit-active.size))){
   lastRan=r.id;active.add(r.id);ran++;
   void runOne(db,r).finally(()=>active.delete(r.id));
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
 // At most hourly: teams return to topics that need them.
 const now=Date.now();if(now-lastMaintenance>3600_000){lastMaintenance=now;const {scheduleMaintenance}=await import('./manager');const q=await scheduleMaintenance(db).catch(e=>{console.error('[queue] maintenance failed',(e as Error).message);return [];});if(q.length)console.log('[queue] queued',q.join(', '));}
 const started=await runTeamQueue(async()=>(await llmSpend()).spentUsd,(slug,e)=>console.log('[team:'+slug+']',JSON.stringify(e)));
 if(started.length)console.log('[queue] started',started.join(', '));
}

// Recomputes every published derived metric (an editor's index) whose scope is this entity type.
export async function recomputeIndices(type:string):Promise<string[]>{
 const {computeDerivedMetric}=await import('@/app/entity-db/repo');
 const db=await entityDb();
 const rows=(await db.query<{key:string;version:number}>(`select distinct on (key) key, version from metrics where kind = 'derived' and status = 'published'
  and definition->'scope'->>'type' = $1::text order by key, version desc`,[type])).rows;
 const done:string[]=[];
 for(const m of rows){try{await computeDerivedMetric(db,m.key,m.version);done.push(m.key);}catch(e){console.warn('index',m.key,(e as Error).message);}}
 if(done.length)console.log('[crawler] recomputed indices',type,done.join(', '));
 return done;
}
