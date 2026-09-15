import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';import {z} from 'zod';
const load=async s=>import('data:text/javascript;base64,'+Buffer.from(ts.transpile(s,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));const strip=p=>readFileSync(p,'utf8').replace(/^import .*;$/gm,'');
globalThis.testZod=z;const patches=await load('const z=globalThis.testZod;\n'+strip('app/chat/wiki-patches.ts'));globalThis.testWikiPatches=patches;
test('map selection excludes photos and inserts the selected file and attribution instead of editor URLs',async()=>{
 const map={id:2,url:'https://upload.wikimedia.org/India_map.png',source:'https://commons.wikimedia.org/wiki/File:India_location_map.svg',description:'Location map of India',credit:'Author · CC BY-SA'},photo={...map,id:1,url:'https://upload.wikimedia.org/Temple.png',source:'https://commons.wikimedia.org/wiki/File:Temple.jpg',description:'Temple in India'};let calls=0;
 globalThis.editImages={askAgent:async(a,i,task)=>{if(++calls===1)return {query:'India location map',kind:'map'};assert.deepEqual(task.candidates.map(c=>c.id),[2]);return {id:2,caption:'Map of India'};},findIllustrations:async()=>[photo,map]};
 const resources=await load('const confirmsEditOffer=()=>false;const {askAgent,findIllustrations}=globalThis.editImages;\n'+strip('app/chat/edit-resources.ts'));
 const page={id:'p',kind:'static',owned:true,title:'India',summary:'Summary',body:'Existing prose',sources:[]};const images=await resources.editResources(page,'show a map',{},{});assert.equal(images[0].id,2);
 globalThis.editImages={z,...resources,editResources:async()=>images,getPage:async()=>page,readEditDraft:async()=>null,discardEditDraft:async()=>{},stageEdit:async(a,p,d)=>d,askAgent:async()=>({apply:true,discard:false,reply:'Review the proposal',title:'India',summary:'Summary',edits:[{operation:'prepend',oldText:'',newText:'![Map](https://upload.wikimedia.org/Temple.png)\n[credit](https://example.test)\n\n'}]})};
 const {editWiki}=await load('const {z,editResources,imageMarkdown,getPage,readEditDraft,discardEditDraft,stageEdit,askAgent}=globalThis.editImages;\n'+'const {wikiEditSchema,wikiEditFormat,applyWikiPatches}=globalThis.testWikiPatches;\n'+strip('app/chat/edit-page.ts'));
 const result=await editWiki(page,'show a map',{},'owner',{});assert.match(result.editDraft.body,/India_map.png/);assert.doesNotMatch(result.editDraft.body,/Temple.png/);assert.match(result.editDraft.body,/Author · CC BY-SA/);assert.match(result.editDraft.body,/Existing prose/);delete globalThis.editImages;
});
test('image-only edits preserve long articles without asking the model to rewrite them',async()=>{
 const page={id:'long',kind:'static',owned:true,title:'India',language:'en',summary:'Summary',body:'Existing article. '.repeat(4000),sources:[]};let streamed='';
 globalThis.imageOnlyTest={z,getPage:async()=>page,readEditDraft:async()=>null,discardEditDraft:async()=>{},stageEdit:async(a,p,d)=>d,askAgent:async()=>{throw Error('Must not rewrite article');},editResources:async(p,m,c,a,s,onPlan)=>{onPlan(true);return [{url:'https://example.test/map.png'}];},imageMarkdown:()=> '![India](https://example.test/map.png)'};
 const {editWiki}=await load('const {z,getPage,readEditDraft,discardEditDraft,stageEdit,askAgent,editResources,imageMarkdown}=globalThis.imageOnlyTest;\n'+'const {wikiEditSchema,wikiEditFormat,applyWikiPatches}=globalThis.testWikiPatches;\n'+strip('app/chat/edit-page.ts'));
 const r=await editWiki(page,'add a map',{},'owner',{},text=>{streamed=text});assert.equal(r.editDraft.body,'![India](https://example.test/map.png)\n\n'+page.body);assert.match(streamed,/Save changes/);delete globalThis.imageOnlyTest;
});
test('general edits repair invalid patches once and preserve untouched content',async()=>{
 const page={id:'p',kind:'static',owned:true,title:'India',summary:'Summary',body:'Saved map\nGeography',language:'en',sources:[]};let calls=0;
 globalThis.generalPatchTest={getPage:async()=>page,editResources:async()=>[],imageMarkdown:()=>'',readEditDraft:async()=>null,discardEditDraft:async()=>{},stageEdit:async(a,p,d)=>d,askAgent:async()=>({apply:true,discard:false,reply:'Review changes',title:null,summary:'Updated overview',edits:[{operation:'replace',oldText:++calls===1?'missing':'Geography',newText:'Updated geography'}]})};
 const {editWiki}=await load('const {wikiEditSchema,wikiEditFormat,applyWikiPatches}=globalThis.testWikiPatches;const {getPage,editResources,imageMarkdown,readEditDraft,discardEditDraft,stageEdit,askAgent}=globalThis.generalPatchTest;\n'+strip('app/chat/edit-page.ts'));
 const result=await editWiki(page,'update',{},'owner',{});assert.equal(calls,2);assert.equal(result.editDraft.body,'Saved map\nUpdated geography');assert.equal(result.editDraft.summary,'Updated overview');
});
test('confirmed editing requests cannot finish with another offer to prepare a patch',async()=>{
 const page={id:'p',kind:'static',owned:true,title:'India',summary:'Overview',body:'Saved map and article',language:'en',sources:[]};let calls=0;
 globalThis.confirmedEditTest={getPage:async()=>page,editResources:async(p,m,c,a,s,plan)=>{plan(false,true);return []},imageMarkdown:()=>'',readEditDraft:async()=>null,discardEditDraft:async()=>{},stageEdit:async(a,p,d)=>d,askAgent:async()=>({apply:++calls>1,discard:false,reply:'If you want, I can prepare the patch now.',title:null,summary:calls>1?'Overview with area':null,edits:[]})};
 const {editWiki}=await load('const {wikiEditSchema,wikiEditFormat,applyWikiPatches}=globalThis.testWikiPatches;const {getPage,editResources,imageMarkdown,readEditDraft,discardEditDraft,stageEdit,askAgent}=globalThis.confirmedEditTest;\n'+strip('app/chat/edit-page.ts'));
 const r=await editWiki(page,'yes',{},'owner',{});assert.equal(calls,2);assert.equal(r.editDraft.summary,'Overview with area');assert.equal(r.editDraft.body,page.body);assert.doesNotMatch(r.reply,/If you want|patch/);assert.match(r.reply,/Save changes/);
});
test('overview replacements are resolved to the overview instead of failing against the body',()=>{
 const base={title:'India',summary:'India is in South Asia.',body:'Saved map and article'};
 const d={apply:true,discard:false,reply:'Ready',title:null,summary:'India is in South Asia. Area added.',edits:[{operation:'replace',oldText:base.summary,newText:'India is in South Asia. Area added.'}]};
 const result=patches.applyWikiPatches(base,d);assert.equal(result.summary,d.summary);assert.equal(result.body,base.body);
});
