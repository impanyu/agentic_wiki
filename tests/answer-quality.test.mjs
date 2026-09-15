import test from 'node:test';import assert from 'node:assert/strict';import ts from 'typescript';import {readFileSync} from 'node:fs';
const evidence={subjectAligned:true,scopeCovered:true,supportingBlockId:0,requiresFigures:false,figuresBlockId:-1};let verdict={...evidence,complete:true,current:true},searched=true,request;
globalThis.__qualityApi=async(path,body)=>{request=body;return {output:searched?[{type:'web_search_call',status:'completed'}]:[],verdict};};
const source=readFileSync('app/api/ask/answer-quality.ts','utf8').replace("import {api,output} from './ai';","const api=(...args)=>globalThis.__qualityApi(...args);const output=r=>JSON.stringify(r.verdict);").replace("import {model} from '@/db/store';","const model=()=> 'test-model';");
const {answerIsComplete}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile(source,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
const page={body:'A number and dated source',sources:[{title:'Official source',url:'https://example.org'}]};
test('current requests require live search evidence and a current complete answer',async()=>{assert.equal(await answerIsComplete('current GDP',page,true),true);assert.equal(request.tool_choice,'required');assert.equal(request.tools[0].type,'web_search');assert.ok(JSON.parse(request.input).asOf);searched=false;assert.equal(await answerIsComplete('current GDP',page,true),false);searched=true;verdict={...evidence,complete:true,current:false};assert.equal(await answerIsComplete('current GDP',page,true),false);});
test('conceptual answers need completeness without forced live data; offers are rejected by verdict',async()=>{verdict={...evidence,complete:true,current:false};assert.equal(await answerIsComplete('What is GDP?',page,false),true);assert.equal(request.tools,undefined);verdict={...evidence,complete:false,current:true};assert.equal(await answerIsComplete('current GDP',{body:'I can look it up for you.',sources:[{title:'Source',url:'https://example.org'}]},true),false);});
test('reviewer cannot fill a saved answer with numbers found elsewhere',async()=>{verdict={...evidence,complete:true,current:true,requiresFigures:true,figuresBlockId:42};assert.equal(await answerIsComplete('current GDP',page,true),false);verdict={...evidence,complete:true,current:true,supportingBlockId:99};assert.equal(await answerIsComplete('current GDP',page,true),false);});

test('existing numeric paragraphs are valid evidence without copying their formatting',async()=>{verdict={subjectAligned:true,scopeCovered:true,complete:true,current:true,supportingBlockId:0,requiresFigures:true,figuresBlockId:1};assert.equal(await answerIsComplete('current GDP',{body:'Latest official figures follow.\n\n**GDP:** 12.34 trillion units; growth 5.6%.',sources:page.sources},true),true);assert.equal(await answerIsComplete('current GDP',{body:'Latest official figures follow.\n\nPublished in 2026: [source](https://example.org/123456)',sources:page.sources},true),false);});

test('a supporting paragraph and complete=true cannot override wrong subject or narrow coverage',async()=>{const visit={title:'习近平访印事实',summary:'A diplomatic visit',body:'习近平于2014年9月访问印度，双方签署合作文件。',sources:page.sources};verdict={...evidence,complete:true,current:true,subjectAligned:false,scopeCovered:false,reason:'Visit event is not a country overview.'};assert.equal(await answerIsComplete('印度',visit,false),false);verdict={...verdict,subjectAligned:true};assert.equal(await answerIsComplete('印度',visit,false),false);assert.equal(JSON.parse(request.input).question,'印度');assert.equal(JSON.parse(request.input).answer.body,visit.body);});

test('new-page requirements each need actual article evidence even with a positive overall verdict',async()=>{
 const intent={mustCover:['Identify the paper','Describe experiments']};
 const paper={body:'This paragraph identifies the original paper.\n\nThis paragraph describes its experiments and limitations.',sources:page.sources};
 verdict={...evidence,complete:true,current:true,requirements:[{index:0,blockIds:[0]}]};
 assert.equal(await answerIsComplete('Named paper',paper,false,undefined,intent),false);
 assert.deepEqual(JSON.parse(request.input).generationIntent,intent);
 verdict.requirements.push({index:1,blockIds:[99]});
 assert.equal(await answerIsComplete('Named paper',paper,false,undefined,intent),false);
 verdict.requirements[1].blockIds=[1];
 assert.equal(await answerIsComplete('Named paper',paper,false,undefined,intent),true);
});
