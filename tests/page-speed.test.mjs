import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import ts from 'typescript';import {z} from 'zod';import {migrate} from '../scripts/migrate.mjs';import {SqliteDatabase} from '../server/sqlite.mjs';
const strip=p=>readFileSync(p,'utf8').replace(/^import .*;$/gm,'');
const load=s=>import('data:text/javascript;base64,'+Buffer.from(ts.transpile(s,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
const {partialJsonString}=await load(strip('app/chat/partial-json.ts'));
test('nested streaming decodes partial article text without exposing nested code or broken escapes',()=>{
 const body='Hello "world"\n你好 😀';const inner=JSON.stringify({kind:'article',title:'Topic',summary:'A summary',body}),outer=JSON.stringify({draftJson:inner});
 assert.equal(partialJsonString(partialJsonString(outer,'draftJson'),'body'),body);
 let observed='';
 for(let i=1;i<=outer.length;i++){const json=partialJsonString(outer.slice(0,i),'draftJson');const text=json&&partialJsonString(json,'body');if(text!==undefined){assert.ok(body.startsWith(text));observed=text;}}
 assert.equal(observed,body);
 assert.equal(partialJsonString('{"code":{"body":"secret"},"body":"Visible','body'),'Visible');
 assert.equal(partialJsonString('{"other":"body","value":"hidden"}','body'),undefined);
});
test('deferred reads return the saved app without executing its backend',async()=>{
 let calls=0;const page={id:'p',kind:'dynamic',dynamic:{template:'page-program-v1'},parameters:{}};
 const {deferPageExecution,registeredAdmaPage}=await load(strip('app/page-programs/deferred.ts'));
 globalThis.deferDeps={parametersSchema:z.record(z.union([z.string(),z.number(),z.boolean()])),programNavigationInput:p=>({values:p}),deferPageExecution,registeredAdmaPage,executePage:async p=>{calls++;return {...p,view:{}};},getActor:async()=>({userId:'u',finish:r=>r}),getPage:async()=>page,reply:(data,status=200)=>Response.json(data,{status})};
 const code=strip('app/api/pages/[id]/route.ts').split('export async function PATCH')[0];
 const m=await load('const {'+Object.keys(globalThis.deferDeps).join(',')+'}=globalThis.deferDeps;'+code);
 const response=await m.GET(new Request('https://wiki.test/api/pages/p?defer=1'),{params:Promise.resolve({id:'p'})});
 assert.equal((await response.json()).page.runtimePending,true);assert.equal(calls,0);
 await m.GET(new Request('https://wiki.test/api/pages/p'),{params:Promise.resolve({id:'p'})});assert.equal(calls,1);delete globalThis.deferDeps;
});
test('a streamed tool draft is previewed and finalized by reference without a second body',async()=>{
 let finalized=false;const events=[],draft={kind:'article',title:'Topic',summary:'Summary',body:'Visible before finalization',labels:{overview:'Overview'},intent:{}};
 globalThis.draftSpeed={partialJsonString,indexGenerationPolicy:async()=>({leafRequired:false,validate:()=>{}}),spawnAgent:async()=>({id:'g'}),generationInstructions:'',output:r=>r.text,recordAction:async()=>{},validateGenerationDraft:d=>{if(!d)throw Error('Missing');return d;},materializeGenerationDraft:async d=>{assert.ok(finalized);return {answer:d,templateId:'wiki-v1'};},askAgent:async(a,i,t,s,signal,onReply,files,options)=>{
  options.onToolArguments('validate_page_draft',JSON.stringify({draftJson:JSON.stringify(draft)}));
  assert.ok(events.some(e=>e.type==='replace'&&e.text===draft.body));
  assert.match(await options.validateFinal({text:'{"draftJson":"draft:foreign"}'},{webSearched:true}),/Unknown draft/);
  const validation=await options.executeExtra('validate_page_draft',{draftJson:JSON.stringify(draft)});
  assert.ok(validation.data.draftRef.startsWith('draft:'));
  assert.equal(await options.validateFinal({text:JSON.stringify({draftJson:validation.data.draftRef})},{webSearched:true}),undefined);finalized=true;
 }};
 const m=await load('const {'+Object.keys(globalThis.draftSpeed).join(',')+'}=globalThis.draftSpeed;'+strip('app/page-programs/generate-context.ts'));
 await m.generateContext({question:'Topic'},{userId:'u',ownerId:'u',language:'en'}, {},e=>events.push(e),new AbortController().signal);delete globalThis.draftSpeed;
});
test('Responses function-argument deltas reach the draft preview callback',async()=>{
 const seen=[];globalThis.streamSpeed={reasoningOptions:()=>({}),aiKey:()=> 'test',fetch:async()=>({ok:true,body:{}}),readEvents:async function*(){
  yield {type:'response.output_item.added',item:{id:'tool1',type:'function_call',name:'validate_page_draft',arguments:''}};
  yield {type:'response.function_call_arguments.delta',item_id:'tool1',delta:'{"draftJson":'};
  yield {type:'response.function_call_arguments.delta',item_id:'tool1',delta:'"draft text"}'};
  yield {type:'response.completed',response:{output:[]}};
 }};
 const source=strip('app/api/ask/ai.ts');const part=source.slice(source.indexOf('export async function streamArticle'),source.indexOf('export function output'));
 const m=await load('const {'+Object.keys(globalThis.streamSpeed).join(',')+'}=globalThis.streamSpeed;'+part);
 await m.streamArticle({},()=>{},undefined,(name,text)=>seen.push({name,text}));
 assert.deepEqual(seen.at(-1),{name:'validate_page_draft',text:'{"draftJson":"draft text"}'});delete globalThis.streamSpeed;
});

test('exact saved question fast path uses real SQL permissions, freshness, and mapping version',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'wiki-exact-')),path=join(dir,'test.sqlite');migrate(path);const db=new SqliteDatabase(path);
 const page={id:'p',question:'Photosynthesis',kind:'static',labels:{},owned:true,createdAt:new Date().toISOString()};
 globalThis.exactDeps={database:()=>db,getPage:async()=>page,normalize:s=>s.trim().toLowerCase(),repairKnownMappings:async()=>{},MATCH_VERSION:5,needsReview:()=>false,storagePageMismatch:()=>false,requireValidIndex:async()=>{},deferPageExecution:p=>({...p,runtimePending:true}),parametersSchema:z.record(z.union([z.string(),z.number(),z.boolean()]))};
 try{
  await db.prepare("INSERT INTO pages(id,owner_id,question,title,summary,body,category,sources,labels,visibility,created_at,language) VALUES('p','u','Photosynthesis','Photosynthesis','','','','[]','{}','private',?,'en')").bind(page.createdAt).run();
  await db.prepare("INSERT INTO questions(id,page_id,normalized,question,embedding,created_at,match_version,routing_scope,parameters) VALUES('q','p','photosynthesis','Photosynthesis','[]',?,5,'wiki','{}')").bind(page.createdAt).run();
  await db.prepare("INSERT INTO root_routes(id,owner_id,question,normalized,language,embedding,target_type,intent,created_at) VALUES('r','u','Photosynthesis','photosynthesis','en','[]','wiki_router','{\"fresh\":false}',?)").bind(page.createdAt).run();
  const m=await load('const {'+Object.keys(globalThis.exactDeps).join(',')+'}=globalThis.exactDeps;'+strip('app/api/ask/exact-match.ts'));
  assert.equal((await m.exactSavedQuestion('Photosynthesis','u')).id,'p');
  assert.equal(await m.exactSavedQuestion('Photosynthesis','other'),null);
  assert.equal(await m.exactSavedQuestion('Latest photosynthesis','u'),null);
  await db.prepare("UPDATE root_routes SET intent='{\"fresh\":true}'").run();assert.equal(await m.exactSavedQuestion('Photosynthesis','u'),null);
  await db.prepare("UPDATE root_routes SET intent='{\"fresh\":false}'").run();
  await db.prepare('UPDATE questions SET match_version=0').run();assert.equal(await m.exactSavedQuestion('Photosynthesis','u'),null);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});delete globalThis.exactDeps;}
});