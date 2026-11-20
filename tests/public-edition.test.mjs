import test from 'node:test';import {z} from 'zod';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';
// The public edition (rankwiki): public data only, read-only public pages, no connectors.
const load=async(file,prelude='')=>import('data:text/javascript;base64,'+Buffer.from(prelude+ts.transpile(readFileSync(file,'utf8').replace(/^import .*;$/gm,''),{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));

test('the public edition closes connector, upload, editing, chat, fork and visibility routes but keeps reading open',async()=>{
 const {closedInPublicEdition:closed}=await load('proxy.ts','const NextResponse={};const PUBLIC_EDITION=true;\n');
 for(const [path,method] of [['/api/connectors','GET'],['/api/connectors/x','DELETE'],['/api/storage/google/start','POST'],['/api/connections/google-drive','GET'],['/api/components/upload','POST'],['/api/components/c1/execute','POST'],['/drive-picker','GET'],['/api/pages/p1/chat','GET'],['/api/pages/p1/chat','POST'],['/api/pages/p1/content','PUT'],['/api/pages/p1/fork','DELETE'],['/api/pages/p1/versions','POST'],['/api/pages/p1/live-agent','PUT'],['/api/pages/p1','PATCH'],['/api/pages/p1/files','POST'],['/api/pages/p1/files/f1','DELETE'],['/api/pages/p1/files/f1','PATCH'],['/api/pages/p1/drive','GET'],['/api/sandboxes/run','POST']])
  assert.equal(closed(path,method),true,method+' '+path);
 for(const [path,method] of [['/api/ask','POST'],['/api/pages/p1','GET'],['/api/pages/p1/files','GET'],['/api/pages/p1/files/f1','GET'],['/api/pages/p1/concepts','POST'],['/api/history','GET'],['/api/history','POST'],['/api/home','GET'],['/api/session','GET'],['/api/health','GET']])
  assert.equal(closed(path,method),false,method+' '+path);
});

test('every page is read-only in the public edition, even for its owner',async()=>{
 const {canWritePage,canUseConnectorsOn}=await load('app/page-permissions.ts','const PUBLIC_EDITION=true;\n');
 assert.equal(canWritePage({owned:true,visibility:'public',publicWrite:true}),false);
 assert.equal(canUseConnectorsOn({owned:true,visibility:'public',dynamic:{template:'native-app-v1'}}),false);
});

test('public-edition generation instructions mention no connectors, drives or private sources',async()=>{
 const {generationInstructions:text}=await load('app/page-programs/generation-instructions.ts','const PUBLIC_EDITION=true;\n');
 assert.doesNotMatch(text,/connector|Google Drive|Dropbox|copy_resources|private-source/i);
 assert.match(text,/list_public_sources/);
 const {generationInstructions:full}=await load('app/page-programs/generation-instructions.ts','const PUBLIC_EDITION=false;\n');
 assert.match(full,/connector/);
});

test('the public toolbox offers public data sources and no user connectors or drives',()=>{
 const source=readFileSync('app/agents/tools.ts','utf8');
 for(const name of ['list_connectors','call_connector','storage_connections','storage_execute','list_google_drive_folders','execute_api','browse_resources','copy_resources','read_uploaded_file'])assert.match(source.match(/PUBLIC_EDITION\?\[([^\]]*)\]/)[1],new RegExp("'"+name+"'"),name);
 assert.match(source,/\.\.\.\(PUBLIC_EDITION\?publicSourceTools:\[\]\)/);
});

test('public data sources validate arguments and refuse unknown sources and tools',async()=>{
 globalThis.publicTest={remoteRequest:async(url)=>{globalThis.publicTest.last=url;return {data:url.includes('/search/repositories')?{total_count:1,items:[{full_name:'a/b',stargazers_count:5}]}:{total:1,results:[{id:'i1',title:'Parcels',type:'Feature Service'}]}};},callMcp:async()=>({}),discoverMcp:async()=>[],executeApiConnector:async()=>({items:[]}),z};
 const m=await load('app/public-data/service.ts','const {remoteRequest,callMcp,discoverMcp,executeApiConnector,z}=globalThis.publicTest;\n');
 await assert.rejects(m.callPublicSource('slack','send_message',{}),/Unknown public source/);
 await assert.rejects(m.callPublicSource('github','delete_repo',{}),/Unknown tool/);
 await assert.rejects(m.callPublicSource('arcgis','query_layer',{url:'https://example.com/data.json'}),/FeatureServer/);
 const repos=await m.callPublicSource('github','search_repositories',{query:'topic:llm',count:3});
 assert.equal(repos.items[0].fullName,'a/b');assert.match(globalThis.publicTest.last,/per_page=3/);
 const items=await m.callPublicSource('arcgis','search_items',{query:'parcels'});
 assert.equal(items.items[0].page,'https://www.arcgis.com/home/item.html?id=i1');assert.match(decodeURIComponent(globalThis.publicTest.last),/access:public/);
});
