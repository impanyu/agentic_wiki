import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';import {z} from 'zod';
const strip=p=>readFileSync(p,'utf8').replace(/^import .*;$/gm,'');
const load=async s=>import('data:text/javascript;base64,'+Buffer.from(ts.transpile(strip('app/page-permissions.ts')+'\n'+s,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
globalThis.patchZod=z;const patches=await load('const z=globalThis.patchZod;\n'+strip('app/chat/wiki-patches.ts'));globalThis.directPatches=patches;
let fixture=0;
async function editor(page,drafts,confirmed=false){
 let calls=0,agentCalls=0,feedback=[];
 globalThis.wikiDirect={unreachableImages:async()=>[],readAppDraft:async()=>null,appEditCapabilities:()=>({}),discardAppDraft:async()=>{},getPage:async()=>page,readEditDraft:async()=>null,discardEditDraft:async()=>{},stageEdit:async(a,p,d)=>({id:'preview',...d}),confirmsEditOffer:()=>confirmed,output:r=>r.text,askAgent:async(a,i,t,s,signal,onReply,files,options)=>{agentCalls++;for(const d of drafts){calls++;const error=await options.validateFinal({text:JSON.stringify(d)});if(!error)return d;feedback.push(error);}throw Error('No valid draft');}};
 const m=await load('const {wikiEditSchema,wikiEditFormat,applyWikiPatches}=globalThis.directPatches;const {'+Object.keys(globalThis.wikiDirect).join(',')+'}=globalThis.wikiDirect;\n'+strip('app/chat/edit-page.ts')+'\n//fixture '+(++fixture));
 return {run:()=>m.editWiki(page,'request',{},'owner',{}),stats:()=>({calls,agentCalls,feedback})};
}
const proposal=(edits,extra={})=>({apply:true,discard:false,reply:'Review changes and click Save changes.',title:null,summary:null,edits,...extra});
test('image append patches preserve the entire long article without a preliminary image planner',async()=>{
 const page={id:'p',kind:'static',owned:true,title:'India',language:'en',summary:'Summary',body:'Existing article. '.repeat(4000),sources:[]};
 const image='![India](https://example.test/map.png)\n[Author · CC BY-SA](https://example.test/source)\n\n';
 const e=await editor(page,[proposal([{operation:'prepend',oldText:'',newText:image}])]);const r=await e.run();assert.equal(r.editDraft.body,image+page.body);assert.equal(page.body,'Existing article. '.repeat(4000));assert.equal(e.stats().agentCalls,1);
});
test('invalid patches return feedback inside one agent call and preserve untouched content',async()=>{
 const page={id:'p',kind:'static',owned:true,title:'India',language:'en',summary:'Summary',body:'Saved map\nGeography',sources:[]};
 const e=await editor(page,[proposal([{operation:'replace',oldText:'missing',newText:'Updated'}]),proposal([{operation:'replace',oldText:'Geography',newText:'Updated geography'}],{summary:'Updated overview'})]);
 const r=await e.run();assert.equal(e.stats().agentCalls,1);assert.equal(e.stats().calls,2);assert.equal(e.stats().feedback.length,1);assert.equal(r.editDraft.body,'Saved map\nUpdated geography');assert.equal(r.editDraft.summary,'Updated overview');
});
test('confirmed edit offers become a concrete preview within the same loop',async()=>{
 const page={id:'p',kind:'static',owned:true,title:'India',language:'en',summary:'Overview',body:'Saved article',sources:[]};
 const e=await editor(page,[proposal([],{apply:false,reply:'I can prepare it.'}),proposal([],{summary:'Updated overview'})],true);const r=await e.run();assert.equal(e.stats().agentCalls,1);assert.equal(e.stats().calls,2);assert.equal(r.editDraft.summary,'Updated overview');assert.match(r.reply,/Save changes/);
});
test('overview replacements update the summary without touching the article',()=>{const base={title:'India',summary:'India is in South Asia.',body:'Saved map and article'};const d=proposal([{operation:'replace',oldText:base.summary,newText:'New overview'}],{summary:'New overview'});const r=patches.applyWikiPatches(base,d);assert.equal(r.summary,'New overview');assert.equal(r.body,base.body);});
test('disambiguation edits update the visible index instead of hidden body text',async()=>{
 const original=[{question:'Japanese orange fly',description:'A fruit fly.',group:'Insects'},{question:'Orange fishing fly',description:'A fishing lure.',group:'Fishing'}],added={question:'Orange fly (橙飞一下)',description:'A Chinese food-content creator.',group:'People'};
 const page={id:'p',kind:'static',owned:true,title:'Orange fly',language:'en',summary:'Several meanings.',body:'Hidden index body',sources:[],labels:{templateId:'disambiguation-v1',indexEntries:original}};
 const e=await editor(page,[proposal([],{indexEntries:[...original,added]})]);const r=await e.run();assert.deepEqual(r.editDraft.indexEntries,[...original,added]);assert.equal(r.editDraft.body,page.body);
});
