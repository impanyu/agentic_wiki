import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';import {z} from 'zod';
const strip=p=>readFileSync(p,'utf8').replace(/^import .*;$/gm,'');
globalThis.draftZod=z;
const files=['app/page-programs/custom-style.ts','app/page-programs/visual-style.ts','app/page-programs/generation-intent.ts','app/disambiguation/index.ts','app/components-registry/contracts.ts','app/components-registry/chart-contracts.ts','app/page-programs/inputs.ts','app/sandboxes/contracts.ts','app/page-programs/generation-draft.ts'];
// Keep schema names local to each source module through separate imports.
const load=async s=>import('data:text/javascript;base64,'+Buffer.from(ts.transpile(s,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
const style=await load('const z=globalThis.draftZod;\n'+strip(files[0])+'\n'+strip(files[1])+'\n'+strip(files[2]));
const contracts=await load('const z=globalThis.draftZod;\n'+strip(files[4]));const chart=await load('const z=globalThis.draftZod;\n'+strip(files[5]));const sandbox=await load('const z=globalThis.draftZod;\n'+strip(files[7]));const index=await load('const z=globalThis.draftZod;\n'+strip(files[3]));const inputs=await load('const z=globalThis.draftZod;\n'+strip(files[6]));
const scope=await load(strip('app/storage/page-scope.ts'));
globalThis.draftDeps={z,requestsDataResult:scope.requestsDataResult,...style,...contracts,...chart,...sandbox,...index,...inputs,namedConnectors:q=>/adma/i.test(q)?['adma']:[],pageStorageProviders:q=>/adma/i.test(q)?[]:['google'],sandboxStatus:()=>({configured:true,allowed:true})};
const m=await load('const {'+Object.keys(globalThis.draftDeps).join(',')+'}=globalThis.draftDeps;\n'+strip(files[8]));
const intent={subject:'Topic',subjectType:'concept',goal:'Understand it',explicitConstraints:[],assumptions:[],uncertainties:[],mustCover:['Explain'],sourceRequirements:[],outputKind:'article',service:'none',fresh:false,needsDisambiguation:false,singleMeaningCertain:true,interpretations:['Topic']};
const base={kind:'article',title:'Topic',summary:'Summary',body:'A substantive article with verified sources explaining the requested subject in enough detail for a useful introduction.',sources:[{title:'Source',url:'https://example.org/topic'}],labels:{overview:'Overview',invalid:'Try again'},intent};
const ctx={userId:'u',ownerId:'u',language:'en',visibility:'private'};
test('generation validates evidence, ambiguity and source URL identity before saving',()=>{
 assert.throws(()=>m.validateGenerationDraft(base,'Topic',ctx,false),/web search/);
 assert.equal(m.validateGenerationDraft(base,'Topic',ctx,true).kind,'article');
 assert.throws(()=>m.validateGenerationDraft({...base,intent:{...intent,interpretations:['Country','Porcelain']}},'china',ctx,true),/disambiguation/);
 assert.throws(()=>m.validateGenerationDraft(base,'https://source.test', {...ctx,sourceDocument:{url:'https://source.test'}},true),/supplied document/);
 assert.throws(()=>m.validateGenerationDraft({...base,kind:'disambiguation',entries:[{question:'china',description:'Country',group:''},{question:'Porcelain',description:'Material',group:''}]},'china',ctx,true),/unambiguous/);
});
test('ADMA cannot become a Google Drive browser and expression examples are checked',()=>{
 assert.equal(m.validateGenerationDraft({...base,kind:'files'},'list my adma files',ctx,false).kind,'files');
 const form={kind:'form',submit:'Calculate',fields:[{name:'x',label:'X',type:'number',default:null}],outputs:[{name:'double',label:'Double'}]};
 const d={...base,kind:'form',form,expression:{kind:'expression-program',outputs:{double:{op:'multiply',args:[{input:'x'},2]}}},examples:[{input:{x:3},output:{double:6}}]};
 assert.equal(m.validateGenerationDraft(d,'Double a number',ctx,false).kind,'form');
 assert.throws(()=>m.validateGenerationDraft({...d,examples:[{input:{x:3},output:{double:9}}]},'Double',ctx,false),/example failed/);
});
test('native apps materialize reusable implementations without generated backend code',async()=>{
 for(const nativeApp of ['map','table','json','text','image','pdf','archive','hub']){const draft=m.validateGenerationDraft({...base,kind:'native',nativeApp},'Open data tools',ctx,false),result=await m.materializeGenerationDraft(draft,ctx);assert.equal(result.definition.config.template,'native-app-v1');assert.equal(result.definition.config.nativeApp,nativeApp);assert.equal(result.templateId,nativeApp==='map'?'geo-v1':'data-tools-v1');assert.deepEqual(result.definition.components,[]);}
 assert.throws(()=>m.validateGenerationDraft({...base,kind:'native'},'Tools',ctx,false),/nativeApp/);
});

test('connector plots reject browser substitutes and accept consulted file data without web search',()=>{
 const question='the temperature plot 9/1/2026 on adma realm5';
 assert.throws(()=>m.validateGenerationDraft({...base,kind:'files'},question,ctx,true),/file browser cannot/);
 const draft={...base,kind:'chart',chart:{kind:'chart',xLabel:'Time',unit:'°C',series:[{key:'temperature',label:'Temperature'}],labels:{line:'Line',bar:'Bar',data:'Data',download:'Download'}},dataset:{rows:[{x:'2026-09-01T12:00:00Z',values:{temperature:21},sources:[1]}],sources:[{title:'Realm5 observations',url:'https://adma.aisoup.net/'}],notes:'Fixture observations'}};
 assert.throws(()=>m.validateGenerationDraft(draft,question,ctx,false,false),/Read the chart observations/);
 assert.equal(m.validateGenerationDraft(draft,question,ctx,false,true).kind,'chart');
});
