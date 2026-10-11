import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {pathToFileURL} from 'node:url';import {resolve} from 'node:path';
// Bundles the workflow modules with the platform services stubbed through globalThis.
const stubs={'@/app/page-programs/runtime':'export const executeCall=(c,ctx)=>globalThis.wfCalls(c,ctx);','@/app/resources/service':'export const readFile=(p,u,r)=>globalThis.wfRead(r);','@/app/context-files/store':'export const storePageTextFile=(...a)=>globalThis.wfStore("text",a);export const storePageBinaryFile=(...a)=>globalThis.wfStore("binary",a);','@/app/resources/contracts':'import {z} from "zod";export const resourceSchema=z.object({space:z.string(),id:z.string(),kind:z.enum(["file","folder"]),name:z.string(),connectorId:z.string().optional()}).strict();'};
const out=await build({stdin:{contents:"export * from './app/workflows/validate.ts';export * from './app/workflows/executor.ts';export * from './app/workflows/expressions.ts';export {workflowContract} from './app/workflows/contract.ts';export {applyPatch} from './app/workflows/patch.ts';export {TOOLS} from './app/workflows/tools.ts';",resolveDir:process.cwd(),loader:'ts'},bundle:true,format:'esm',platform:'node',write:false,external:['zod','jsonata','jszip','csv-parse','csv-parse/sync'],plugins:[{name:'stubs',setup(b){b.onResolve({filter:/^@\/app\/(page-programs\/runtime|resources\/service|context-files\/store|resources\/contracts)$/},a=>({path:a.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:stubs[a.path],loader:'js',resolveDir:process.cwd()}));}}]});
const file=resolve('node_modules/.cache-workflows-test.mjs');(await import('node:fs')).writeFileSync(file,out.outputFiles[0].text);
const wf=await import(pathToFileURL(file).href);
const ctx={userId:'u',pageId:'p',language:'en',explicit:true};
const base=(extra={})=>({kind:'workflow-app',state:{rows:[]},ui:[{type:'heading',props:{text:'Hi'}}],actions:{},...extra});

test('the contract examples are valid workflows and list every component and tool',()=>{
 for(const ex of wf.workflowContract.examples){const r=wf.validateWorkflow(ex);assert.deepEqual(r.errors,[],JSON.stringify(r.errors));}
 assert.ok(wf.workflowContract.components.length>=45);assert.ok(wf.workflowContract.tools.some(t=>t.name==='files.zip'));
});
test('validation names unknown components, props, events, step references, state keys and bad expressions',()=>{
 const r=wf.validateWorkflow(base({ui:[{type:'fancy_widget'},{type:'table',props:{rowz:[]}},{id:'b',type:'button',on:{tap:'go',click:'missing'}},{type:'text',props:{markdown:{$:'state.nope & values.ghost'}}},{type:'text',props:{markdown:{$:'1 +'}}}],actions:{go:{steps:[{id:'a',tool:'compute',args:{value:{$:'steps.b'}}},{id:'b',tool:'teleport'}]},load:{steps:[{id:'w',tool:'files.write',args:{name:'x.txt',content:'y'}}]}}}));
 const all=r.errors.join('\n');
 for(const expected of [/unknown component "fancy_widget"/,/unknown prop "rowz"/,/no "tap" event/,/unknown action "missing"/,/reads steps\.b, which is not an earlier step/,/unknown tool "teleport"/,/state\.nope is neither/,/values\.ghost refers to no component/,/cannot write files/,/Expected|Unexpected|end of expression/])assert.match(all,expected);
 assert.throws(()=>wf.validateWorkflow({kind:'workflow-app',ui:[]}),/Invalid workflow/);
});
test('the executor runs independent steps in parallel, maps lists, honours when, and sets state',async()=>{
 const calls=[];let active=0,peak=0;
 globalThis.wfCalls=async(c)=>{calls.push(c.tool);active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,30));active--;
  if(c.tool==='files.list')return [{id:'1',name:'a.csv',size:10},{id:'2',name:'b.csv',size:30},{id:'3',name:'c.png',size:5}];
  if(c.tool==='connectors.list')return [{id:'arc',name:'ArcGIS Online'}];
  if(c.tool==='files.read')return {rows:[{v:Number(c.args.fileId)}]};
  return {};};
 const w=wf.validateWorkflow(base({actions:{load:{steps:[
  {id:'files',tool:'files.list'},{id:'conn',tool:'connectors.list'},
  {id:'reads',tool:'files.read',each:{$:"steps.files[$contains(name,'.csv')]"},args:{fileId:{$:'$item.id'}}},
  {id:'skip',tool:'jobs.list',when:{$:'$count(steps.files) > 10'}}],
  set:{rows:{$:'steps.reads.rows'},total:{$:'$sum(steps.files.size)'},arc:{$:"steps.conn[name='ArcGIS Online'].id"}}}}})).workflow;
 const r=await wf.runAction(w,'load',{},{...ctx,explicit:false});
 assert.equal(r.error,undefined);assert.deepEqual(r.state.rows,[{v:1},{v:2}]);assert.equal(r.state.total,45);assert.equal(r.state.arc,'arc');
 assert.ok(peak>=2,'independent steps overlap');assert.ok(!calls.includes('jobs.list'));
 assert.deepEqual(r.trace.find(t=>t.step==='reads').items,2);assert.equal(r.trace.find(t=>t.step==='skip').status,'skipped');
});
test('failures stop dependents unless optional; proposals are collected; writes need a user action',async()=>{
 globalThis.wfCalls=async c=>c.tool==='jobs.list'?{error:'boom'}:c.tool==='connectors.call'?{confirmationRequired:true,actionId:'act1',request:{tool:'publish_file'}}:{ok:true};
 globalThis.wfStore=async(kind,a)=>({kind,name:a[2]});
 const w=wf.validateWorkflow(base({actions:{
  hard:{steps:[{id:'a',tool:'jobs.list'},{id:'b',tool:'compute',args:{value:{$:'steps.a'}}}],set:{rows:{$:'[1]'}}},
  soft:{steps:[{id:'a',tool:'jobs.list',optional:true},{id:'b',tool:'connectors.call',args:{connectorId:'arc',tool:'publish_file',arguments:{}}}],set:{rows:{$:'[steps.a.error]'}}},
  save:{steps:[{id:'w',tool:'files.write',args:{name:'out.csv',content:'a,b'}}],set:{rows:{$:'[steps.w]'}}}}})).workflow;
 const hard=await wf.runAction(w,'hard',{},ctx);assert.match(hard.error,/Step a \(jobs.list\) failed: boom/);assert.deepEqual(hard.state.rows,[]);
 const soft=await wf.runAction(w,'soft',{},ctx);assert.equal(soft.error,undefined);assert.deepEqual(soft.state.rows,['boom']);assert.deepEqual(soft.proposals,[{actionId:'act1',request:{tool:'publish_file'}}]);
 assert.match((await wf.runAction(w,'save',{},{...ctx,explicit:false})).error,/needs a user action/);
 assert.deepEqual((await wf.runAction(w,'save',{},ctx)).state.rows,[{kind:'text',name:'out.csv'}]);
 assert.equal((await wf.runAction(w,'save',{},{...ctx,verification:true})).trace[0].status,'skipped');
});
test('files.zip packs the chosen resources into a new Page file',async()=>{
 const JSZip=(await import('jszip')).default;let stored;
 globalThis.wfRead=async r=>({bytes:new TextEncoder().encode('data of '+r.name)});globalThis.wfStore=async(kind,a)=>{stored=a;return {space:'page',id:'z',kind:'file',name:a[2]};};
 const w=wf.validateWorkflow(base({actions:{zip:{steps:[{id:'z',tool:'files.zip',args:{files:{$:'values.parts'},name:'layer'}}],set:{rows:{$:'[steps.z]'}}}}})).workflow;
 const r=await wf.runAction(w,'zip',{values:{parts:[{space:'page',id:'1',kind:'file',name:'a.shp',url:'/x',size:3},{space:'page',id:'2',kind:'file',name:'a.dbf'}]}},ctx);
 assert.equal(r.error,undefined);assert.equal(stored[2],'layer.zip');const zip=await JSZip.loadAsync(stored[3]);assert.deepEqual(Object.keys(zip.files).sort(),['a.dbf','a.shp']);
});
test('expressions are boxed in time and depth, and each is capped',async()=>{
 await assert.rejects(wf.evaluate('( $f := function($x){ $f($x+1) }; $f(0) )',{}),/too deep|took longer|Stack|failed/);
 globalThis.wfCalls=async()=>({});
 const w=wf.validateWorkflow(base({actions:{many:{steps:[{id:'m',tool:'jobs.list',each:{$:'[1..150]'}}]}}})).workflow;
 assert.match((await wf.runAction(w,'many',{},ctx)).error,/limit is 100/);
});
test('workflow patches edit, insert and remove by path and reject missing paths',()=>{
 const doc={ui:[{type:'heading',props:{text:'A'}}],actions:{}};
 const next=wf.applyPatch(doc,[{op:'replace',path:'/ui/0/props/text',value:'B'},{op:'add',path:'/ui/-',value:{type:'divider'}},{op:'add',path:'/actions/load',value:{steps:[]}},{op:'remove',path:'/ui/1'}]);
 assert.deepEqual(next,{ui:[{type:'heading',props:{text:'B'}}],actions:{load:{steps:[]}}});assert.equal(doc.ui[0].props.text,'A');
 assert.throws(()=>wf.applyPatch(doc,[{op:'replace',path:'/ui/5',value:1}]),/out of range/);
 assert.throws(()=>wf.applyPatch(doc,[{op:'remove',path:'/nope/x'}]),/does not exist/);
});
test('no workflow tool takes a web address',()=>{
 for(const [name,t] of Object.entries(wf.TOOLS))for(const arg of Object.keys(t.args))assert.ok(!/url|href|endpoint|address/i.test(arg),name+'.'+arg);
});
