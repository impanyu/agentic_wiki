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
  if(b.action==='place'){const {placeEntities}=await import('@/app/entity-db/tree-index');return Response.json(await placeEntities(db));}
  if(b.action==='show'&&b.slug){const t=(await db.query<{id:string}>('select id from topics where slug=$1::text',[b.slug])).rows[0];if(!t)return Response.json({error:'no such node'},{status:404});
   const {nodeIndex}=await import('@/app/entity-db/tree-index');return Response.json(await nodeIndex(db,t.id));}
  return Response.json({error:'action: split | convert | place | show'},{status:400});
 }catch(e){return Response.json({error:(e as Error).message,log},{status:500});}
}
