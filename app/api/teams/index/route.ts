import {teamAuthorized} from '@/app/teams/auth';
import {entityDb} from '@/app/entity-db/client';
// The tree as the index, for operators (TEAM_ADMIN_TOKEN): {action:"split", slugs:[…]} judges those nodes' splits again;
// {action:"convert", slugs:[…]} turns view subtopics with entities of their own into queries of their parents;
// {action:"place"} places entities; {action:"show", slug} returns a node's index.
export const dynamic='force-dynamic';
export async function POST(request:Request){
 if(!teamAuthorized(request))return Response.json({error:'Not allowed.'},{status:403});
 const b=await request.json().catch(()=>({})) as {action?:string;slugs?:string[];slug?:string};
 const db=await entityDb();const log:Record<string,unknown>[]=[];
 try{
  if(b.action==='split'){
   const slugs=(b.slugs||[]).map(String).slice(0,40);
   await db.query(`update topics set scope=scope-'split' where slug = any($1::text[])`,[slugs]);
   const {splitSweep}=await import('@/app/teams/trunk');
   const r=await splitSweep(db,slugs.length,e=>log.push(e),slugs);
   return Response.json({...r,log});
  }
  if(b.action==='convert'){
   const {convertView}=await import('@/app/teams/trunk');const out:Record<string,unknown>={};
   for(const s of (b.slugs||[]).map(String).slice(0,40))out[s]=await convertView(db,s).catch(e=>({ok:false,reason:(e as Error).message}));
   return Response.json(out);
  }
  if(b.action==='import'){
   // The initialised class tree, from a file on this machine ({path, dryRun}).
   const {readFile}=await import('node:fs/promises');const path=String((b as {path?:string}).path||'');
   if(!/^\/home\/[a-z]+\/[a-z0-9_.-]+\.json$/.test(path))return Response.json({error:'path: /home/<user>/<file>.json'},{status:400});
   const spec=JSON.parse(await readFile(path,'utf8'));const {importClassTree}=await import('@/app/entity-db/class-tree');
   const dryRun=(b as {dryRun?:boolean}).dryRun!==false;
   if(dryRun)return Response.json(await importClassTree(db,spec,{dryRun,log:e=>{if(log.length<400)log.push(e);}}).then(r=>({...r,log})));
   // The migration runs for a while: started here, followed in the log ([class-tree] lines).
   void importClassTree(db,spec,{}).catch(e=>console.error('[class-tree] failed',(e as Error).message));
   return Response.json({started:true});
  }
  if(b.action==='audit'){const {classGaps}=await import('@/app/work/audit');return Response.json(await classGaps(db));}
  if(b.action==='enqueue'){
   // Operator-created work: [{kind, target, priority, payload}].
   const {enqueue}=await import('@/app/work/queue');const {KINDS}=await import('@/app/work/kinds');const made:string[]=[];
   for(const t of ((b as {tasks?:{kind:string;target:string;priority?:number;payload?:Record<string,unknown>}[]}).tasks||[]).slice(0,5000)){
    const k=KINDS[t.kind];if(!k||!t.target)continue;const r=await enqueue(db,{kind:t.kind,pool:k.pool,target:t.target,priority:t.priority,payload:t.payload,requestedBy:'operator'});if(r.created)made.push(t.kind+':'+t.target);}
   return Response.json({created:made.length,made:made.slice(0,50)});
  }
  if(b.action==='checks'){const {syncBuiltins}=await import('@/app/work/checks');await syncBuiltins(db);
   const c=b as {id?:string;status?:string};if(c.id&&c.status&&['active','paused','retired','trial'].includes(c.status))await db.query('update checks set status=$2 where id=$1',[c.id,c.status]);
   return Response.json((await db.query('select id, object, kind, status, created_by, severity, last_run, last_count, last_error, title from checks order by status, id')).rows);}
  // Country rankings now (otherwise hourly), and ranking pages rebuilt now ({slugs} or {type}: every ranking of it).
  // Duplicates merged ({pairs:[[keepId, dropId]]}): facts, relations, ids and aliases move to the kept entity.
  if(b.action==='merge'){const {mergeEntities}=await import('@/app/entity-db/dedup');const pairs=((b as {pairs?:string[][]}).pairs||[]).slice(0,2000);let n=0;const failed:string[]=[];
   for(const [k,d] of pairs){try{await mergeEntities(db,k,d);n++;}catch(e){failed.push(d+': '+(e as Error).message);}}
   return Response.json({merged:n,failed:failed.slice(0,20)});}
  if(b.action==='progress'){const {refreshClassProgress}=await import('@/app/work/progress');return Response.json({classes:await refreshClassProgress(db,{limit:Number((b as {limit?:number}).limit)||400})});}
  if(b.action==='subsets'){const cs=await import('@/app/entity-db/country-subsets');await cs.normalizeCountries(db);return Response.json(await cs.countrySubsets(db));}
  // A type's member pages and ranks rebuilt now ({entityType}): values, ranks within the type, every member page.
  if(b.action==='rebuild'&&(b as {entityType?:string}).entityType){const t=String((b as {entityType?:string}).entityType);
   const {rerankType}=await import('@/app/entity-db/repo');const {loadEntityPageByNum}=await import('@/app/entity-db/pages');const rr=await rerankType(db,t);
   const nums=(await db.query<{num:string}>(`select num::text num from entities where type=$1::text and has_page limit 5000`,[t])).rows.map(x=>x.num);let pages=0;
   for(const n of nums){try{if(await loadEntityPageByNum(db,n,{fresh:true}))pages++;}catch{}}
   return Response.json({...rr,pages});}
  if(b.action==='rebuild'){const r=b as {slugs?:string[];type?:string};const {loadRankingPage}=await import('@/app/entity-db/pages');
   const slugs=r.slugs?.length?r.slugs.slice(0,200):r.type?(await db.query<{slug:string}>(`select slug from rankings where slug is not null and status='published' and scope->>'type'=$1::text limit 300`,[r.type])).rows.map(x=>x.slug):[];
   const done:string[]=[],failed:string[]=[];for(const s of slugs){try{await loadRankingPage(db,s,{fresh:true});done.push(s);}catch(e){failed.push(s+': '+(e as Error).message);}}
   return Response.json({done:done.length,failed});}
  if(b.action==='recipe'){
   // An operator's recipe ({type, name, description, steps, run}): saved like a collector's; run=true runs it now in
   // the background, again while the source is only partly loaded (bulk files load over several runs).
   const r=b as {type?:string;name?:string;description?:string;steps?:Record<string,unknown>[];run?:boolean};
   const {saveRecipe}=await import('@/app/teams/config');const {runRecipe,checkRecipe,parseSteps}=await import('@/app/teams/recipes');
   const problems=checkRecipe(parseSteps(r.steps));if(problems.length)return Response.json({error:problems.join(' ')},{status:400});
   const rec=await saveRecipe(db,{type:String(r.type),name:String(r.name),description:String(r.description||''),steps:r.steps||[],createdBy:'operator'});
   if(r.run)void (async()=>{for(let i=0;i<30;i++){const x=await runRecipe(db,rec).catch(e=>({ok:false,error:String((e as Error).message)}) as Record<string,unknown>);
    console.log('[operator-recipe]',rec.type,rec.name,JSON.stringify(x).slice(0,1500));if(!(x as {partial?:boolean}).partial)break;}})();
   return Response.json({saved:rec.name,type:rec.type,running:!!r.run});
  }
  if(b.action==='sitemap'){
   // The initialised site map, from a file on this machine ({path, dryRun}); a real run continues in the background.
   const {readFile}=await import('node:fs/promises');const path=String((b as {path?:string}).path||'');
   if(!/^\/home\/[a-z]+\/[a-z0-9_.-]+\.json$/.test(path))return Response.json({error:'path: /home/<user>/<file>.json'},{status:400});
   const spec=JSON.parse(await readFile(path,'utf8'));const {importSiteMap}=await import('@/app/entity-db/site-map');
   if((b as {dryRun?:boolean}).dryRun!==false)return Response.json(await importSiteMap(db,spec,{dryRun:true}));
   void importSiteMap(db,spec,{dryRun:false,log:e=>console.log('[site-map]',JSON.stringify(e))}).then(r=>console.log('[site-map]',JSON.stringify({event:'done',...r,problems:r.problems.slice(0,50)}))).catch(e=>console.error('[site-map] failed',(e as Error).message));
   return Response.json({started:true});
  }
  if(b.action==='classspecs'){
   // The researched class specifications (member sources and fields per class), from a file on this machine ({path, dryRun}).
   const {readFile}=await import('node:fs/promises');const path=String((b as {path?:string}).path||'');
   if(!/^\/home\/[a-z]+\/[a-z0-9_.-]+\.json$/.test(path))return Response.json({error:'path: /home/<user>/<file>.json'},{status:400});
   const {importClassSpecs}=await import('@/app/entity-db/class-specs');
   return Response.json(await importClassSpecs(db,JSON.parse(await readFile(path,'utf8')),{dryRun:(b as {dryRun?:boolean}).dryRun!==false}));
  }
  if(b.action==='site_search'){const r=b as {site?:string;query?:string;count?:number};const {siteSearch}=await import('@/app/search/site-index');return Response.json(await siteSearch(db,String(r.site||''),String(r.query||''),Number(r.count)||10));}
  if(b.action==='tool'){
   // An entity tool as the crawler runs it ({name, args}): define_metric, compute_metric, metric_table, entity_get…
   const r=b as {name?:string;args?:Record<string,unknown>};const {runEntityTool}=await import('@/app/entity-db/tools');const {crawlerContext}=await import('@/app/teams/recipes');
   return Response.json(await runEntityTool(String(r.name),r.args||{},crawlerContext({type:'operator',name:'tool'})));
  }
  if(b.action==='queue'){const {queueState}=await import('@/app/work/queue');return Response.json(await queueState(db));}
  if(b.action==='place'){const {placeEntities}=await import('@/app/entity-db/tree-index');return Response.json(await placeEntities(db));}
  if(b.action==='show'&&b.slug){const t=(await db.query<{id:string}>('select id from topics where slug=$1::text',[b.slug])).rows[0];if(!t)return Response.json({error:'no such node'},{status:404});
   const {nodeIndex}=await import('@/app/entity-db/tree-index');return Response.json(await nodeIndex(db,t.id));}
  return Response.json({error:'action: split | convert | place | show'},{status:400});
 }catch(e){return Response.json({error:(e as Error).message,log},{status:500});}
}
