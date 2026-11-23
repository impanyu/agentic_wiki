import type {AgentContext} from '@/app/components-registry/registry';
import type {Queryable} from '@/app/entity-db/client';
import {runEntityTool} from '@/app/entity-db/tools';
import {runDataTool} from '@/app/data-tools';
import {callPublicSource} from '@/app/public-data/service';
import {recordRecipeRun,type Recipe} from './config';
// The crawler: runs a collector's recipe — the same tool calls an agent would make, in order, with no
// model. "$<step id>" in an argument is replaced by that step's dataset id (or the step's value at a
// path: "$src.dataset.datasetId"). Only collection tools may run: public sources, fetching and
// table tools, and loading into the entity database.
export const RECIPE_TOOLS=['call_public_source','fetch_data','extract_tables','query_data','describe_data','crawl_pages','browse_page','extract_fields','entity_upsert','bulk_import','define_metric','compute_metric'] as const;
type Step={id:string;tool:string;args:Record<string,unknown>};
export type StepResult={id:string;tool:string;ok:boolean;ms:number;summary?:unknown;error?:string};

export function parseSteps(raw:unknown):Step[]{
 if(!Array.isArray(raw)||!raw.length)throw Error('steps must be a non-empty list of {id, tool, args}.');
 const ids=new Set<string>();
 return raw.map((s,i)=>{
  const o=s&&typeof s==='object'?s as Record<string,unknown>:{};
  const id=typeof o.id==='string'&&/^[a-z][a-z0-9_]{0,30}$/i.test(o.id)?o.id:'';if(!id)throw Error('Step '+(i+1)+' needs an id (letters, digits, _).');
  if(ids.has(id))throw Error('Duplicate step id '+id+'.');ids.add(id);
  const tool=String(o.tool||'');if(!RECIPE_TOOLS.includes(tool as never))throw Error('Step '+id+': tool must be one of '+RECIPE_TOOLS.join(', ')+'.');
  const args=o.args&&typeof o.args==='object'&&!Array.isArray(o.args)?o.args as Record<string,unknown>:{};
  return {id,tool,args};
 });
}
// A recipe must be complete: every fetched dataset is used by a later step (cleaned, joined or loaded), and the
// recipe ends by loading into the entity database. Otherwise it would fetch data that never reaches readers.
const FETCHERS=['call_public_source','fetch_data','extract_tables','crawl_pages','browse_page','extract_fields','query_data'];
export function checkRecipe(steps:Step[]):string[]{
 const problems:string[]=[];
 const refs=(v:unknown,out:Set<string>)=>{if(typeof v==='string'){for(const m of v.matchAll(/\$([a-z][a-z0-9_]*)/gi))out.add(m[1]);}
  else if(Array.isArray(v))v.forEach(x=>refs(x,out));else if(v&&typeof v==='object')Object.values(v).forEach(x=>refs(x,out));return out;};
 steps.forEach((s,i)=>{if(!FETCHERS.includes(s.tool))return;
  const used=steps.slice(i+1).some(t=>refs(t.args,new Set()).has(s.id));
  if(!used)problems.push('Step "'+s.id+'" ('+s.tool+') fetches data that no later step uses: load it (entity_upsert with datasetId "$'+s.id+'") or join it into a step that is loaded.');});
 if(!steps.some(s=>s.tool==='entity_upsert'||s.tool==='bulk_import'||s.tool==='compute_metric'))problems.push('The recipe never loads anything: end with entity_upsert.');
 return problems;
}
const datasetOf=(v:unknown):string|undefined=>{
 if(!v||typeof v!=='object')return undefined;const o=v as Record<string,unknown>;
 if(typeof o.datasetId==='string')return o.datasetId;
 const d=o.dataset as Record<string,unknown>|undefined;if(d&&typeof d.datasetId==='string')return d.datasetId;
 return undefined;
};
function resolveArgs(v:unknown,out:Map<string,unknown>):unknown{
 if(typeof v==='string'){const m=/^\$([a-z][a-z0-9_]*)((?:\.[A-Za-z0-9_]+)*)$/i.exec(v.trim());if(!m)return v;
  const prior=out.get(m[1]);if(prior===undefined)throw Error('No earlier step "'+m[1]+'".');
  if(!m[2])return datasetOf(prior)??(()=>{throw Error('Step '+m[1]+' returned no dataset.');})();
  return m[2].slice(1).split('.').reduce<unknown>((o,k)=>o&&typeof o==='object'?(o as Record<string,unknown>)[k]:undefined,prior);}
 if(Array.isArray(v))return v.map(x=>resolveArgs(x,out));
 if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,resolveArgs(x,out)]));
 return v;
}
// Compact summary of a step's result for logs and the agent (counts, columns, errors; never rows).
function summary(tool:string,data:unknown):unknown{
 if(!data||typeof data!=='object')return data;const o=data as Record<string,unknown>;
 if(tool==='bulk_import'){const {files,scanned,admitted,loaded,inserted,merged,observations,cutoffs,partial,done}=o;return {files,scanned,admitted,rows:loaded,inserted,merged,observations,cutoffs,partial,done};}
 if(tool==='entity_upsert'){const {rows,inserted,merged,skipped,observations,relations,unresolved,idConflicts,errors,units}=o;return {rows,inserted,merged,skipped,observations,relations,unresolved,idConflicts,errors,units};}
 const d=(o.dataset as Record<string,unknown>)||o;
 if(tool==='extract_fields')return {datasetId:datasetOf(o),rowCount:o.rowCount,pages:o.pages,fillRates:o.fillRates,errors:o.errors};
 return {datasetId:datasetOf(o),rowCount:d.rowCount??o.rowCount,columns:Array.isArray(d.columns)?(d.columns as {name:string}[]).map(c=>c.name??c).slice(0,30):undefined,note:typeof o.note==='string'?undefined:o.note,title:d.title??o.title};
}
export async function runSteps(stepsRaw:unknown,ctx:AgentContext,signal?:AbortSignal):Promise<{ok:boolean;steps:StepResult[]}>{
 const steps=parseSteps(stepsRaw),out=new Map<string,unknown>(),results:StepResult[]=[];
 for(const s of steps){
  signal?.throwIfAborted();const t0=Date.now();
  try{
   const args=resolveArgs(s.args,out) as Record<string,unknown>;let data:unknown;
   if(s.tool==='call_public_source'){
    const source=String(args.source??args.sourceId??''),tool=String(args.action??args.tool??'');
    const params=args.params??args.arguments??(typeof args.argumentsJson==='string'?JSON.parse(args.argumentsJson):{});
    data=await callPublicSource(source,tool,params,ctx,signal);
   }else if(s.tool==='entity_upsert'||s.tool==='bulk_import'||s.tool==='define_metric'||s.tool==='compute_metric'){
    // Entity tools take every argument; missing ones mean "not given".
    const defaults:Record<string,Record<string,unknown>>={
     entity_upsert:{idColumns:'',aliasColumns:'',descriptionColumn:'',attributeColumns:'',metricColumns:'',relationColumns:'',source:'',topicId:''},
     bulk_import:{url:'',indexUrl:'',indexPattern:'',commentPrefix:'',fields:'',where:'',keepTop:'',maxRows:0,idColumns:'',aliasColumns:'',descriptionColumn:'',attributeColumns:'',metricColumns:'',relationColumns:'',source:'',topicId:''},
     define_metric:{label:'',unit:'',description:'',methodology:'',order:'',format:'',definition:''},compute_metric:{version:0}};
    const norm=Object.fromEntries(Object.entries({...defaults[s.tool],...args}).map(([k,v])=>[k,v&&typeof v==='object'?JSON.stringify(v):v]));
    data=(await runEntityTool(s.tool,norm,ctx,signal)).data;
   }else data=(await runDataTool(s.tool,Object.fromEntries(Object.entries(args).map(([k,v])=>[k,v&&typeof v==='object'?JSON.stringify(v):v])),ctx,signal)).data;
   out.set(s.id,data);results.push({id:s.id,tool:s.tool,ok:true,ms:Date.now()-t0,summary:summary(s.tool,data)});
  }catch(e){results.push({id:s.id,tool:s.tool,ok:false,ms:Date.now()-t0,error:(e as Error).message.slice(0,1000)});return {ok:false,steps:results};}
 }
 return {ok:true,steps:results};
}
export const crawlerContext=(recipe:{type:string;name:string}):AgentContext=>({userId:'rankwiki-crawler',ownerId:'rankwiki-crawler',language:'en',visibility:'public',agent:{id:'crawler:'+recipe.type+':'+recipe.name}} as unknown as AgentContext);
// A run that still works but returns far less than last time means the source changed: rows down by half or
// more, or a field that used to be filled now mostly empty. It counts as a failure so the collector repairs it.
type Summ={rowCount?:number;fillRates?:Record<string,number>;rows?:number;observations?:number};
export function driftOf(prev:StepResult[]|undefined,now:StepResult[]):string[]{
 const out:string[]=[];if(!prev)return out;
 for(const s of now){const p=prev.find(x=>x.id===s.id&&x.ok);if(!p||!s.ok)continue;const a=p.summary as Summ||{},b=s.summary as Summ||{};
  const before=a.rowCount??a.rows,after=b.rowCount??b.rows;
  if(typeof before==='number'&&typeof after==='number'&&before>=20&&after<before*0.5)out.push('Step '+s.id+': '+after+' rows, '+before+' last time.');
  if(a.fillRates&&b.fillRates)for(const [f,r] of Object.entries(a.fillRates)){const n=b.fillRates[f]??0;if(r>=50&&n<r-40)out.push('Step '+s.id+': field "'+f+'" filled on '+n+'% of pages, '+r+'% last time.');}
  if(typeof a.observations==='number'&&typeof b.observations==='number'&&a.observations>=100&&b.observations<a.observations*0.5)out.push('Step '+s.id+': '+b.observations+' values loaded, '+a.observations+' last time.');
 }
 return out;
}
// A bulk source is loaded over several runs: while a bulk_import step is partial the recipe stays due (the next
// heartbeat continues it), and drift is only judged on complete runs.
export const isPartial=(steps:StepResult[])=>steps.some(s=>s.tool==='bulk_import'&&(s.summary as {partial?:boolean}|undefined)?.partial);
export async function runRecipe(db:Queryable,recipe:Recipe,signal?:AbortSignal){
 const run=await runSteps(recipe.steps,crawlerContext(recipe),signal);
 const partial=run.ok&&isPartial(run.steps);
 const drift=run.ok&&!partial?driftOf((recipe.lastResult as {steps?:StepResult[]}|null)?.steps,run.steps):[];
 const result={...run,ok:run.ok&&!drift.length,...(drift.length?{drift}:{}),...(partial?{partial:true}:{})};
 // A partial run keeps the last complete result for drift checks and leaves the recipe due.
 if(partial){await db.query("update recipes set last_run_at=null, status='active', updated_at=now() where id=$1::uuid",[recipe.id]);return result;}
 await recordRecipeRun(db,recipe.id,result.ok,result);
 return result;
}
