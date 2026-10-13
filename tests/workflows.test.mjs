import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {pathToFileURL} from 'node:url';import {resolve} from 'node:path';
// Bundles the workflow modules with the platform services stubbed through globalThis.
const stubs={'@/app/page-programs/runtime':'export const executeCall=(c,ctx)=>globalThis.wfCalls(c,ctx);','@/app/resources/service':'export const readFile=(p,u,r)=>globalThis.wfRead(r);','@/app/context-files/store':'export const storePageTextFile=(...a)=>globalThis.wfStore("text",a);export const storePageBinaryFile=(...a)=>globalThis.wfStore("binary",a);','@/app/api/ask/ai':'export const api=async()=>{throw Error("no model in tests")};export const output=()=>"";','@/db/store':'export const model=()=>"test";export const getPage=()=>globalThis.wfPage;export const database=()=>globalThis.wfDb;','@/app/page-permissions':'export const canWritePage=p=>!!p.owned;','@/app/components-registry/chart-contracts':'export const chartBlockErrors=b=>b.includes("```chart\\n{bad")?["Chart JSON is invalid."]:[];','@/app/api/ask/refresh-matched-page':'export const relocateQuote=(q,s)=>s;','@/app/sandboxes/service':'export const runProgram=(...a)=>globalThis.wfRun(...a);export const sandboxStatus=()=>({allowed:true,configured:true});','@/app/context-files/read':'export const decodeFile=async(b,name,mime,o)=>({data:o&&o.mode==="table"?{rows:[]}:{text:b.toString("utf8"),name}});','@/app/versions/service':'export const keepOriginal=async()=>{};export const recordVersion=async(...a)=>{globalThis.wfVersions.push(a);};','@/app/resources/contracts':'import {z} from "zod";export const resourceSchema=z.object({space:z.string(),id:z.string(),kind:z.enum(["file","folder"]),name:z.string(),connectorId:z.string().optional()}).strict();'};
const out=await build({stdin:{contents:"export * from './app/workflows/validate.ts';export * from './app/workflows/executor.ts';export * from './app/workflows/expressions.ts';export {workflowContract} from './app/workflows/contract.ts';export {applyPatch} from './app/workflows/patch.ts';export {TOOLS} from './app/workflows/tools.ts';export {createWorkbench} from './app/workflows/workbench.ts';export * as md from './app/documents/markdown.ts';export {describeData} from './app/workflows/describe.ts';export {missingDollar} from './app/workflows/validate.ts';export {verifyWorkflow} from './app/workflows/verify.ts';export {runClientAction} from './app/workflows/client-run.ts';export * as notes from './app/workflows/source-notes.ts';",resolveDir:process.cwd(),loader:'ts'},bundle:true,format:'esm',platform:'node',write:false,external:['zod','jsonata','jszip','csv-parse','csv-parse/sync','playwright-core'],plugins:[{name:'stubs',setup(b){b.onResolve({filter:/^@\/(app\/(page-programs\/runtime|resources\/service|context-files\/store|resources\/contracts|api\/ask\/ai|page-permissions|components-registry\/chart-contracts|api\/ask\/refresh-matched-page|versions\/service|sandboxes\/service|context-files\/read)|db\/store)$/},a=>({path:a.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:stubs[a.path],loader:'js',resolveDir:process.cwd()}));}}]});
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

test('the workbench lets an agent spec, search, build by node id, run and evaluate against real outputs',async()=>{
 globalThis.wfCalls=async c=>c.tool==='files.list'?[{id:'f1',name:'yield.csv',size:2048},{id:'f2',name:'photo.jpg',size:10}]:{};
 const bench=wf.createWorkbench({userId:'u',pageId:'p',language:'en',request:'Show my CSV files',title:'Files'});
 const call=async(name,args)=>(await bench.execute(name,args)).data;
 const spec=await call('wf_spec',{specJson:JSON.stringify({goal:'List CSV files with sizes',outputs:['table of CSV files'],acceptance:[{requirement:'Shows CSV files',test:{actions:['load'],expect:['$count(state.files) > 0']}}]})});
 assert.equal(spec.saved,true);assert.equal(spec.acceptanceTests,1);
 const found=await call('wf_catalog',{query:'table csv download',kind:'component'});assert.equal(found.components[0].name,'table');
 assert.match(JSON.stringify(await call('wf_catalog',{query:'files.zip',kind:'all'})),/new Page file/);
 const tried=await call('wf_try_tool',{tool:'files.list',argsJson:'{}'});assert.equal(tried.result.length,2);
 await call('wf_set',{workflowJson:JSON.stringify({kind:'workflow-app',title:'Files',state:{files:[]},ui:[{id:'main',type:'card',props:{title:'Files'},children:[]}],actions:{}})});
 const edited=await call('wf_edit',{opsJson:JSON.stringify([
  {op:'add_node',parent:'main',node:{id:'tbl',type:'table',props:{rows:{$:'state.files'}}}},
  {op:'update_props',id:'tbl',props:{download:'files',rows:{$:'state.files'}}},
  {op:'set_action',name:'load',action:{steps:[{id:'list',tool:'files.list'}],set:{files:{$:"steps.list[$contains(name,'.csv')][]"}}}},
  {op:'add_node',parent:null,index:0,node:{type:'heading',props:{text:'CSV files'}}}])});
 assert.deepEqual(edited.errors,[]);
 const ran=await call('wf_run',{action:'load',valuesJson:'',stateJson:'',continue:false});
 assert.equal(ran.error,null);assert.deepEqual(ran.state.files,[{id:'f1',name:'yield.csv',size:2048}]);
 assert.deepEqual((await call('wf_eval',{expression:'$sum(steps.list.size)',scopeJson:''})).value,2058);
 const got=await call('wf_get',{});assert.equal(got.workflow.ui[0].type,'heading');assert.equal(got.workflow.ui[1].children[0].props.download,'files');
 assert.equal(bench.workflow().title,'Files');assert.equal(bench.tests()[0].expect[0],'$count(state.files) > 0');assert.equal(bench.passed(bench.workflow()),false);
 await assert.rejects(bench.execute('wf_edit',{opsJson:JSON.stringify([{op:'remove_node',id:'ghost'}])}),/No node with id "ghost"/);
 assert.match(JSON.stringify(await call('wf_try_tool',{tool:'files.write',argsJson:'{}'})),/runs only inside the app/);
});

test('markdown documents: outline, sections, edits, and app writes that keep a version',async()=>{
 const body='Intro [1].\n\n## Climate\n\nWindy.\n\n### Winter\n\nCold.\n\n## Uses\n\nPower.\n\n```\n## not a heading\n```\n';
 assert.deepEqual(wf.md.outline(body).map(h=>h.level+':'+h.text),['2:Climate','3:Winter','2:Uses']);
 assert.equal(wf.md.applyMarkdownEdit(body,{mode:'replace_section',heading:'climate',text:'## Climate\n\nCalm.'}).includes('Cold.'),false);
 assert.match(wf.md.applyMarkdownEdit(body,{mode:'insert_after_section',heading:'Winter',text:'### Spring\n\nMild.'}),/Cold\.\n\n### Spring\n\nMild\.\n\n## Uses/);
 assert.match(wf.md.applyMarkdownEdit(body,{mode:'append',text:'## Notes\n\nNew.'}),/```\n\n## Notes\n\nNew\.\n$/);
 assert.throws(()=>wf.md.applyMarkdownEdit(body,{mode:'replace_section',heading:'Nope',text:'x'}),/No section "Nope". Sections: Climate \| Winter \| Uses/);
 const writes=[];globalThis.wfVersions=[];globalThis.wfPage={id:'p',title:'T',summary:'S',body,category:'',sources:[],labels:{templateId:'wiki-v1'},owned:true};
 globalThis.wfDb={prepare:sql=>({bind:(...a)=>({sql,a,all:async()=>({results:[]})})}),batch:async list=>{writes.push(...list);}};
 const read=await wf.TOOLS['markdown.read'].run({section:'Uses'},ctx);assert.equal(read.body.trim(),'## Uses\n\nPower.\n\n```\n## not a heading\n```');
 const r=await wf.TOOLS['markdown.write'].run({mode:'append',text:'## Log\n\nEntry.'},ctx);assert.equal(r.saved,true);assert.match(writes[0].a[0],/## Log\n\nEntry\.\n$/);assert.equal(globalThis.wfVersions.length,1);
 await assert.rejects(wf.TOOLS['markdown.write'].run({mode:'append',text:'```chart\n{bad'},ctx),/Chart JSON is invalid/);
 globalThis.wfPage={...globalThis.wfPage,owned:false};await assert.rejects(wf.TOOLS['markdown.write'].run({mode:'append',text:'x'},ctx),/PAGE_READ_ONLY/);
 const w=wf.validateWorkflow(base({actions:{load:{steps:[{id:'m',tool:'markdown.write',args:{mode:'append',text:'x'}}]}}}));assert.match(w.errors.join(' '),/cannot write files/);
});

test('json.parse turns connector text into data a workflow can bind',async()=>{
 const obs=Array.from({length:96},(_,i)=>({t:'2026-10-10T'+String(Math.floor(i/4)).padStart(2,'0')+':'+String(i%4*15).padStart(2,'0'),temp:10+i/10,wind:3+(i%7)}));
 globalThis.wfCalls=async c=>c.tool==='connectors.call'?{content:JSON.stringify({station:'R5-01',observations:obs})}:{};
 const w=wf.validateWorkflow(base({state:{rows:[]},actions:{pick:{steps:[
  {id:'file',tool:'connectors.call',args:{connectorId:'adma',tool:'read_text_file',arguments:{path:{$:"'realm5/' & values.day & '.json'"}}}},
  {id:'data',tool:'json.parse',args:{text:{$:'steps.file.content'}}}],
  set:{rows:{$:'steps.data.observations[]'},maxWind:{$:'$max(steps.data.observations.wind)'}}}}})).workflow;
 const r=await wf.runAction(w,'pick',{values:{day:'2026-10-10'}},ctx);
 assert.equal(r.error,undefined);assert.equal(r.state.rows.length,96);assert.equal(r.state.maxWind,9);
 assert.deepEqual(await wf.TOOLS['json.parse'].run({text:'{"a":1}\n{"a":2}\n',lines:true}),[{a:1},{a:2}]);
 await assert.rejects(wf.TOOLS['json.parse'].run({text:'{bad'}),/Not valid JSON/);
});

test('data.describe summarizes any structure, including JSON held in a string',()=>{
 const obs=Array.from({length:96},(_,i)=>({time:'2026-10-10T00:'+String(i%60).padStart(2,'0'),temp:10+i/10,...(i%2?{gust:5}:{})}));
 const d=wf.describeData({content:JSON.stringify({station:'R5-01',observations:obs}),path:'realm5/2026-10-10.json'});
 const parsed=d.fields.content.parsed;assert.equal(d.fields.content.contains,'json');
 assert.equal(parsed.fields.observations.length,96);assert.deepEqual(parsed.fields.observations.items.fields.temp.range,[10,19.5]);
 assert.equal(parsed.fields.observations.items.fields.time.format,'date/time');assert.match(parsed.fields.observations.items.fields.gust.present,/^\d+\/\d+$/);
 assert.equal(wf.describeData('{"a":1}\n{"a":2}').contains,'json lines (2)');
 assert.equal(wf.describeData(Array.from({length:100000},(_,i)=>({i}))).length,100000);
});
test('source notes are per user, searchable, and surface when an agent tries a tool',async()=>{
 const rows=[];globalThis.wfDb={prepare:sql=>({bind:(...a)=>({run:async()=>{if(sql.startsWith('INSERT')){const [id,owner,source,notes,at]=a;const old=rows.find(r=>r.owner===owner&&r.source===source);if(old)Object.assign(old,{notes,updated_at:at});else rows.push({id,owner,source,notes,updated_at:at});}},all:async()=>({results:rows.filter(r=>r.owner===a[0])})})})};
 await wf.notes.saveSourceNote('u','ADMA Realm5 daily weather files','Path realm5/<station>/<YYYY-MM-DD>.json; observations[] every 15 min; temp in C, wind in m/s.');
 await wf.notes.saveSourceNote('u','ADMA Realm5 daily weather files','Path realm5/<station>/<YYYY-MM-DD>.json; observations[] every 15 min; temp C; wind m/s; UTC.');
 await wf.notes.saveSourceNote('other','ADMA Realm5 daily weather files','private to another user');
 assert.equal(rows.length,2);assert.match((await wf.notes.readSourceNotes('u','realm5 weather'))[0].notes,/UTC/);assert.deepEqual(await wf.notes.readSourceNotes('u','soil moisture'),[]);
 globalThis.wfCalls=async c=>c.tool==='connectors.call'?{content:JSON.stringify({observations:[{temp:1}]})}:{};
 const bench=wf.createWorkbench({userId:'u',pageId:'p',language:'en',request:'plot',title:'T'});
 const tried=(await bench.execute('wf_try_tool',{tool:'connectors.call',argsJson:JSON.stringify({connectorId:'adma',tool:'read_text_file',arguments:{path:'realm5/x/2026-10-10.json'}})})).data;
 assert.equal(tried.shape.fields.content.parsed.fields.observations.items.fields.temp.type,'number');assert.match(tried.knownNotes[0].source,/Realm5/);
});

test('code.run is a literal, isolated, last-resort compute step',async()=>{
 const runs=[];globalThis.wfRun=async(program,input,ctx,uploads,options)=>{runs.push({program,input,options});return program.code.includes('throw')?{ok:false,stderr:'Error: boom'}:{ok:true,result:{mean:input.reduce((a,b)=>a+b,0)/input.length}};};
 const good=wf.validateWorkflow(base({actions:{stats:{steps:[{id:'m',tool:'code.run',args:{language:'python',code:'def main(input):\n  return {"mean": sum(input)/len(input)}',input:{$:'[1,2,3,6]'}}}],set:{rows:{$:'[steps.m]'}}}}}));
 assert.deepEqual(good.errors,[]);
 const r=await wf.runAction(good.workflow,'stats',{},ctx);assert.equal(r.error,undefined);assert.deepEqual(r.state.rows,[{mean:3}]);
 assert.equal(runs[0].options.isolated,true);assert.equal(runs[0].program.language,'python');
 const js=wf.validateWorkflow(base({actions:{q:{steps:[{id:'a',tool:'code.run',args:{language:'javascript',code:'function main(i){return {mean:1}}',input:[1]}},{id:'b',tool:'code.run',args:{language:'javascript',sandbox:'vm',code:'function main(i){return {mean:2}}',input:[2]}}]}}}));assert.deepEqual(js.errors,[]);
 await wf.runAction(js.workflow,'q',{},ctx);assert.equal(runs.at(-2).options.isolated,false);assert.equal(runs.at(-1).options.isolated,true);
 assert.match(wf.validateWorkflow(base({actions:{q:{steps:[{id:'a',tool:'code.run',args:{language:'javascript',sandbox:'cloud',code:'x'}}]}}})).errors.join(' '),/"auto" or "vm"/);
 const bad=wf.validateWorkflow(base({actions:{x:{steps:[{id:'a',tool:'code.run',args:{language:'ruby',code:{$:"'def main'"}}},{id:'b',tool:'code.run',each:{$:'[1,2]'},args:{language:'javascript',code:'function main(i){return i}'}}]}}})).errors.join(' ');
 assert.match(bad,/literal string in args.code/);assert.match(bad,/"javascript" or "python"/);assert.match(bad,/cannot run inside each/);
 const many=wf.validateWorkflow(base({actions:{x:{steps:[1,2,3,4].map(i=>({id:'c'+i,tool:'code.run',args:{language:'javascript',code:'function main(i){return i}'}}))}}})).errors.join(' ');assert.match(many,/at most 3 code.run/);
 const failing=wf.validateWorkflow(base({actions:{x:{steps:[{id:'a',tool:'code.run',args:{language:'javascript',code:'function main(){throw Error("x")}',input:[1]}}]}}})).workflow;
 assert.match((await wf.runAction(failing,'x',{},ctx)).error,/The code failed: Error: boom/);
 const bench=wf.createWorkbench({userId:'u',pageId:'p',language:'en',request:'r',title:'T'});
 assert.equal((await bench.execute('wf_preview',{stateJson:'',valuesJson:'',viewport:'desktop'})).data.rendered,false);
});

test('functions without $ are caught before they fail at run time',()=>{
 assert.equal(wf.missingDollar('$count(state.rows) = 0 and not(running.x)'),'not');
 assert.equal(wf.missingDollar("not($exists(values.x)) or count(y)"),'not');
 assert.equal(wf.missingDollar("$not($exists(values.x)) and $count(state.rows) > 0"),null);
 assert.equal(wf.missingDollar("'count(' & name"),null);
 assert.equal(wf.missingDollar('rows.(value * 2)'),null);
 const r=wf.validateWorkflow(base({state:{rows:[]},ui:[{type:'empty',visible:{$:'$count(state.rows) = 0 and not(running.load)'}}]}));
 assert.match(r.errors.join(' '),/write \$not\(…\) instead of not\(…\)/);
});
test('upload flows run against test files, and every display binding is checked in verification',async()=>{
 globalThis.wfCalls=async()=>({});
 const csv='date,temp\n2026-09-01,15\n2026-09-02,17\n';
 const good={kind:'workflow-app',state:{rows:[],columns:[]},ui:[{id:'csvFile',type:'file_upload',props:{label:'CSV'},on:{change:'analyze'}},{type:'select',id:'x',props:{options:{$:'state.columns'}}},{type:'table',props:{rows:{$:'state.rows'}}}],
  actions:{analyze:{steps:[{id:'read',tool:'files.read',args:{fileId:{$:'values.csvFile[0].id'},options:{mode:'text'}}},{id:'parse',tool:'csv.parse',args:{text:{$:'steps.read'}}}],set:{rows:{$:'steps.parse'},columns:{$:'$keys(steps.parse[0])'}}}}};
 const bench=wf.createWorkbench({userId:'u',pageId:'p',language:'en',request:'csv tool',title:'CSV'});
 const fx=(await bench.execute('wf_fixture',{name:'weather.csv',content:csv})).data.resource;assert.equal(fx.id,'fixture:weather.csv');
 await bench.execute('wf_set',{workflowJson:JSON.stringify(good)});
 const ran=(await bench.execute('wf_run',{action:'analyze',valuesJson:JSON.stringify({csvFile:[fx]}),stateJson:'',continue:false})).data;
 assert.equal(ran.error,null);assert.equal(ran.state.rows.length,2);assert.deepEqual(ran.state.columns,['date','temp']);
 const report=await wf.verifyWorkflow(good,{request:'csv',title:'CSV',pageId:'p',language:'en'},{userId:'u'},[{name:'upload',files:[{name:'w.csv',content:csv}],values:{csvFile:[{space:'page',id:'fixture:w.csv',kind:'file',name:'w.csv'}]},actions:['analyze'],expect:['$count(state.rows) = 2']}]);
 assert.deepEqual(report.tests[0].failed,[]);
 const broken={...good,ui:[...good.ui,{type:'callout',props:{text:{$:'state.rows[0].temp.missing.x & $undefinedFn()'}}}]};
 const bad=await wf.verifyWorkflow(broken,{request:'csv',title:'CSV',pageId:'p',language:'en'},{userId:'u'},[{name:'upload',files:[{name:'w.csv',content:csv}],values:{csvFile:[{space:'page',id:'fixture:w.csv',kind:'file',name:'w.csv'}]},actions:['analyze']}]);
 assert.equal(bad.passed,false);assert.match(bad.blocking.join(' '),/Display binding ui\[3\] \(callout\)\.props\.text/);
});

test('client actions run pure calculations in the browser and may not call platform tools',async()=>{
 const loan={kind:'workflow-app',state:{result:null},ui:[{id:'amount',type:'number_input',props:{default:300000}},{id:'rate',type:'number_input',props:{default:4.5}},{id:'years',type:'number_input',props:{default:3}},{type:'button',props:{label:'Go'},on:{click:'calc'}}],
  actions:{calc:{client:true,steps:[{id:'m',tool:'compute',args:{value:{$:"( $r := values.rate/100/12; $n := values.years*12; $round(values.amount*$r/(1-$power(1+$r,-$n)),2) )"}}}],set:{result:{$:'steps.m'}}}}};
 const v=wf.validateWorkflow(loan);assert.deepEqual(v.errors,[]);
 const r=await wf.runClientAction(v.workflow,'calc',{state:{result:null},values:{amount:300000,rate:4.5,years:3},event:{type:'click'}},{id:'p',title:'T'});
 assert.equal(r.state.result,8924.08);assert.equal(r.trace[0].status,'ok');
 const bad=wf.validateWorkflow({...loan,actions:{calc:{client:true,steps:[{id:'f',tool:'files.list'}]}}});
 assert.match(bad.errors.join(' '),/runs in the browser and may only use compute, json.parse, json.format \(found files.list\)/);
});
test('inputs accept a value binding that an action can drive',()=>{
 const r=wf.validateWorkflow(base({state:{field:null},ui:[{id:'pick',type:'select',props:{options:['a','b'],value:{$:'state.field'}}},{id:'go',type:'button',on:{click:'auto'}}],actions:{auto:{steps:[],set:{field:'b'}}}}));
 assert.deepEqual(r.errors,[],JSON.stringify(r.errors));
 assert.ok(wf.workflowContract.inputs.includes('value'));
});
test('chosen files are read in place; copies are not read back; every data entry needs a test',async()=>{
 globalThis.wfRead=async r=>({bytes:new TextEncoder().encode('a,b\n1,2'),name:r.name,mime:'text/csv'});
 const r=await wf.TOOLS['resources.read'].run({resource:[{space:'google',id:'g1',kind:'file',name:'w.csv',url:'/x',size:7}]},ctx);
 assert.equal(r.resource.space,'google');assert.equal(r.resource.url,undefined);assert.match(r.text,/a,b/);
 await assert.rejects(()=>wf.TOOLS['resources.read'].run({resource:{space:'google',id:'f',kind:'folder',name:'F'}},ctx),/reads files/);
 const copy=wf.validateWorkflow(base({ui:[{id:'pick',type:'resource_picker',on:{change:'go'}}],actions:{go:{steps:[{id:'c',tool:'resources.copy',args:{operationId:'x',sources:{$:'values.pick'},destination:{}}},{id:'r',tool:'files.read',args:{fileId:{$:'steps.c.id'}}}]}}}));
 assert.ok(copy.errors.some(e=>/approval request.*resources.read/.test(e)),JSON.stringify(copy.errors));
 const app=base({ui:[{id:'up',type:'file_upload',on:{change:'a'}},{id:'pick',type:'resource_picker',on:{change:'b'}}],actions:{a:{steps:[{id:'r',tool:'resources.read',args:{resource:{$:'values.up'}}}],set:{rows:{$:'[steps.r]'}}},b:{steps:[{id:'r',tool:'resources.read',args:{resource:{$:'values.pick'}}}],set:{rows:{$:'[steps.r]'}}}}});
 const file={space:'page',id:'fixture:w.csv',kind:'file',name:'w.csv'},files=[{name:'w.csv',content:'a,b\n1,2'}];
 const one=await wf.verifyWorkflow(app,{request:'csv',title:'CSV',pageId:'p',language:'en'},{userId:'u'},[{name:'upload',files,values:{up:[file]},actions:['a']}]);
 assert.ok(one.blocking.some(e=>/No test covers the data entry resource_picker #pick runs b/.test(e)),JSON.stringify(one.blocking));
 const both=await wf.verifyWorkflow(app,{request:'csv',title:'CSV',pageId:'p',language:'en'},{userId:'u'},[{name:'upload',files,values:{up:[file]},actions:['a']},{name:'pick',files,values:{pick:[file]},actions:['b'],expect:['$count(state.rows) = 1']}]);
 assert.ok(!both.blocking.some(e=>/No test covers/.test(e)),JSON.stringify(both.blocking));
});
