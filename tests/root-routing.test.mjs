import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';
const load=s=>import('data:text/javascript;base64,'+Buffer.from(ts.transpile(s,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
test('one root routes matched wiki/apps, classifies only misses, and bypasses matching for explicit forks',async()=>{
 let match='wiki',classified=0,searches=0,mismatch=false;const calls=[];
 const pages={wiki:{id:'wiki',kind:'static',title:'Wiki'},app:{id:'app',kind:'dynamic',title:'App',dynamic:{capability:'application'}},chart:{id:'chart',kind:'dynamic',title:'Chart',dynamic:{capability:'chart'}}};
 globalThis.rootTest={getPage:async id=>pages[id],matchQuestion:async(...args)=>{searches++;calls.push(args);return match;},pageIntent:async()=>{classified++;return {route:'app',kind:'chart',service:'none',fresh:false};},recordAction:async()=>{},storagePageMismatch:()=>mismatch};
 const m=await load('const {'+Object.keys(globalThis.rootTest).join(',')+'}=globalThis.rootTest;'+readFileSync('app/routing/root-table.ts','utf8').replace(/^import .*;$/gm,''));
 const root={id:'root',role:'root-routing',ownerId:'u'};
 assert.equal((await m.resolveRootRoute('q',[1],'en','u',root)).intent.route,'wiki');
 match='app';assert.equal((await m.resolveRootRoute('q',[1],'en','u',root)).intent.route,'app');
 match='chart';assert.equal((await m.resolveRootRoute('q',[1],'en','u',root)).intent.kind,'chart');assert.equal(classified,0);
 mismatch=true;assert.equal((await m.resolveRootRoute('q',[1],'en','u',root)).pageId,null);assert.equal(classified,1);
 mismatch=false;match=null;assert.equal((await m.resolveRootRoute('q',[1],'en','u',root)).pageId,null);assert.equal(classified,2);
 const before=searches;await m.resolveRootRoute('q',[1],'en','u',root,undefined,true);assert.equal(searches,before);assert.equal(classified,3);
 assert.ok(calls.every(a=>a[4]===root&&a.length===6),'same root and no domain filter');delete globalThis.rootTest;
});
test('navigation spawns no branch router and sends the root to parameter extraction and generation',()=>{
 const s=readFileSync('app/api/ask/route.ts','utf8');assert.match(s,/spawnAgent\('root-routing'/);assert.doesNotMatch(s,/spawnAgent\(domain|rememberRootRoute|importWikiRoutes/);assert.match(s,/parameterRouter=rootRouter/);assert.match(s,/context,rootRouter,emit,signal/);
});
