import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';
const strip=p=>readFileSync(p,'utf8').replace(/^import .*;$/gm,'');
const load=async s=>import('data:text/javascript;base64,'+Buffer.from(ts.transpile(s,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
test('generator chooses its artifact in one agent invocation and validates before materializing',async()=>{
 let kind='disambiguation',calls=0,saved=0;const agent={id:'g',role:'content-generation',ownerId:'u'};
 globalThis.generationLoop={generationInstructions:'Choose your own tools.',spawnAgent:async()=>agent,recordAction:async()=>{},output:r=>r.text,generationContract:()=>({}),validateGenerationDraft:(d,q,c)=>{assert.equal(q,'china');assert.equal(c.userId,'u');if(!d.valid)throw Error('Correct the draft');return {...d,intent:{outputKind:d.kind==='chat'?'conversation':'article'}};},materializeGenerationDraft:async d=>{saved++;return {answer:{title:'China',summary:'Summary',body:'',category:'Index'},templateId:d.kind==='chat'?'chat-v1':'disambiguation-v1'};},askAgent:async(a,i,t,s,signal,onReply,files,options)=>{
  calls++;assert.equal(a,agent);assert.equal(t.question,'china');assert.ok(options.extraTools.some(t=>t.name==='test_page_program'));
  assert.match(await options.validateFinal({text:JSON.stringify({draftJson:'{}'})},{webSearched:false}),/Correct/);assert.equal(saved,calls-1);
  assert.equal(await options.validateFinal({text:JSON.stringify({draftJson:JSON.stringify({kind,valid:true,labels:{overview:'Overview'}})})},{webSearched:true}),undefined);
 }};
 const m=await load('const {'+Object.keys(globalThis.generationLoop).join(',')+'}=globalThis.generationLoop;\n'+strip('app/page-programs/generate-context.ts'));
 const context={ownerId:'u',userId:'u',language:'en',visibility:'private'},signal=new AbortController().signal;
 assert.equal((await m.generateContext({question:'china',templateId:'wiki-v1',fresh:false},context,{},undefined,signal)).templateId,'disambiguation-v1');
 kind='chat';assert.equal((await m.generateContext({question:'china',templateId:'wiki-v1',fresh:false},context,{},undefined,signal)).templateId,'chat-v1');assert.equal(calls,2);assert.equal(saved,2);delete globalThis.generationLoop;
});
test('agent owns a direct tool loop and required search still requires actual evidence',async()=>{
 let completed=true,payload;
 globalThis.directLoop={model:()=> 'test-model',memory:async()=>[],recordAction:async()=>{},output:()=> '{"needed":false}',api:async(path,p)=>{payload=p;return {output:completed?[{type:'web_search_call',status:'completed'}]:[]};}};
 const code=strip('app/agents/runtime.ts').slice(strip('app/agents/runtime.ts').indexOf('type AgentOptions=')).replace("await (await import('./tools')).applicationToolbox(agent,options.context,signal)","({tools:[{type:'web_search'}],instructions:'',execute:async()=>({data:{}})})");
 const m=await load('const {'+Object.keys(globalThis.directLoop).join(',')+'}=globalThis.directLoop;const reasoningOptions=()=>({}),compactSession=async()=>({}),sessionContext=async()=>({}),runJournal=()=>async()=>{};\n'+strip('app/agents/loop.ts')+'\n'+code);
 const agent={role:'content-generation'};
 await m.askAgent(agent,'Check meanings',{}, {},undefined,undefined,[],{webSearch:true});assert.equal(payload.tool_choice,'auto');assert.ok(payload.tools.some(t=>t.name==='delegate_task'));
 completed=false;await assert.rejects(m.askAgent(agent,'Check',{}, {},undefined,undefined,[],{webSearch:true}),/AI_UNAVAILABLE/);
 await m.askAgent(agent,'Normal',{},{});assert.ok(payload.tools.some(t=>t.type==='web_search'));delete globalThis.directLoop;
});
test('specialists inherit the actor, scoped page, and tools without acquiring owner privileges',async()=>{
 const contexts=[],calls=[],agent={id:'parent',role:'page:shared-page',ownerId:'visitor'};
 globalThis.delegationFixture={model:()=> 'test-model',memory:async()=>[],recordAction:async()=>{},output:r=>r.text,compactSession:async()=>({}),sessionContext:async()=>({}),runJournal:()=>async()=>{},reasoningOptions:()=>({}),getPage:async(id,user)=>{assert.equal(id,'shared-page');assert.equal(user,'visitor');return {};},spawnAgent:async(role,user,parent)=>{assert.equal(user,'visitor');assert.equal(parent,agent);return {id:'child',role,ownerId:user};},applicationToolbox:async(a,c)=>{contexts.push({a,c});return {tools:[],instructions:'',execute:async()=>({data:{}})};},runToolLoop:async o=>{
  calls.push(o.payload);
  if(calls.length===1){const result=await o.execute('delegate_task',{specialty:'coding',task:'Implement the calculation'});assert.equal(result.data.result,'code');}
  return {response:{text:'{"result":"code"}'},webSearched:false};
 }};
 const code=strip('app/agents/runtime.ts').slice(strip('app/agents/runtime.ts').indexOf('type AgentOptions=')).replace("await (await import('./tools')).applicationToolbox(agent,options.context,signal)","await applicationToolbox(agent,options.context,signal)");
 const m=await load('const {'+Object.keys(globalThis.delegationFixture).join(',')+'}=globalThis.delegationFixture;\n'+code);
 await m.runAgentResponse(agent,{instructions:'Edits require a preview.'},undefined,{context:{userId:'owner',ownerId:'owner'},extraTools:[{name:'preview_edit'}],executeExtra:async()=>({data:{preview:true}})});
 assert.equal(contexts[1].c.userId,'visitor');assert.equal(contexts[1].c.ownerId,'visitor');assert.equal(contexts[1].c.pageId,'shared-page');
 assert.ok(calls[1].tools.some(t=>t.name==='preview_edit'));assert.match(calls[1].instructions,/Edits require a preview/);
 delete globalThis.delegationFixture;
});
