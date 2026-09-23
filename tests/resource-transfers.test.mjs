import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';import {z} from 'zod';
const load=code=>import('data:text/javascript;base64,'+Buffer.from(ts.transpile(code,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
const strip=path=>readFileSync(path,'utf8').replace(/^import .*;$/gm,'');
globalThis.resourceTest={z};const contracts=await load('const {z}=globalThis.resourceTest;'+strip('app/resources/contracts.ts'));const tree=await load(strip('app/context-files/tree.ts'));
globalThis.resourceTest={...contracts,...tree};const binary=await load('const {MAX_FILE_BYTES,fileName}=globalThis.resourceTest;'+strip('app/resources/binary.ts'));
test('binary copies preserve non-UTF8 bytes, MIME type and private ADMA upload settings',async()=>{
 const bytes=new Uint8Array([0,255,254,128,1,10]);let upload;
 const file=await binary.downloadBinary('adma','id','secret',async(url,options)=>{assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Token secret');return url.includes('metadata')?Response.json({name:'image.png'}):new Response(bytes,{headers:{'Content-Type':'image/png'}});});assert.deepEqual(file.bytes,bytes);
 await binary.uploadBinary('adma','folder',file,'secret',async(url,options)=>{upload=options.body;return Response.json({files:[{id:'new'}]});});assert.equal(upload.get('is_public'),'false');assert.equal(upload.get('folder_id'),'folder');assert.deepEqual(new Uint8Array(await upload.get('files').arrayBuffer()),bytes);
 await assert.rejects(binary.uploadBinary('adma','folder',file,'secret',async()=>Response.json({files:[],rejected_count:1})),/rejected/);
});
test('downloads enforce size bounds and OneDrive does not forward tokens to download hosts',async()=>{
 await assert.rejects(binary.boundedBytes(new Response('x',{headers:{'Content-Length':String(contracts.MAX_FILE_BYTES+1)}})),/limit/);
 let count=0;await binary.downloadBinary('onedrive','id','secret',async(url,options)=>{count++;if(count===1)return Response.json({name:'x.txt',file:{mimeType:'text/plain'},'@microsoft.graph.downloadUrl':'https://tenant.sharepoint.com/file'});assert.deepEqual(options.headers,{});return new Response('content');});assert.equal(count,2);
 await assert.rejects(binary.downloadBinary('onedrive','id','secret',async()=>Response.json({name:'x','@microsoft.graph.downloadUrl':'https://evil.test/file'})),/host/);
});
test('copy target rejects self and descendant folders while permitting cross-drive copies',()=>{
 const root={space:'page',id:'',kind:'folder',name:'Page files'};assert.throws(()=>contracts.assertCopyTarget([root],{...root,id:'sub'}));assert.throws(()=>contracts.assertCopyTarget([{...root,id:'a'}],{...root,id:'a/b'}));contracts.assertCopyTarget([root],{space:'google',id:'',kind:'folder',name:'Drive'});
});
test('folder copies preserve paths, enforce checked tools and never repeat completed writes',async()=>{
 const vault=new Map(),objects=new Map([['uploads/f',new Uint8Array([0,255,42])]]),created=[],uploaded=[];let writable=true,nativePage=false,allowed=['list','read','upload','mkdir'],downloads=0;
 const files=[{id:'f',name:'x.bin',folderPath:'Research/Sub'}];
 const mocks={...contracts,...tree,env:{FILES:{get:async key=>({arrayBuffer:async()=>objects.get(key).buffer}),put:async(key,bytes)=>objects.set(key,bytes)}},getPage:async()=>({id:'p',language:'en',owned:writable,...(nativePage?{dynamic:{template:'native-app-v1'}}:{})}),canWritePage:p=>p.owned,canUseConnectorsOn:p=>p.owned||(p.dynamic?.template==='native-app-v1'&&!p.dynamic?.pageCode),signedIn:()=>{},connections:async()=>[{id:'google',enabled:true,connected:true,kind:'storage',name:'Drive',allowed,tools:[]}],storageToken:async()=>'token',vaultPath:async(u,n)=>u+'/'+n,vaultRead:async path=>vault.get(path),vaultWrite:async(path,value)=>vault.set(path,structuredClone(value)),lock:async()=>'lock',unlock:async()=>{},listContextFiles:async()=>files,contextFiles:async()=>[{row:{id:'f'},data:{location:'r2://FILES/uploads/f',size:3,fileName:'x.bin',mimeType:'application/octet-stream'}}],database:()=>({prepare:sql=>({bind:(...args)=>({all:async()=>({results:[]}),run:async()=>{created.push({sql,args});return {meta:{changes:1}};}})})}),attachContextFile:async()=>'attached',downloadBinary:async()=>{downloads++;return {name:'remote.bin',bytes:new Uint8Array([0,255]),mime:'application/octet-stream'};},uploadBinary:async(space,parent,file)=>{uploaded.push({space,parent,file});return {id:'uploaded'};},callConnector:async(u,c,tool,args)=>tool==='mkdir'?{id:args.parent+'/'+args.name}: {items:[],next:null}};
 globalThis.transferTest=mocks;const {copyResources}=await load('const {'+Object.keys(mocks).join(',')+'}=globalThis.transferTest;'+strip('app/resources/service.ts'));
 const req={operationId:crypto.randomUUID(),sources:[{space:'page',kind:'folder',id:'Research',name:'Research'}],destination:{space:'google',kind:'folder',id:'root',name:'Drive'}};
 const result=await copyResources('p','u',req);assert.equal(result.state,'complete');assert.equal(uploaded.length,1);assert.equal(uploaded[0].parent,'root/Research/Sub');assert.deepEqual(uploaded[0].file.bytes,new Uint8Array([0,255,42]));await copyResources('p','u',req);assert.equal(uploaded.length,1);
 writable=false;await assert.rejects(copyResources('p','u',{...req,operationId:crypto.randomUUID()}),/read only/);nativePage=true;assert.equal((await copyResources('p','u',{...req,operationId:crypto.randomUUID()})).state,'complete');nativePage=false;writable=true;allowed=['list'];await assert.rejects(copyResources('p','u',{...req,operationId:crypto.randomUUID()}),/Enable upload/);
 const inbound={operationId:crypto.randomUUID(),sources:[{space:'google',kind:'file',id:'remote',name:'remote.bin'}],destination:{space:'page',kind:'folder',id:'',name:'Page files'}};await assert.rejects(copyResources('p','u',inbound),/Enable read/);assert.equal(downloads,0);allowed=['read'];const imported=await copyResources('p','u',inbound);assert.equal(imported.state,'complete');assert.equal(downloads,1);assert.ok(created.some(x=>x.sql.includes('INSERT INTO components')));
});
test('Drive exports use Office formats and cloud uploads keep bytes without overwriting existing names',async()=>{
 let exported='';const bytes=new Uint8Array([80,75,0,255]);const file=await binary.downloadBinary('google','g','token',async url=>{if(url.includes('fields='))return Response.json({name:'Sheet',mimeType:'application/vnd.google-apps.spreadsheet'});exported=url;return new Response(bytes);});assert.equal(file.name,'Sheet.xlsx');assert.match(exported,/export\?mimeType=/);
 await binary.uploadBinary('google','parent',file,'token',async(url,init)=>{assert.match(url,/uploadType=multipart/);const body=new Uint8Array(await init.body.arrayBuffer());assert.ok(Buffer.from(body).includes(Buffer.from(bytes)));assert.match(Buffer.from(body).toString(),/"parents":\["parent"\]/);return Response.json({id:'g'});});
 await binary.uploadBinary('dropbox','/folder',file,'token',async(url,init)=>{const arg=JSON.parse(init.headers['Dropbox-API-Arg']);assert.equal(arg.mode,'add');assert.equal(arg.strict_conflict,true);assert.deepEqual(init.body,bytes);return Response.json({id:'d'});});
 await binary.uploadBinary('onedrive','parent',file,'token',async(url,init)=>{assert.match(url,/conflictBehavior=fail/);assert.deepEqual(init.body,bytes);return Response.json({id:'o'});});
});
test('ADMA transfer browser exposes personal root independently from third-party catalog',async()=>{
 const calls=[],id='11111111-1111-4111-8111-111111111111';
 const mocks={...contracts,getPage:async()=>({id:'p'}),signedIn:()=>{},connections:async()=>[{id,provider:'adma',enabled:true,connected:true,allowed:['list_files','list_folders']}],publicThirdPartyCatalog:async()=>[{id:'realm',name:'Realm5',kind:'folder'}],callConnector:async(u,c,t,args)=>{calls.push({t,args});return t==='list_files'?{files:[{id:'own',name:'Own.csv'}]}:{folders:[]};}};
 globalThis.admaRootTest=mocks;const {browseResources,copyResources}=await load('const {'+Object.keys(mocks).join(',')+'}=globalThis.admaRootTest;'+strip('app/resources/service.ts'));
 const root={space:'adma',connectorId:id,id:'repositories',kind:'folder',name:'ADMA'};
 const top=await browseResources('p','u',root);assert.deepEqual(top.items.map(x=>x.id),['','third-party']);assert.equal(calls.length,0);
 const mine=await browseResources('p','u',top.items[0]);assert.equal(mine.items[0].name,'Own.csv');assert.deepEqual(calls.map(x=>x.args),[{},{}]);
 const shared=await browseResources('p','u',top.items[1]);assert.equal(shared.items[0].id,'realm');
 await assert.rejects(copyResources('p','u',{operationId:crypto.randomUUID(),sources:[mine.items[0]],destination:root}),/destination/);
});
