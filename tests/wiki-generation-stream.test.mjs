import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';
test('first drafts and revisions deliver article text before generation completes',async()=>{
 const source=readFileSync('app/api/ask/ai.ts','utf8');const code=source.slice(source.indexOf('export async function streamResearchAttempt'),source.indexOf('export async function research('));
 const {run}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile('export function run(streamArticle){'+code.replace('export async','async')+'return streamResearchAttempt}',{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
 for(const revising of [false,true]){
  let finish;const gate=new Promise(r=>finish=r),events=[];
  const stream=run(async(request,emit)=>{emit({type:'delta',text:'## Geography\n'});await gate;emit({type:'delta',text:'First paragraph.'});return {complete:true};});
  const result=stream({},e=>events.push(e),undefined,revising);await Promise.resolve();assert.equal(events.length,1);assert.equal(events[0].text,'## Geography\n');assert.equal(events[0].type,revising?'replace':'delta');finish();await result;assert.equal(events[1].text,revising?'## Geography\nFirst paragraph.':'First paragraph.');
 }
 assert.match(source,/result=emit\?await streamResearchAttempt/);
});
