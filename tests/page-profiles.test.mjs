import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';import {z} from 'zod';
// Routing profiles: what each page covers or does, and the judge that decides reuse from them.
let reply;const D={database:()=>null,api:async()=>({output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(reply)}]}]}),cosine:()=>0};
globalThis.__profiles={z,database:(...a)=>D.database(...a),getPage:async()=>null,model:()=>'m',api:(...a)=>D.api(...a),output:r=>r.output[0].content[0].text,cosine:(...a)=>D.cosine(...a),recordAction:async()=>{}};
const m=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile('const {z,database,getPage,model,api,output,cosine,recordAction}=globalThis.__profiles;\n'+readFileSync('app/routing/profiles.ts','utf8').replace(/^import .*;$/gm,''),{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
test('profiles describe wiki sections and app inputs',()=>{
 const wiki=m.profileText({title:'Nebraska Sandhills',summary:'Grass-stabilized dunes.',body:'## Landscape\ntext\n## Ecology\n### Birds',labels:'{}',dynamic_config:null,kind:'static',category:'Geography'});
 assert.match(wiki,/Nebraska Sandhills\nGrass-stabilized dunes\.\nSections: Landscape; Ecology; Birds\nCategory: Geography/);
 const app=m.profileText({title:'UNL HCC Dashboard',summary:'Submit and monitor Slurm jobs.',body:'',labels:'{}',dynamic_config:JSON.stringify({nativeApp:'hcc',inputFields:[{name:'job',description:'Slurm job ID'}]}),kind:'static',category:''});
 assert.match(app,/Web app \(hcc\)\.\nInputs: job — Slurm job ID/);
});
test('the judge reuses only with no doubt, checks the page when uncertain, and creates otherwise',async()=>{
 const c=[{pageId:'a',title:'A',profile:'A',score:.9,kind:'static'},{pageId:'b',title:'B',profile:'B',score:.8,kind:'dynamic'}];
 reply={candidate:'p2',sameSubject:true,coversScope:true,sameKind:true,hasDoubt:false,confidence:'high',reason:'same'};assert.deepEqual(await m.judgeProfiles('q',c),{pageId:'b',confidence:'high',reason:'same'});
 reply={...reply,hasDoubt:true};assert.equal((await m.judgeProfiles('q',c)).confidence,'uncertain');
 reply={...reply,candidate:'p1',sameSubject:false,confidence:'uncertain'};assert.deepEqual(await m.judgeProfiles('q',c),{pageId:null,confidence:'none',reason:'same'});
 reply={...reply,candidate:null,confidence:'none'};assert.equal((await m.judgeProfiles('q',c)).pageId,null);
 assert.equal((await m.judgeProfiles('q',[])).confidence,'none');
});
test('profiles are built for accessible pages, refreshed when stale, and ranked by meaning',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {SqliteDatabase}=await import('../server/sqlite.mjs');const {migrate}=await import('../scripts/migrate.mjs');
 const dir=await mkdtemp(join(tmpdir(),'profiles-'));
 try{
  const path=join(dir,'db.sqlite');migrate(path);const db=new SqliteDatabase(path);
  const add=(id,owner,vis,title,lang='en')=>db.prepare("INSERT INTO pages(id,owner_id,question,title,summary,body,kind,visibility,language,labels,sources,category,created_at,updated_at) VALUES(?,?,?,?,'about '||?,'','static',?,?,'{}','[]','',?,?)").bind(id,owner,title,title,title,vis,lang,'2026-01-01','2026-01-01').run();
  await add('mine','alice','private','Sandhills');await add('pub','bob','public','Prairie birds');await add('secret','bob','private','Secret');await add('zh','alice','private','沙丘','zh');
  let embedded=0;const vec=t=>Array.from({length:512},(_,i)=>i===0?(/Sandhills/.test(t)?1:0.1):i===1?(/Prairie/.test(t)?1:0.1):0.01);
  Object.assign(D,{database:()=>db,cosine:(a,b)=>{let d=0,x=0,y=0;for(let i=0;i<a.length;i++){d+=a[i]*b[i];x+=a[i]*a[i];y+=b[i]*b[i];}return d/Math.sqrt(x*y);},api:async(path,body)=>{embedded+=body.input.length;return {data:body.input.map((t,index)=>({index,embedding:vec(t)}))};}});
  const query=vec('Sandhills');
  let near=await m.nearestProfiles(query,'en','alice');
  assert.deepEqual(near.map(n=>n.pageId),['mine','pub']);assert.equal(embedded,2);
  near=await m.nearestProfiles(query,'en','alice');assert.equal(embedded,2,'current profiles are not rebuilt');
  await db.prepare("UPDATE pages SET title='Prairie birds of the Sandhills',updated_at='2026-02-01' WHERE id='pub'").run();
  near=await m.nearestProfiles(vec('Prairie'),'en','alice');assert.equal(embedded,3);assert.equal(near[0].pageId,'pub');assert.match(near[0].profile,/Prairie birds of the Sandhills/);
  db.close?.();
 }finally{await rm(dir,{recursive:true,force:true});}
});
