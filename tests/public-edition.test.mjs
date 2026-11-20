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

test('public data sources validate arguments, refuse unknown sources and tools, and save large tables as datasets',async()=>{
 const reply=(url)=>url.includes('/search/repositories')?{total_count:1,items:[{full_name:'a/b',stargazers_count:5}]}:url.includes('rss.marketingtools')?{feed:{results:Array.from({length:50},(_,i)=>({id:String(i),name:'App '+i,artistName:'Dev',artworkUrl100:'https://x/100x100bb.png',url:'https://apps.apple.com/'+i}))}}:{total:1,results:[{id:'i1',title:'Parcels',type:'Feature Service'}]};
 globalThis.publicTest={httpsTransport:async(url)=>{globalThis.publicTest.last=url;return {status:200,headers:{},text:JSON.stringify(reply(url))};},callMcp:async()=>({}),discoverMcp:async()=>[{name:'ask_question',description:'Ask. More text.',inputSchema:{type:'object',properties:{repoName:{},question:{}},required:['repoName']}}],
  saveDataset:async(scope,input)=>{globalThis.publicTest.saved={scope,input};return {datasetId:'ds_test0000',title:input.title,source:input.source,rowCount:input.rows.length,columns:[],preview:input.rows.slice(0,8)};},datasetScope:ctx=>ctx.agent?.id||ctx.userId,z};
 const src=['fetcher.ts','normalize.ts','sources.ts','service.ts'].map(f=>readFileSync('app/public-data/'+f,'utf8')).join('\n');
 const m=await import('data:text/javascript;base64,'+Buffer.from('const {httpsTransport,callMcp,discoverMcp,saveDataset,datasetScope,z}=globalThis.publicTest;\n'+ts.transpile(src.replace(/^import .*;$/gm,''),{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
 delete process.env.YOUTUBE_API_KEY;const ctx={userId:'u1',agent:{id:'ag1'}};
 await assert.rejects(m.callPublicSource('slack','send_message',{},ctx),/Unknown public source/);
 await assert.rejects(m.callPublicSource('github','delete_repo',{},ctx),/Unknown tool/);
 await assert.rejects(m.callPublicSource('github','search_repositories',{query:'x',count:99},ctx),/Invalid arguments/);
 await assert.rejects(m.callPublicSource('arcgis','query_layer',{url:'https://example.com/data.json'},ctx),/FeatureServer/);
 await assert.rejects(m.callPublicSource('youtube','search',{query:'x'},ctx),/Unknown public source/);
 const repos=await m.callPublicSource('github','search_repositories',{query:'topic:llm',count:3},ctx);
 assert.equal(repos.items[0].fullName,'a/b');assert.match(globalThis.publicTest.last,/per_page=3/);
 const items=await m.callPublicSource('arcgis','search_items',{query:'parcels'},ctx);
 assert.equal(items.items[0].page,'https://www.arcgis.com/home/item.html?id=i1');assert.match(decodeURIComponent(globalThis.publicTest.last),/access:public/);
 const small=await m.callPublicSource('appstore','top_charts',{chart:'top-free-apps',count:10},ctx);
 assert.equal(small.rows.length,10);assert.equal(small.dataset,undefined);
 const big=await m.callPublicSource('appstore','top_charts',{chart:'top-free-apps',count:50},ctx);
 assert.equal(big.rows,undefined);assert.equal(big.dataset.datasetId,'ds_test0000');assert.equal(big.rowCount,50);assert.match(big.note,/50 rows saved as dataset ds_test0000/);
 assert.equal(globalThis.publicTest.saved.scope,'ag1');assert.equal(globalThis.publicTest.saved.input.rows[0].rank,1);
 const catalog=await m.listPublicSources(undefined,'');
 assert.ok(catalog.sources.length>=18);assert.ok(!catalog.sources.some(s=>s.id==='youtube'));
 assert.ok(catalog.sources.find(s=>s.id==='wikidata').tools.includes('sparql(query, limit?)'));
 assert.deepEqual(catalog.sources.find(s=>s.id==='deepwiki').tools,['ask_question(repoName, question?)']);
 const one=await m.listPublicSources(undefined,'worldbank');
 assert.equal(one.tools[0].inputSchema.required[0],'indicator');
 await assert.rejects(m.listPublicSources(undefined,'nope'),/Unknown public source/);
 assert.deepEqual(m.publicSourceTools[0].parameters.required,['source']);
});
