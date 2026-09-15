import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';
const strip=p=>readFileSync(p,'utf8').replace(/^import .*;$/gm,'');
const load=s=>import('data:text/javascript;base64,'+Buffer.from(ts.transpile(s,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
const scope=await load(strip('app/storage/google-scope.ts'));
test('drive.file accepts per-file grants and rejects old broad or unknown grants',()=>{
 assert.equal(scope.isFileOnlyScope(scope.GOOGLE_FILE_SCOPE),true);
 for(const s of [undefined,'',scope.GOOGLE_FILE_SCOPE+' https://www.googleapis.com/auth/drive.metadata.readonly','https://www.googleapis.com/auth/drive',scope.GOOGLE_FILE_SCOPE+' https://www.googleapis.com/auth/drive.readonly'])assert.equal(scope.isFileOnlyScope(s),false);
});
test('old stored Google tokens cannot be returned to agents or Picker',async()=>{
 let saved={ownerId:'alice',accessToken:'unit-token',expires:Date.now()+600000},unlocked=0;
 globalThis.fileScope={isFileOnlyScope:scope.isFileOnlyScope,storageProviders:{google:{}},signedIn:()=>{},requireStorageTool:async()=>{},vaultReady:()=>true,vaultPath:async()=>'',lock:async()=> 'lease',unlock:async()=>unlocked++,vaultRead:async()=>saved};
 const m=await load('const {'+Object.keys(globalThis.fileScope).join(',')+'}=globalThis.fileScope;\n'+strip('app/storage/oauth.ts'));
 await assert.rejects(m.storageToken('google','alice'),/REAUTHORIZE_FILE_ONLY/);assert.equal(unlocked,1);
 saved={...saved,scope:scope.GOOGLE_FILE_SCOPE};assert.equal(await m.storageToken('google','alice'),'unit-token');
 delete globalThis.fileScope;
});
test('authorized-file listing includes selected files in nested folders; Docs are exported as text',async()=>{
 const {providerOperation}=await load(strip('app/storage/adapters.ts'));let requests=[];
 const transport=async url=>{requests.push(new URL(url));return new Response(JSON.stringify({files:[],mimeType:'application/vnd.google-apps.document'}));};
 await providerOperation({provider:'google',operation:'list',args:{parent:'root'}},'test',transport);assert.equal(requests[0].searchParams.get('q'),'trashed = false');
 requests=[];await providerOperation({provider:'google',operation:'read',args:{id:'doc-id'}},'test',transport);assert.equal(requests[1].pathname,'/drive/v3/files/doc-id/export');assert.equal(requests[1].searchParams.get('mimeType'),'text/plain');
});
