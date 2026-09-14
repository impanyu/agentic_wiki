import {test} from 'node:test';import assert from 'node:assert/strict';
import {nearestQuestions} from '../app/api/ask/ranking.ts';
test('ranks five questions without collapsing aliases or applying a score threshold',()=>{
 const input=Array.from({length:7},(_,i)=>({id:'q'+i,pageId:i<3?'same-page':'p'+i,score:.3-i*.02}));
 const ranked=nearestQuestions(input.reverse());assert.deepEqual(ranked.map(q=>q.id),['q0','q1','q2','q3','q4']);assert.equal(ranked.filter(q=>q.pageId==='same-page').length,3);
});
test('incremental batches retain the global top five deterministically',()=>{
 const rows=Array.from({length:205},(_,i)=>({id:String(i).padStart(3,'0'),score:i%17}));
 let top=[];for(let i=0;i<rows.length;i+=100)top=nearestQuestions(top.concat(rows.slice(i,i+100)));
 assert.deepEqual(top,nearestQuestions(rows));assert.deepEqual(nearestQuestions([]),[]);
});
