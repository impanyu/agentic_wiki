import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {readFileSync,readdirSync} from 'node:fs';import ts from 'typescript';import {z} from 'zod';
const load=async s=>import('data:text/javascript;base64,'+Buffer.from(ts.transpile(readFileSync('app/page-permissions.ts','utf8').replace(/import [\s\S]*?from ['"][^'"]+['"];?/g,'')+'\n'+s,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
const stripped=p=>readFileSync(p,'utf8').replace(/import [\s\S]*?from ['"][^'"]+['"];?/g,'');
globalThis.testZod=z;const patches=await load('const z=globalThis.testZod;\n'+stripped('app/chat/wiki-patches.ts'));globalThis.testWikiPatches=patches;
test('durable page conversation survives FIFO limits, paginates and isolates principals',async()=>{
 const db=new DatabaseSync(':memory:');for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('drizzle/'+f,'utf8'));
 const database=()=>({prepare(sql){return {bind(...args){return {first:async()=>db.prepare(sql).get(...args),all:async()=>({results:db.prepare(sql).all(...args)}),run:async()=>db.prepare(sql).run(...args)};}};}});
 db.exec("INSERT INTO agent_instances VALUES('session','page:p','owner',NULL,'now')");
 globalThis.chatTest={database,model:()=>'',api:async()=>({}),output:()=> 'Remember the first goals.',memory:async()=>[]};
 const h=await load(stripped('app/chat/history.ts')+'\nconst {database,model,api,output,memory}=globalThis.chatTest;');const a={id:'session',ownerId:'owner',role:'page:p'};
 for(let i=1;i<=65;i++)await h.saveTurn(a,'question '+i,'reply '+i);
 const recent=await h.readTurns(a);assert.equal(recent.messages.length,50);assert.equal(recent.messages[0].user,'question 16');assert.equal(recent.messages.at(-1).user,'question 65');
 const earlier=await h.readTurns(a,recent.before);assert.equal(earlier.messages.length,15);assert.equal(earlier.before,null);
 assert.equal((await h.readTurns({...a,ownerId:'other'})).messages.length,0);await h.saveTurn({...a,ownerId:'other'},'bad','bad');assert.equal(db.prepare('SELECT count(*) n FROM page_chat_turns').get().n,65);
 const c=await h.conversationContext(a);assert.equal(c.summary,'Remember the first goals.');assert.equal(c.turns.at(-1).message,'question 65');assert.equal(db.prepare('SELECT count(*) n FROM page_chat_turns').get().n,65);
 db.close();delete globalThis.chatTest;
});
test('wiki discussion stages a proposal instead of silently modifying the article',async()=>{
 const page={id:'p',owned:true,kind:'static',title:'Title',summary:'Summary',body:'Old',language:'en',sources:[],visibility:'private'};let staged=0;
 globalThis.editTest={z,getPage:async()=>page,askAgent:async()=>({apply:true,discard:false,reply:'Review the proposal.',title:'Title',summary:'Summary',edits:[{operation:'replace',oldText:'Old',newText:'Revised'}]}),readEditDraft:async()=>null,discardEditDraft:async()=>{},stageEdit:async(_a,p,d)=>{staged++;assert.equal(p.body,'Old');return {id:'draft',...d};}};
 const e=await load('const confirmsEditOffer=()=>false;const {z,getPage,askAgent,readEditDraft,discardEditDraft,stageEdit}=globalThis.editTest;\n'+'const {wikiEditSchema,wikiEditFormat,applyWikiPatches}=globalThis.testWikiPatches;\n'+stripped('app/chat/edit-page.ts'));
 const result=await e.editWiki(page,'change',{},'owner',{});assert.equal(result.page.body,'Old');assert.equal(result.editDraft.body,'Revised');assert.equal(staged,1);
 page.owned=false;const discussion=await e.editWiki(page,'change',{},'other',{});assert.equal(discussion.editDraft,null);assert.equal(staged,1);delete globalThis.editTest;
});
