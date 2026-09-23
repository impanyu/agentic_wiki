import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';import {z} from 'zod';
const strip=p=>readFileSync(p,'utf8').replace(/^import .*;$/gm,'');
const page={title:'Malaria',summary:'An infectious disease',body:'## Transmission\nTransmission occurs through mosquitoes.'};
let accessible=true,request,result;
globalThis.linkFixture={z,getPage:async()=>accessible?page:null,model:()=> 'routing-model',api:async(_,p)=>{request=p;return {};},output:()=>JSON.stringify(result)};
const source='const {z,getPage,model,api,output}=globalThis.linkFixture;\n'+strip('app/internal-links.ts')+'\n'+strip('app/routing/link-context.ts');
const m=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile(source,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
const origin={pageId:'11111111-1111-4111-8111-111111111111',highlight:{quote:'Transmission',segments:[{node:'line1.0',start:0,end:12}]}};
test('link resolution uses authenticated source and local passage only when needed',async()=>{
 result={needsContext:true,question:'Malaria transmission'};
 assert.equal(await m.contextualLinkQuestion('Transmission',origin,'user'),'Malaria transmission');
 assert.match(JSON.parse(request.input).context.passages,/mosquitoes/);
 result={needsContext:false,question:'Unwanted rewrite'};
 assert.equal(await m.contextualLinkQuestion('Transmission',origin,'user'),'Transmission');
 // A standalone proper name is never turned into a relation with the page subject.
 result={standalone:true,needsContext:true,question:'India-Pakistan border'};
 assert.equal(await m.contextualLinkQuestion('Transmission',origin,'user'),'Transmission');
 result={standalone:false,needsContext:true,question:'India-Pakistan border'};
 assert.equal(await m.contextualLinkQuestion('Transmission',origin,'user'),'Transmission');
 assert.match(request.instructions,/Pakistan inside an India article -> Pakistan/);
 assert.equal(request.reasoning.effort,'low');
 accessible=false;await assert.rejects(m.contextualLinkQuestion('Transmission',origin,'other'),/UNAVAILABLE/);accessible=true;
});
test('the root router receives a self-contained article-link question only when the visible text needs it',async()=>{
 result={needsContext:true,question:'Malaria transmission'};
 assert.equal(await m.contextualLinkQuestion('Transmission',origin,'user'),'Malaria transmission');
 assert.match(request.instructions,/independently sufficient/);
 assert.match(request.instructions,/root router/);
 result={needsContext:false,question:'Malaria World Health Organization'};
 const originalBody=page.body;page.body='## Organizations\nWorld Health Organization publishes guidance.';
 assert.equal(await m.contextualLinkQuestion('World Health Organization',{...origin,highlight:{quote:'World Health Organization',segments:[{node:'line1.0',start:0,end:25}]}},'user'),'World Health Organization');
 page.body=originalBody;
});
test('stale or forged link ranges fail closed',()=>{
 assert.throws(()=>m.linkContext(page,{quote:'Other',segments:origin.highlight.segments}),/CHANGED/);
 assert.throws(()=>m.linkContext(page,{quote:'Transmission',segments:[{node:'line1.0',start:0,end:1000}]}),/CHANGED/);
});

test('index navigation includes the validated entry description and rejects stale entries',async()=>{
 page.labels={templateId:'disambiguation-v1',indexEntries:[{question:'Transmission',description:'How malaria spreads',group:'Malaria'}]};
 result={needsContext:true,question:'Malaria transmission'};
 assert.equal(await m.contextualLinkQuestion('Transmission',{pageId:origin.pageId,kind:'index'},'user'),'Malaria transmission');
 assert.match(JSON.parse(request.input).context.passages,/How malaria spreads/);
 await assert.rejects(()=>m.contextualLinkQuestion('Different',{pageId:origin.pageId,kind:'index'},'user'),/CHANGED/);
});
test('chat page links carry the surrounding reply while standalone wording remains unchanged',async()=>{
 result={needsContext:false,question:'Ignore this rewrite'};
 assert.equal(await m.contextualLinkQuestion('Malaria',{pageId:origin.pageId,kind:'chat',passage:'Read more about malaria transmission.'},'user'),'Malaria');
 assert.match(JSON.parse(request.input).context.passages,/malaria transmission/);
 accessible=false;await assert.rejects(()=>m.contextualLinkQuestion('Malaria',{pageId:origin.pageId,kind:'chat',passage:'text'},'other'),/UNAVAILABLE/);accessible=true;
});
