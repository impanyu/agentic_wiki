import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';import {z} from 'zod';
const source=readFileSync('app/disambiguation/index.ts','utf8').replace(/import [\s\S]*?from ['"][^'"]+['"];?/g,'');
test('disambiguation creates precise destinations and upgrades an owned page in place',async()=>{
 let page={id:'p',owned:true,kind:'static',title:'Party',summary:'old',body:'old',labels:{},visibility:'private'},writes=0;
 const result={needed:true,title:'Party',summary:'Choose a meaning.',entries:[{question:'Political party',description:'An electoral organization.',group:'Politics'},{question:'Party (law)',description:'A participant in proceedings.',group:'Law'},{question:'party',description:'Do not self-link.',group:''},{question:'Party (law)',description:'Duplicate.',group:'Law'}]};
 globalThis.indexTest={z,askAgent:async()=>result,database:()=>({prepare(sql){return {bind(...args){return {sql,args,all:async()=>({results:[]})};}};},batch:async stmts=>{assert.equal(stmts.length,1);const s=stmts[0];assert.ok(!s.sql.includes('questions'));assert.ok(!s.sql.includes('visibility='));writes++;page={...page,title:s.args[0],summary:s.args[1],body:s.args[2],labels:JSON.parse(s.args[5])};}}),getPage:async()=>page,lock:async()=>'lease',unlock:async()=>{},relocateQuote:()=>[]};
 const m=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile('const {'+Object.keys(globalThis.indexTest).join(',')+'}=globalThis.indexTest;\n'+source,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
 const index=await m.classifyAmbiguity('party','en',{});assert.equal(index.entries.length,2);const updated=await m.upgradeIndex(page,index,'owner');assert.equal(updated.id,'p');assert.equal(updated.visibility,'private');assert.equal(updated.labels.templateId,'disambiguation-v1');assert.equal(writes,1);
 await m.upgradeIndex(updated,index,'owner');assert.equal(writes,1);assert.equal(await m.upgradeIndex({...updated,owned:false},index,'other'),null);delete globalThis.indexTest;
});

test('first-time ambiguity favors an index for multiple interpretations or unresolved doubt',async()=>{
 let response;
 globalThis.ambiguityDecisionTest={z,askAgent:async()=>response};
 const m=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile('const {z,askAgent}=globalThis.ambiguityDecisionTest;\n'+source,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
 response={needed:false,singleMeaningCertain:true,interpretations:['China (country)','Porcelain']};
 assert.equal(await m.needsDisambiguation('china','en',{}),true,'multiple interpretations override an inconsistent negative decision');
 response={needed:false,singleMeaningCertain:false,interpretations:['Java']};
 assert.equal(await m.needsDisambiguation('How old is Java?','en',{}),true,'uncertainty must not silently choose a meaning');
 response={needed:false,singleMeaningCertain:true,interpretations:["People’s Republic of China"]};
 assert.equal(await m.needsDisambiguation("People’s Republic of China",'en',{}),false,'a qualified clear subject remains an article');
 response={needed:false};
 await assert.rejects(()=>m.needsDisambiguation('china','en',{}),'malformed decisions must not default to an article');
 response={needed:false,title:'China',summary:'Country',entries:[]};
 await assert.rejects(()=>m.classifyAmbiguity('china','en',{},true),/DISAMBIGUATION_INCOMPLETE/,'generation must not reverse a required index decision');
 response={needed:true,title:'China',summary:'Choose a meaning',entries:[{question:'China (country)',description:'The country',group:'Places'},{question:'Porcelain',description:'Ceramic material',group:'Materials'}]};
 assert.equal((await m.classifyAmbiguity('china','en',{},true)).entries.length,2);
 delete globalThis.ambiguityDecisionTest;
});

test('index generation repairs duplicate destinations and carries router interpretations',async()=>{
 const calls=[],interpretations=['China (country)','Porcelain'];
 const good={needed:true,title:'China',summary:'Choose a meaning',entries:[{question:'China (country)',description:'Country',group:'Places'},{question:'Porcelain',description:'Ceramic material',group:'Materials'}]};
 const duplicate={...good,entries:[good.entries[0],good.entries[0]]};
 globalThis.indexRepairTest={z,askAgent:async(_agent,instructions,task,schema,signal)=>{calls.push({instructions,task,schema,signal});return calls.length===1?duplicate:good;}};
 const m=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile('const {z,askAgent}=globalThis.indexRepairTest;\n'+source,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
 assert.equal((await m.classifyAmbiguity('china','en',{},true,interpretations)).entries.length,2);
 assert.equal(calls.length,2);
 assert.deepEqual(calls[0].task.interpretations,interpretations);
 assert.deepEqual(calls[0].schema.properties.needed.enum,[true]);
 assert.equal(calls[0].schema.properties.entries.minItems,2);
 assert.ok(calls[1].task.correction);
 assert.equal(calls[0].signal,calls[1].signal,'repair shares the same time budget');
 const controller=new AbortController();controller.abort();
 await assert.rejects(()=>m.classifyAmbiguity('china','en',{},true,interpretations,controller.signal),{name:'AbortError'});
 assert.equal(calls.length,2,'cancellation must not start another model call');
 delete globalThis.indexRepairTest;
});
