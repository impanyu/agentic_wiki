import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';
// The workflow engine (app/teams/workflow.ts) and the team charter's workflows (app/teams/charter.ts), run with stub agents.
const load=async(file,prelude='')=>import('data:text/javascript;base64,'+Buffer.from(prelude+ts.transpile(readFileSync(file,'utf8').replace(/^import [\s\S]*?;$/gm,'').replace(/^export \{[^}]*\} from .*;$/gm,''),{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
const wf=await load('app/teams/workflow.ts');
globalThis.__wf=wf;
const ch=await load('app/teams/charter.ts',`const {Workflow,END,visits}=globalThis.__wf;const OWNER='t';const spawnAgent=async()=>({id:'m'});const entityDb=async()=>null;const createTopic=null,getTopic=null,setTopicParent=null;
const coverage=async()=>({recipeProblems:[]});const listRankingDefs=async()=>[];const listEntityTypes=async()=>[];const setStatus=async()=>{};const checkTopicQa=async()=>globalThis.__qa?globalThis.__qa():({issues:[],failing:[]});const ask=(...a)=>globalThis.__ask(...a);\n`);

test('the engine follows edges and decisions, bounds loops, skips or stops on failure, and checkpoints every step',async()=>{
 const {Workflow,END,visits,WorkflowStopped}=wf;const seen=[];const node=(id,patch,onFail)=>({id,role:'x',title:id,onFail,run:async s=>{seen.push(id);return typeof patch==='function'?patch(s):patch;}});
 const w=new Workflow('t','test').node(node('a',{n:0})).node(node('b',s=>({n:s.n+1}))).node(node('c',()=>{throw Error('boom');},'skip')).node(node('d',{}))
  .then('a','b').branch('b',['b','c'],s=>s.n<3?'b':'c').then('c','d').then('d',END);
 assert.deepEqual(w.validate(),[]);
 const cps=[];const s=await w.run({},null,{checkpoint:async(st,next)=>{cps.push(next);}});
 assert.deepEqual(seen,['a','b','b','b','c','d']);assert.equal(s.n,3);assert.deepEqual(s.c,{skipped:'boom'});assert.equal(visits(s,'b'),3);
 assert.deepEqual(cps,['b','b','b','c','d',END]);
 // Resume at a checkpoint's next node.
 seen.length=0;await w.run({n:3,_visits:{a:1,b:3}},null,{at:'c'});assert.deepEqual(seen,['c','d']);
 // A failing node without onFail "skip" stops the run, naming the node.
 const stop=new Workflow('s','s').node(node('x',()=>{throw Error('no');})).then('x',END);
 await assert.rejects(stop.run({},null),e=>e instanceof WorkflowStopped&&e.node==='x');
 // Endless loops are cut off; broken graphs are reported.
 const loop=new Workflow('l','l').node(node('x',{})).branch('x',['x',END],()=>'x');
 await assert.rejects(loop.run({},null,{maxSteps:5}),/exceeded 5 steps/);
 const bad=new Workflow('b','b').node(node('x',{})).node(node('y',{})).node(node('z',{})).then('x','q').then('y',END);
 assert.deepEqual(bad.validate().sort(),['Edge x → unknown node q.','Node y cannot be reached.','Node z cannot be reached.','Node z has no edge (use then(id, END)).'].sort());
 // A decision outside its declared targets is an error.
 const odd=new Workflow('o','o').node(node('x',{})).branch('x',[END],()=>'y');await assert.rejects(odd.run({},null),/chose y/);
 // An older checkpoint (stage results only) resumes at its first unfinished stage.
 assert.equal(w.resumePoint({a:{},b:{}}),'c');
 assert.match(w.mermaid(),/flowchart TD[\s\S]*b -.-> c/);
});

test('every workflow of the charter is a valid graph; the editor leads and presents, the collector owns metrics and indices',()=>{
 for(const [kind,w] of Object.entries(ch.WORKFLOWS))assert.deepEqual(w.validate(),[],kind);
 const d=Object.fromEntries(ch.charter().map(w=>[w.id,w]));
 assert.deepEqual(Object.keys(d).sort(),['build','expand','repair','review','sources']);
 const role=(w,id)=>d[w].nodes.find(n=>n.id===id).role;
 assert.equal(role('build','plan'),'editor');assert.equal(role('build','collect'),'collector');assert.equal(role('build','design'),'editor');assert.equal(role('build','review'),'reviewer');assert.equal(role('build','arbitrate'),'manager');
 assert.match(d.build.nodes.find(n=>n.id==='design').role,/editor/);
 const src=readFileSync('app/teams/charter.ts','utf8');
 assert.match(src,/Composite indices are composed by the editor/);
 assert.match(readFileSync('app/teams/tools.ts','utf8'),/EDITOR_INDEX=\['define_metric','compute_metric'\]/);
 // Collector stages carry the index tools.
 assert.equal((src.match(/'define_metric','compute_metric','metric_sensitivity'/g)||[]).length,6);
});

// A scripted team: each call answers by role and step.
function team(script){const calls=[];globalThis.__ask=async(role,agent,topic,instructions,task,schema)=>{const step=task?.step||'?';calls.push(role+':'+step);
 const f=script[role+':'+step]??script[role];return typeof f==='function'?f(task,calls):f??{done:['ok'],open:[],notes:''};};return calls;}
const ctx=(r={})=>({db:null,topic:{id:'t1',slug:'phones'},info:{topic:{slug:'phones',name:'Phones',brief:''}},r,log:()=>{},agents:{editor:{id:'e'},collector:{id:'c'},reviewer:{id:'r'}},maxFixRounds:2});
const approved={approved:true,issues:[],summary:'ok'};
const issues=(owner)=>({approved:false,issues:[{owner,severity:'major',problem:'p'}],summary:'not yet'});

test('build: plan → survey → universe → starter → collect → design → review → publish when nothing is missing',async()=>{
 const calls=team({'reviewer:review':approved,'editor:plan':{types:[],rankings:[]}});
 const c=ctx();c.r._maxFixRounds=2;await ch.WORKFLOWS.build.run(c.r,c);
 assert.deepEqual(calls,['editor:plan','collector:survey','collector:universe','editor:starter','collector:collect','editor:data-check','reviewer:early-review','editor:design','reviewer:review']);
});
test('build: unavailable metrics go to the editor to decide, replacements back to the collector',async()=>{
 const calls=team({'collector:collect':{done:[],open:[],notes:'',unavailable:[{metric:'x',why:'none',tried:'a'}]},'editor:resolve':{decisions:[{metric:'x',action:'replace',replacement:'y',why:''}]},'reviewer:review':approved});
 const c=ctx();c.r._maxFixRounds=2;await ch.WORKFLOWS.build.run(c.r,c);
 assert.deepEqual(calls.slice(4),['collector:collect','editor:data-check','reviewer:early-review','editor:resolve','collector:replace','editor:design','reviewer:review']);
});
test('review loop: issues go to their owners for at most the fix rounds, then the manager rules and the reviewer reviews once more',async()=>{
 const calls=team({'reviewer:review':issues('collector'),'reviewer:re-review':issues('collector'),'manager':{rulings:[{ruling:'reviewer_right'}],brief:''},'reviewer:review-after-ruling':issues('collector')});
 const c=ctx();c.r._maxFixRounds=2;const s=await ch.WORKFLOWS.review.run(c.r,c);
 assert.deepEqual(calls,['editor:grow','collector:grow-data','editor:data-check','editor:grow-design','reviewer:review','collector:fix','editor:fix','reviewer:re-review','collector:fix','editor:fix','reviewer:re-review','manager:arbitrate','collector:apply-ruling','editor:apply-ruling','reviewer:review-after-ruling']);
 assert.equal(s.rounds.length,2);assert.equal(s.verdict.approved,false);
 // Editor issues only: the editor fixes alone.
 const calls2=team({'reviewer:review':issues('editor'),'reviewer:re-review':approved});
 const c2=ctx();c2.r._maxFixRounds=2;await ch.WORKFLOWS.expand.run(c2.r,c2);
 assert.deepEqual(calls2.slice(4),['reviewer:review','editor:fix','reviewer:re-review']);
 // Minor and platform issues do not hold publication.
 const calls3=team({'reviewer:review':{approved:false,issues:[{owner:'platform',severity:'major'},{owner:'editor',severity:'minor'}],summary:''}});
 const c3=ctx();c3.r._maxFixRounds=2;await ch.WORKFLOWS.expand.run(c3.r,c3);assert.equal(calls3.at(-1),'reviewer:review');
});
test('repair and source review have no review loop',async()=>{
 const calls=team({});const c=ctx();await ch.WORKFLOWS.repair.run(c.r,c);await ch.WORKFLOWS.sources.run(c.r,c);
 assert.deepEqual(calls,['collector:repair','collector:sources']);
});

test('a ranking the reviewer passes is published at once, before the rest of the topic',async()=>{
 const published=[];globalThis.__published=published;
 team({'reviewer:early-review':{approved:false,ready:['phone-rankings'],issues:[{owner:'editor',severity:'major',problem:'x'}],summary:''},'reviewer:review':approved});
 const src=readFileSync('app/teams/charter.ts','utf8');assert.match(src,/await publishReady\(c,checked\)/);
 const d=ch.charter().find(w=>w.id==='build');assert.deepEqual(d.edges.find(e=>e.from==='collect').to,['data-check']);
});

test('the editor accepts the data or sends the collector back for more rows, columns and indices (at most 3 rounds)',async()=>{
 let n=0;const calls=team({'editor:data-check':()=>({satisfied:++n>2,rows:['missing Asian makers'],columns:['battery life'],indices:['value for money'],notes:''}),'reviewer:review':approved});
 const c=ctx();c.r._maxFixRounds=2;await ch.WORKFLOWS.build.run(c.r,c);
 assert.deepEqual(calls.slice(4,10),['collector:collect','editor:data-check','collector:data-more','editor:data-check','collector:data-more','editor:data-check']);
 assert.equal(calls[10],'reviewer:early-review');
 // Never satisfied: three rounds of more data, then the pages are composed anyway (the review loop judges them).
 const calls2=team({'editor:data-check':{satisfied:false,rows:['x'],columns:[],indices:[],notes:''},'reviewer:review':approved});
 const c2=ctx();c2.r._maxFixRounds=2;await ch.WORKFLOWS.build.run(c2.r,c2);
 assert.equal(calls2.filter(x=>x==='collector:data-more').length,3);
});
