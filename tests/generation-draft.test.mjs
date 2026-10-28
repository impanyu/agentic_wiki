import './edition-globals.mjs';import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';import {z} from 'zod';
const strip=p=>readFileSync(p,'utf8').replace(/^import .*;$/gm,'');
globalThis.draftZod=z;
const files=['app/page-programs/custom-style.ts','app/page-programs/visual-style.ts','app/page-programs/generation-intent.ts','app/disambiguation/index.ts','app/components-registry/contracts.ts','app/components-registry/chart-contracts.ts','app/page-programs/inputs.ts','app/sandboxes/contracts.ts','app/page-programs/generation-draft.ts'];
// Keep schema names local to each source module through separate imports.
const load=async s=>import('data:text/javascript;base64,'+Buffer.from(ts.transpile(s,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
const style=await load('const z=globalThis.draftZod;\n'+strip(files[0])+'\n'+strip(files[1])+'\n'+strip(files[2]));
const contracts=await load('const z=globalThis.draftZod;\n'+strip(files[4]));const chart=await load('const z=globalThis.draftZod;\n'+strip(files[5]));const sandbox=await load('const z=globalThis.draftZod;\n'+strip(files[7]));const index=await load('const z=globalThis.draftZod;\n'+strip(files[3]));const inputs=await load('const z=globalThis.draftZod;\n'+strip(files[6]));
const scope=await load(strip('app/storage/page-scope.ts'));
const frontend=await load('const z=globalThis.draftZod;\n'+strip('app/components-registry/sandbox-contracts.ts'));
globalThis.draftFrontend=frontend;const pageCode=await load('const z=globalThis.draftZod;const {sandboxSchema,sandboxShape,sandboxSizeCheck}=globalThis.draftFrontend;\n'+strip('app/page-programs/page-code.ts'));
globalThis.draftDeps={z,...frontend,...pageCode,requestsDataResult:scope.requestsDataResult,...style,...contracts,...chart,...sandbox,...index,...inputs,namedConnectors:q=>/slack/i.test(q)?['slack']:[],pageStorageProviders:q=>/slack/i.test(q)?[]:['google'],sandboxStatus:()=>({configured:true,allowed:true}),assertWorkflow:w=>({workflow:{...w,checked:true}})};
const m=await load('const {'+Object.keys(globalThis.draftDeps).join(',')+'}=globalThis.draftDeps;\n'+strip(files[8]));
const intent={subject:'Topic',subjectType:'concept',goal:'Understand it',explicitConstraints:[],assumptions:[],uncertainties:[],mustCover:['Explain'],sourceRequirements:[],outputKind:'article',service:'none',fresh:false,needsDisambiguation:false,singleMeaningCertain:true,interpretations:['Topic']};
const base={kind:'article',title:'Topic',summary:'Summary',body:'A substantive article with verified sources explaining the requested subject in enough detail for a useful introduction.[1]',sources:[{title:'Source',url:'https://example.org/topic'}],labels:{overview:'Overview',invalid:'Try again'},intent};
const ctx={userId:'u',ownerId:'u',language:'en',visibility:'private'};
test('generation validates evidence, ambiguity and source URL identity before saving',()=>{
 assert.throws(()=>m.validateGenerationDraft(base,'Topic',ctx,false),/web search/);
 assert.equal(m.validateGenerationDraft(base,'Topic',ctx,true).kind,'article');
 assert.throws(()=>m.validateGenerationDraft({...base,intent:{...intent,interpretations:['Country','Porcelain']}},'china',ctx,true),/disambiguation/);
 assert.throws(()=>m.validateGenerationDraft(base,'https://source.test', {...ctx,sourceDocument:{url:'https://source.test'}},true),/supplied document/);
 assert.throws(()=>m.validateGenerationDraft({...base,kind:'disambiguation',entries:[{question:'china',description:'Country',group:''},{question:'Porcelain',description:'Material',group:''}]},'china',ctx,true),/unambiguous/);
});
test('the wiki edition accepts only wiki pages',()=>{
 for(const kind of ['files','native','chart','chat','form','converter','index','workflow','program'])assert.throws(()=>m.validateGenerationDraft({...base,kind},'An app',ctx,true),/only wiki pages/,kind);
 assert.equal(m.validateGenerationDraft(base,'Topic',{...ctx,pageIntent:'chart'},true).kind,'article');
 assert.equal(m.validateGenerationDraft({...base,intent:{...base.intent,outputKind:'application',service:'none'}},'Mortgage calculator',ctx,true).intent.outputKind,'article');
 const interactive={kind:'sandbox-app',html:'<button>Explore</button>',css:'',javascript:'',height:400};
 assert.throws(()=>m.validateGenerationDraft({...base,interactive},'Explain with an interactive example',ctx,true),/no longer accepted/);
});

test('wiki articles can rely on authorized connector evidence without public web search',()=>{
 assert.equal(m.validateGenerationDraft(base,'Explain the connected workspace document',{...ctx,pageIntent:'article'},false,true).kind,'article');
 assert.throws(()=>m.validateGenerationDraft(base,'Explain the document',ctx,false,false),/Research the reference subject/);
 assert.throws(()=>m.validateGenerationDraft({...base,sources:[]},'Explain the document',ctx,false,true),/cited sources/);
});
test('paper articles reuse the pre-coded reader while remaining editable static wiki pages',async()=>{
 const draft=m.validateGenerationDraft({...base,templateId:'paper-v1'},'Read this research paper',ctx,true);
 const result=await m.materializeGenerationDraft(draft,ctx);
 assert.equal(result.templateId,'paper-v1');assert.equal(result.definition,undefined);
});

test('articles must cite their sources inline, not only list them',()=>{
 const two=[{title:'A',url:'https://example.org/a'},{title:'B',url:'https://example.org/b'}];
 const body='A substantive article with verified sources explaining the requested subject in enough detail for a useful introduction.';
 assert.throws(()=>m.validateGenerationDraft({...base,sources:two,body},'Topic',ctx,true),/Cite the sources inline/);
 assert.throws(()=>m.validateGenerationDraft({...base,sources:two,body:body+'[1]'},'Topic',ctx,true),/Currently 1 cited/);
 assert.equal(m.validateGenerationDraft({...base,sources:two,body:body+'[1] More detail follows here.[2]'},'Topic',ctx,true).kind,'article');
 assert.equal(m.validateGenerationDraft({...base,sources:two,body:body+' See [the report](https://example.org/b).[1]'},'Topic',ctx,true).kind,'article');
 // An image credit link does not count as a citation.
 assert.throws(()=>m.validateGenerationDraft({...base,sources:two,body:'![x](https://example.org/i.png)\n[credit](https://example.org/a)\n\n'+body+'[2]'},'Topic',ctx,true),/Currently 1 cited/);
});
test('requests for the user own pages are recognised and must become a live index',()=>{
 for(const q of ['my recent visited pages about history','pages I visited about history','history pages I have viewed recently','我最近看过的历史页面','articles I wrote in 2025'])assert.equal(m.ownPagesRequest(q),true,q);
 for(const q of ['history of Rome','pages about history','file transfer dashboard','how to read pages quickly'])assert.equal(m.ownPagesRequest(q),false,q);
});
