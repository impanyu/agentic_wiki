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
let running=false;
export async function runDueRecipes(limit=1){
 if(running)return {ran:0};running=true;
 try{
  const db=await entityDb();const ready=(await listRecipes(db)).filter(r=>due(r));let ran=0;
  for(const r of ready.slice(0,limit)){
   const result=await runRecipe(db,r).catch(e=>({ok:false,steps:[],error:(e as Error).message}));ran++;
   if(!result.ok)await reportFailure(r,result).catch(e=>console.error('crawler: report failed',(e as Error).message));
   console.log('[crawler]',r.type+'/'+r.name,result.ok?'ok':'failed');
  }
  return {ran};
 }finally{running=false;}
}
async function reportFailure(r:Recipe,result:{steps?:{id:string;ok:boolean;error?:string}[];drift?:string[];error?:string}){
 const db=await entityDb();const t=await getEntityType(db,r.type);const editorId=await topicEditorId(db,t?.topicId??null);if(!editorId)return;
 const title='Repair recipe '+r.type+'/'+r.name;
 if((await listRoadmap(db,editorId)).some(i=>i.title===title&&(i.status==='pending'||i.status==='running')))return;
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
