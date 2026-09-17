import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';import {z} from 'zod';
const load=async s=>import('data:text/javascript;base64,'+Buffer.from(ts.transpile(s,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
test('shared toolbox dispatches directly as the actor and rechecks page permissions',async()=>{
 let owned=true,calls=0,actor,scope;
 globalThis.toolboxTest={z,sessionTools:[],connectorTools:[{type:'function',name:'list_connectors'},{type:'function',name:'call_connector'}],templateSearchTool:{type:'function',name:'search_templates'},pageContextTool:{type:'function',name:'read_page_context'},connectorInstructions:'',sessionInstructions:'',sandboxStatus:()=>({configured:true,allowed:true}),getPage:async()=>({id:'p',owned,language:'en'}),canWritePage:p=>p.owned,connectorAgentCall:async(u,n,a,p)=>{actor=u;scope=p;return {connectors:[]}},recordAction:async()=>{},listDataFiles:async(u)=>{actor=u;calls++;return {items:[]}},executeCodeComponent:async(r,i,c)=>{actor=c.userId;calls++;return {ok:true}}};
 const source=readFileSync('app/agents/tools.ts','utf8').replace(/^import .*;$/gm,'');
 const {applicationToolbox}=await load('const {'+Object.keys(globalThis.toolboxTest).join(',')+'}=globalThis.toolboxTest;\n'+source);
 const agent={id:'a',role:'page:p',ownerId:'viewer'},context={userId:'owner',ownerId:'owner',language:'en',visibility:'private'};
 const toolbox=await applicationToolbox(agent,context);assert.equal(actor,'viewer');assert.equal(scope,'p');assert.ok(toolbox.tools.some(t=>t.name==='read_page_context'));assert.ok(!toolbox.tools.some(t=>t.name==='delegate_task'));
 await toolbox.execute('list_data_files',{after:''});assert.equal(actor,'viewer');assert.equal(calls,1);
 await toolbox.execute('execute_code',{componentId:'c',version:1,inputJson:'{}'});assert.equal(actor,'viewer');assert.equal(calls,2);
 owned=false;await assert.rejects(toolbox.execute('execute_code',{componentId:'c',version:1,inputJson:'{}'}),/READ_ONLY/);assert.equal(calls,2);
 const readonly=await applicationToolbox(agent,context);assert.ok(!readonly.tools.some(t=>t.name==='execute_code'));assert.ok(readonly.tools.some(t=>t.name==='list_data_files'));const generator=await applicationToolbox({id:'g',role:'generation',ownerId:'viewer'},{userId:'owner',ownerId:'owner',language:'en',visibility:'private'});assert.ok(generator.tools.some(t=>t.name==='call_connector'));assert.ok(generator.tools.some(t=>t.name==='suggest_page'));await generator.execute('call_connector',{connectorId:'test',tool:'read',argumentsJson:'{}'});assert.equal(actor,'viewer');delete globalThis.toolboxTest;
});
