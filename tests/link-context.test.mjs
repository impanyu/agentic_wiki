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
 accessible=false;await assert.rejects(m.contextualLinkQuestion('Transmission',origin,'other'),/UNAVAILABLE/);accessible=true;
});
test('stale or forged link ranges fail closed',()=>{
 assert.throws(()=>m.linkContext(page,{quote:'Other',segments:origin.highlight.segments}),/CHANGED/);
 assert.throws(()=>m.linkContext(page,{quote:'Transmission',segments:[{node:'line1.0',start:0,end:1000}]}),/CHANGED/);
});
