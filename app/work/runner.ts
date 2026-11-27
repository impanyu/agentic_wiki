import {entityDb,type Queryable} from '@/app/entity-db/client';
import {claim,enqueue,finish,renew,type Pool,type Task} from './queue';
import {KINDS,MAY_REQUEST,classInfo,pageInfo} from './kinds';
// The pools: each takes the next task of its kind of work, by priority, as long as it has free workers
// (WORK_POOLS="collector:2,editor:1,reviewer:1,manager:1"). A task runs one agent call with the kind's instructions and
// tools; it is done only when the kind's acceptance check passes. What the agent asks of other pools (requests) and
// what the kind says follows (next) become new tasks. A model outage puts the task back in the queue.
type Row=Record<string,unknown>;
const running=new Map<string,Pool>();
const RESULT={type:'object',additionalProperties:false,required:['summary','requests','verdict'],properties:{
 summary:{type:'string'},
 requests:{type:'array',items:{type:'object',additionalProperties:false,required:['kind','target','why','details'],properties:{kind:{type:'string'},target:{type:'string'},why:{type:'string'},details:{type:'string'}}}},
 verdict:{type:'object',additionalProperties:false,required:['approved','issues'],properties:{approved:{type:'boolean'},
  issues:{type:'array',items:{type:'object',additionalProperties:false,required:['owner','target','problem','fix'],properties:{owner:{type:'string',enum:['editor','collector']},target:{type:'string'},problem:{type:'string'},fix:{type:'string'}}}}}}}};
const sizes=():Record<Pool,number>=>{const out:Record<Pool,number>={collector:2,editor:1,reviewer:1,manager:1};
 for(const p of String(process.env.WORK_POOLS||'').split(',')){const [k,v]=p.split(':');if(k in out&&Number.isFinite(Number(v)))out[k as Pool]=Math.max(0,Number(v));}return out;};

export async function runWork(log:(e:Row)=>void=e=>console.log('[work]',JSON.stringify(e))):Promise<string[]>{
 const db=await entityDb();await renew(db,[...running.keys()]);
 // Tasks whose holder stopped renewing go back to the queue (a crash or restart); after 3 attempts the manager rules.
 const lost=(await db.query<{id:string;kind:string;target:string;attempts:number}>(`update work_tasks set status='queued', worker=null where status='running' and lease_until < now() and not (id = any($1::uuid[])) returning id, kind, target, attempts`,[[...running.keys()]])).rows;
 for(const l of lost)if(l.attempts>=3){await finish(db,l.id,'failed',{error:'interrupted 3 times'});await enqueue(db,{kind:'arbitrate',pool:'manager',target:'task:'+l.id,priority:60,payload:{why:'stuck',task:l}});}
 const started:string[]=[];const size=sizes();
 for(const pool of Object.keys(size) as Pool[]){
  while([...running.values()].filter(p=>p===pool).length<size[pool]){
   const t=await claim(db,pool);if(!t)break;
   running.set(t.id,pool);started.push(t.kind+':'+t.target);
   void runTask(db,t,log).catch(e=>log({event:'task_crashed',id:t.id,error:String((e as Error).message).slice(0,300)})).finally(()=>running.delete(t.id));
  }
 }
 return started;
}

async function runTask(db:Queryable,t:Task,log:(e:Row)=>void){
 const def=KINDS[t.kind];if(!def){await finish(db,t.id,'failed',{error:'unknown kind'});return;}
 const {RULES,COLLECTOR,EDITOR_BUILD,REVIEWER,MANAGER}=await import('@/app/teams/charter');
 const base={collector:COLLECTOR,editor:EDITOR_BUILD,reviewer:REVIEWER,manager:MANAGER}[def.pool];
 // The target's context, and the page the tools work on.
 const cls=t.target.startsWith('class:')?t.target.slice(6):def.target==='class'?t.target:'';
 const klass=cls?await classInfo(db,cls):null;
 const pageSlug=t.target.startsWith('inbox:')?t.target.slice(6):def.target==='page'&&!t.target.startsWith('class:')?t.target:'';
 const page=pageSlug?await pageInfo(db,pageSlug):null;
 const general=(await db.query<{id:string}>(`select id from topics where slug='general'`)).rows[0]?.id||'';
 const topicId=page?.topicId||klass?.topicId||general;
 const task={kind:t.kind,title:def.title,target:t.target,payload:t.payload,...(klass?{class:klass}:{}),...(page?{page}:{}),
  mayRequest:MAY_REQUEST[def.pool].map(k=>({kind:k,what:KINDS[k]?.title}))};
 const instructions=RULES+'\n\n'+base+'\n\n'+def.instructions+'\nReturn: summary (what you did and what remains), requests (work for other pools, each {kind, target, why, details}; only kinds in task.mayRequest; target = a class key or a page slug), verdict (reviewers: your judgement; others: approved true, no issues).';
 const {spawnAgent}=await import('@/app/agents/runtime');const {ask,OWNER}=await import('@/app/teams/agent-call');
 const agent=await spawnAgent('work-'+def.pool,OWNER);
 log({event:'task_started',id:t.id,kind:t.kind,target:t.target});
 let result:Row;
 try{
  result=await ask(def.pool,agent,topicId,instructions,task,RESULT,e=>log({task:t.id,...e}),def.budget,def.gate?async()=>def.gate!(db,t):undefined) as Row;
 }catch(e){
  const {transientModelError}=await import('@/app/teams/run');
  if(transientModelError(e)){await finish(db,t.id,'queued',{requeued:String((e as Error).message).slice(0,200)});return;}
  await finish(db,t.id,'failed',{error:String((e as Error).message).slice(0,1000)});
  if(t.attempts>=2)await enqueue(db,{kind:'arbitrate',pool:'manager',target:'task:'+t.id,priority:60,payload:{why:'failed repeatedly',task:{kind:t.kind,target:t.target},error:String((e as Error).message).slice(0,500)}});
  else await enqueue(db,{kind:t.kind,pool:def.pool,target:t.target,priority:t.priority,payload:{...t.payload,previousError:String((e as Error).message).slice(0,500)},requestedBy:'retry'});
  log({event:'task_failed',id:t.id,kind:t.kind,target:t.target});
  return;
 }
 // Requests to other pools (only what this pool may ask), at most 8.
 for(const r of ((result.requests as Row[])||[]).slice(0,8)){
  const k=String(r.kind),target=String(r.target||'').trim();
  if(!MAY_REQUEST[def.pool].includes(k)||!KINDS[k]||!target)continue;
  await enqueue(db,{kind:k,pool:KINDS[k].pool,target,priority:t.priority,parentId:t.id,requestedBy:def.pool+':'+t.kind,payload:{why:String(r.why||''),details:String(r.details||''),fromTask:t.id,...(def.pool==='editor'&&page?{page:page.slug}:{})}});
 }
 let status:'done'|'returned'='done';
 // A review: approved pages go to readers; issues go to their owners; a page returned three times goes to the manager.
 if(def.pool==='reviewer'&&page){
  const v=(result.verdict as {approved:boolean;issues:{owner:string;target:string;problem:string;fix:string}[]})||{approved:true,issues:[]};
  if(v.approved){await db.query(`update rankings set status='published', updated_at=now() where topic_id=$1::uuid and status in ('draft','held')`,[page.topicId]);}
  else{
   status='returned';
   const mine=v.issues.filter(i=>i.owner==='editor');if(mine.length)await enqueue(db,{kind:'page_fix',pool:'editor',target:page.slug,priority:t.priority,parentId:t.id,requestedBy:'reviewer',payload:{issues:mine}});
   for(const i of v.issues.filter(x=>x.owner==='collector'))await enqueue(db,{kind:'data_verify',pool:'collector',target:i.target||String((page.shows as Row|null)?.class||''),priority:t.priority,parentId:t.id,requestedBy:'reviewer',payload:{issue:i,page:page.slug}});
   const returns=Number((await db.query<{n:number}>(`select count(*)::int n from work_tasks where kind='page_review' and target=$1 and status='returned' and finished_at > now() - interval '14 days'`,[page.slug])).rows[0]?.n||0);
   if(returns>=2)await enqueue(db,{kind:'arbitrate',pool:'manager',target:'page:'+page.slug,priority:t.priority+10,payload:{why:'returned 3 times',issues:v.issues}});
  }
 }
 // A check on trial: confirmed → it runs site-wide; rejected → retired.
 if(t.kind==='check_trial'&&t.target.startsWith('check:')){
  const v=(result.verdict as {approved:boolean;issues:unknown[]})||{approved:false,issues:[]};
  await db.query(`update checks set status=$2 where id=$1 and status='trial'`,[t.target.slice(6),v.approved?'active':'retired']);
  if(!v.approved)status='returned';
 }
 await finish(db,t.id,status,result);
 if(status==='done')for(const n of def.next?await def.next(db,t,result):[])await enqueue(db,{kind:n.kind,pool:KINDS[n.kind].pool,target:n.target,priority:n.priority??t.priority,payload:n.payload||{},parentId:t.id,requestedBy:'next:'+t.kind});
 log({event:'task_finished',id:t.id,kind:t.kind,target:t.target,status});
}
