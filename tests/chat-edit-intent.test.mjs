import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync('app/chat/edit-intent.ts','utf8');
const {confirmsEditOffer}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile(source,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
test('acceptance resolves an assistant edit offer in the current user conversation',()=>{
 const context={ownConversation:{turns:[{reply:'如果你愿意，我可以把页面里的“预防方法”小节再改得更口语一点，顺便加上一句说明。'}]}};
 assert.equal(confirmsEditOffer('好',context),true);
 assert.equal(confirmsEditOffer('不用了',context),false);
 assert.equal(confirmsEditOffer('好的。',{ownConversation:{turns:[{reply:'这个解释有帮助吗？'}]}}),false);
 assert.equal(confirmsEditOffer('好',{pageDiscussion:[{reply:context.ownConversation.turns[0].reply}]}),false);
 assert.equal(confirmsEditOffer('ok',{turns:[{reply:'I can update the prevention section.'}]}),true);
});
test('explicit edit requests save, refresh the page, and keep ordinary discussion unchanged',async()=>{
 let saves=0;
 const page={id:'p',owned:true,language:'zh-Hans',body:'old'};
 globalThis.applyEditTest={saveEditDraft:async(agent,pageId,draftId)=>{saves++;assert.equal(pageId,'p');assert.equal(draftId,'d');return {page:{...page,body:'new'}};}};
 const source=readFileSync('app/chat/apply-requested-edit.ts','utf8').replace(/^import .*;$/gm,'');
 const {applyRequestedEdit}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile('const {saveEditDraft}=globalThis.applyEditTest;\n'+source,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
 const result={reply:'preview',page,editDraft:{id:'d'},saveRequested:true};
 const saved=await applyRequestedEdit(result,{});
 assert.equal(saved.page.body,'new');assert.equal(saved.editDraft,null);assert.match(saved.reply,/保存/);
 await applyRequestedEdit({...result,saveRequested:false},{});
 await applyRequestedEdit({...result,page:{...page,owned:false}},{});
 assert.equal(saves,1);
 const c=new AbortController();c.abort();await assert.rejects(()=>applyRequestedEdit(result,{},c.signal));assert.equal(saves,1);
 delete globalThis.applyEditTest;
});
