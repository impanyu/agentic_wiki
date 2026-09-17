import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';import {z} from 'zod';
const strip=p=>readFileSync(p,'utf8').replace(/^import .*;$/gm,'');
const load=s=>import('data:text/javascript;base64,'+Buffer.from(ts.transpile(s,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
globalThis.moveContracts={z};const contracts=await load('const {z}=globalThis.moveContracts;'+strip('app/resources/contracts.ts'));
test('moves verify all destinations, preserve originals on failures and never replay removal',async()=>{
 let mismatch=false,partial=false,exported=false,allowed=true,removalFailure=false,removed=[],copyCalls=0;
 const vault=new Map(),source={space:'google',id:'source',kind:'file',name:'file.bin'},destination={space:'adma',connectorId:'11111111-1111-4111-8111-111111111111',id:'folder',kind:'folder',name:'ADMA'};
 const mocks={z,...contracts,canWritePage:p=>!!p?.owned,getPage:async()=>({owned:true}),connections:async()=>[{id:'google',enabled:true,connected:true,allowed:['trash'],automatic:allowed?['trash']:[]}],vaultPath:async(u,k)=>u+k,vaultRead:async k=>vault.get(k),vaultWrite:async(k,v)=>vault.set(k,structuredClone(v)),lock:async()=>'lease',unlock:async()=>{},copyResources:async()=>{copyCalls++;return {state:partial?'partial':'complete',copied:[{source,destination,result:{id:'copied'},digest:'1',exported}],failed:partial?[{error:'upload failed'}]:[],bytes:1};},readFile:async(p,u,r)=>({bytes:new Uint8Array([mismatch&&r.id==='copied'?2:1])}),fileDigest:async b=>String(b[0]),callConnector:async(u,c,t,a)=>{if(removalFailure)throw Error('Removal unavailable');removed.push(a.id);return {};},browseResources:async()=>({items:[],next:null})};
 globalThis.moveFixture=mocks;const {moveResources}=await load('const {'+Object.keys(mocks).join(',')+'}=globalThis.moveFixture;'+strip('app/resources/move.ts'));
 const request=()=>({operationId:crypto.randomUUID(),sources:[source],destination,confirmRemoval:true});
 let r=request();assert.equal((await moveResources('p','u',r)).state,'complete');assert.deepEqual(removed,['source']);await moveResources('p','u',r);assert.equal(copyCalls,1);assert.equal(removed.length,1);
 mismatch=true;assert.equal((await moveResources('p','u',request())).state,'partial');assert.equal(removed.length,1);mismatch=false;
 partial=true;assert.equal((await moveResources('p','u',request())).state,'partial');assert.equal(removed.length,1);partial=false;
 exported=true;assert.equal((await moveResources('p','u',request())).state,'partial');assert.equal(removed.length,1);exported=false;
 removalFailure=true;const failedRequest=request();const failedMove=await moveResources('p','u',failedRequest);assert.equal(failedMove.state,'partial');assert.equal(failedMove.copied.length,1);assert.equal(failedMove.moved.length,0);removalFailure=false;await moveResources('p','u',failedRequest);assert.equal(removed.length,1);
 allowed=false;const before=copyCalls;await assert.rejects(moveResources('p','u',request()),/Enable trash/);assert.equal(copyCalls,before);
 await assert.rejects(moveResources('p','u',{...request(),confirmRemoval:false}));
 await assert.rejects(moveResources('p','u',{...request(),sources:[{...source,id:'',kind:'folder'}]}),/roots/);
});
