import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {isIP} from 'node:net';import {gzipSync,gunzipSync} from 'node:zlib';import ts from 'typescript';import {z} from 'zod';
// Web-archive source (Wayback Machine, Common Crawl), challenge-page detection and the
// robots.txt switch — pure parts and the tools over a fake HTTP client, no network.
const js=(src)=>ts.transpile(src,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022});
const strip=(file)=>readFileSync(file,'utf8').replace(/^import .*;$/gm,'');
const load=async(src,prelude='')=>import('data:text/javascript;base64,'+Buffer.from(prelude+js(src)).toString('base64'));
globalThis.__archiveTest={z,isIP,gunzipSync};
const sources=await load(['app/public-data/fetcher.ts','app/public-data/normalize.ts','app/public-data/sources.ts'].map(strip).join('\n'),'const {z}=globalThis.__archiveTest;\n');
const html=await load(strip('app/data-tools/html.ts'));
const parse=await load(strip('app/data-tools/parse.ts'));
const robots=await load(strip('app/data-tools/robots.ts'));
const fetchMod=await load(strip('app/url-content/fetch.ts'),'const {isIP}=globalThis.__archiveTest;const lookup=null,httpRequest=null,httpsRequest=null,gunzipSync=null,inflateSync=null,brotliDecompressSync=null;\n');
globalThis.__archiveTest.fetch=fetchMod;
const browse=await load(strip('app/url-content/browse.ts'),'const PDFDocument=null;const {sourceUrl,fetchSource,sourceText}=globalThis.__archiveTest.fetch;\n');
Object.assign(globalThis.__archiveTest,{sources,html,browse});
const archive=await load(strip('app/public-data/archive.ts'),'const {gunzipSync}=globalThis.__archiveTest;const {A,PublicHttpError,registerSource}=globalThis.__archiveTest.sources;const {extractTables,htmlTitle}=globalThis.__archiveTest.html;const {sourceText}=globalThis.__archiveTest.fetch;const {pageLinks}=globalThis.__archiveTest.browse;\n');
const tool=(name)=>archive.archive.tools.find(t=>t.name===name);
const run=(name,args,ctx)=>tool(name).run(sources.parseToolArgs('archive',tool(name),args),ctx);

const PAGE=`<html><head><meta charset="utf-8"><title>Perfumes — Example</title></head><body><main><h1>Top perfumes</h1><p>Chanel N°5 is a classic.</p>
<a href="/perfume/chanel-no-5">Chanel No 5</a> <a href="https://www.example.com/perfume/dior-sauvage">Sauvage</a>
<table class="wikitable"><tr><th>Name</th><th>Rating</th></tr><tr><td>Chanel No 5</td><td>4.5</td></tr><tr><td>Sauvage</td><td>4.2</td></tr></table></main></body></html>`;
// A Common Crawl style record: WARC headers, then the HTTP response (headers + body), gzipped alone.
function warcRecord(body,{chunked=false,uri='https://www.example.com/perfume/'}={}){
 const payload=chunked?Buffer.concat([Buffer.from(Buffer.byteLength(body).toString(16)+'\r\n'),Buffer.from(body),Buffer.from('\r\n0\r\n\r\n')]):Buffer.from(body);
 const http=Buffer.concat([Buffer.from('HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=UTF-8\r\n'+(chunked?'Transfer-Encoding: chunked\r\n':'X-Crawler-Content-Length: '+payload.length+'\r\n')+'\r\n'),payload]);
 const head='WARC/1.0\r\nWARC-Type: response\r\nWARC-Date: 2025-02-06T12:00:00Z\r\nWARC-Record-ID: <urn:uuid:1>\r\nContent-Length: '+http.length+'\r\nContent-Type: application/http; msgtype=response\r\nWARC-Target-URI: '+uri+'\r\n\r\n';
 return gzipSync(Buffer.concat([Buffer.from(head),http,Buffer.from('\r\n\r\n')]));
}
const fakeHttp=(routes)=>{const calls=[];const pick=(url)=>{const k=Object.keys(routes).find(k=>url.includes(k));if(!k)throw Error('unexpected '+url);const r=routes[k];if(r instanceof Error)throw r;return typeof r==='function'?r(url):r;};
 return {calls,json:async(url,o)=>{calls.push({url,o,mode:'json'});return structuredClone(pick(url));},text:async(url,o)=>{calls.push({url,o,mode:'text'});return pick(url);},raw:async(url,o)=>{calls.push({url,o,mode:'raw'});return pick(url);}};};

test('Wayback CDX JSON becomes rows with raw snapshot URLs',()=>{
 const json=[['timestamp','original','statuscode','mimetype','length'],['20240105123456','https://www.example.com/perfume/','200','text/html','5123'],['2023','https://www.example.com/a','-','text/html','x']];
 const rows=archive.cdxRows(json);
 assert.equal(rows.length,2);
 assert.deepEqual(rows[0],{timestamp:'20240105123456',date:'2024-01-05T12:34:56Z',original:'https://www.example.com/perfume/',status:200,mime:'text/html',length:5123,snapshotUrl:'https://web.archive.org/web/20240105123456id_/https://www.example.com/perfume/'});
 assert.equal(rows[1].status,null);assert.equal(rows[1].date,'2023-01-01');
 assert.deepEqual(archive.cdxRows([]),[]);assert.deepEqual(archive.cdxRows({}),[]);
 const u=new URL(archive.cdxUrl({url:'www.example.com/perfume/*',limit:50,latest:true,collapse:'urlkey',from:'2023'}));
 assert.equal(u.searchParams.get('url'),'www.example.com/perfume/*');assert.equal(u.searchParams.get('limit'),'-50');
 assert.equal(u.searchParams.get('collapse'),'urlkey');assert.equal(u.searchParams.get('filter'),'statuscode:200');assert.equal(u.searchParams.get('output'),'json');
 assert.equal(u.searchParams.get('fl'),'timestamp,original,statuscode,mimetype,length');assert.equal(u.searchParams.get('from'),'2023');
 assert.equal(new URL(archive.cdxUrl({url:'x.com',matchType:'domain'})).searchParams.get('collapse'),'digest');
 assert.deepEqual(archive.parseAvailable({url:'example.com',archived_snapshots:{closest:{available:true,status:'200',timestamp:'20250101000000',url:'http://web.archive.org/web/20250101000000/https://example.com/'}}}),{timestamp:'20250101000000',original:'https://example.com/'});
 assert.equal(archive.parseAvailable({archived_snapshots:{}}),null);
});

test('wayback_snapshots and wayback_fetch over a fake client',async()=>{
 const http=fakeHttp({'/cdx/search/cdx':[['timestamp','original','statuscode','mimetype','length'],['20240105123456','https://www.example.com/perfume/','200','text/html','5123']],
  'archive.org/wayback/available':{archived_snapshots:{closest:{available:true,timestamp:'20240105123456',url:'http://web.archive.org/web/20240105123456/https://www.example.com/perfume/'}}},
  'id_/https://www.example.com/perfume/':{status:200,headers:{'content-type':'text/html; charset=utf-8'},bytes:Buffer.from(PAGE),url:'https://web.archive.org/web/20240105123456id_/https://www.example.com/perfume/'}});
 const list=await run('wayback_snapshots',{url:'www.example.com/perfume/*',collapse:'urlkey'},{http});
 assert.equal(list.rows.length,1);assert.match(list.source,/cdx\/search\/cdx/);
 const saved=[];const save=async(input)=>{saved.push(input);return {datasetId:'ds_'+saved.length,rowCount:input.rows.length,preview:input.rows.slice(0,8)};};
 const page=await run('wayback_fetch',{url:'https://www.example.com/perfume/'},{http,save});
 assert.equal(page.found,true);assert.equal(page.fromArchive,true);assert.equal(page.timestamp,'20240105123456');
 assert.equal(page.snapshotUrl,'https://web.archive.org/web/20240105123456id_/https://www.example.com/perfume/');
 assert.equal(page.title,'Perfumes — Example');assert.match(page.text,/Chanel N°5 is a classic/);
 assert.ok(page.links.some(l=>l.url==='https://www.example.com/perfume/chanel-no-5'),'links resolve against the original address');
 assert.equal(page.tables[0].datasetId,'ds_1');assert.equal(saved[0].rows.length,2);assert.match(saved[0].source,/web\.archive\.org.*#table-0/);
 const none=await run('wayback_fetch',{url:'https://nothing.example/'},{http:fakeHttp({'wayback/available':{archived_snapshots:{}},'/cdx/search/cdx':[]})});
 assert.equal(none.found,false);
});

test('Common Crawl index NDJSON becomes rows',()=>{
 const text=['{"urlkey":"com,example)/perfume/a","timestamp":"20250206114225","url":"https://www.example.com/perfume/a","mime":"text/html","mime-detected":"text/html","status":"200","digest":"ABC","length":"23456","offset":"123456789","filename":"crawl-data/CC-MAIN-2025-08/segments/1/warc/x.warc.gz","languages":"eng"}','','not json','{"url":"no-filename"}'].join('\n');
 const rows=archive.ccRows(text);
 assert.equal(rows.length,1);
 assert.deepEqual(rows[0],{url:'https://www.example.com/perfume/a',timestamp:'20250206114225',date:'2025-02-06T11:42:25Z',status:200,mime:'text/html',filename:'crawl-data/CC-MAIN-2025-08/segments/1/warc/x.warc.gz',offset:123456789,length:23456,digest:'ABC',languages:'eng',crawl:'CC-MAIN-2025-08'});
 const u=new URL(archive.ccIndexUrl('CC-MAIN-2025-08',{url:'www.example.com/perfume/*',limit:100}));
 assert.equal(u.pathname,'/CC-MAIN-2025-08-index');assert.equal(u.searchParams.get('url'),'www.example.com/perfume/*');assert.equal(u.searchParams.get('limit'),'100');assert.equal(u.searchParams.get('filter'),'=status:200');
});

test('a gzipped WARC record is parsed: headers, HTTP status, body (plain and chunked)',()=>{
 for(const chunked of [false,true]){
  const rec=archive.parseWarc(archive.gunzipRecord(warcRecord(PAGE,{chunked})));
  assert.equal(rec.type,'response');assert.equal(rec.targetUri,'https://www.example.com/perfume/');assert.equal(rec.date,'2025-02-06T12:00:00Z');
  assert.equal(rec.httpStatus,200);assert.equal(rec.httpHeaders['content-type'],'text/html; charset=UTF-8');
  assert.equal(archive.decodeBody(rec.body,rec.httpHeaders['content-type']),PAGE);
 }
 assert.throws(()=>archive.parseWarc(Buffer.from('HTTP/1.1 200 OK\r\n\r\n')),/Not a WARC/);
 assert.throws(()=>archive.gunzipRecord(Buffer.from('not gzip')),/could not be decompressed/);
 assert.equal(archive.decodeBody(Buffer.from([0x63,0x61,0x66,0xe9]),'text/html; charset=iso-8859-1'),'café');
});

test('commoncrawl_index and commoncrawl_fetch: latest crawl, Range request, parsed page',async()=>{
 const gz=warcRecord(PAGE);
 const ndjson='{"url":"https://www.example.com/perfume/","timestamp":"20250206114225","status":"200","mime":"text/html","filename":"crawl-data/CC-MAIN-2025-08/segments/1/warc/x.warc.gz","offset":"1000","length":"'+gz.length+'"}\n';
 const http=fakeHttp({'collinfo.json':[{id:'CC-MAIN-2025-08'},{id:'CC-MAIN-2024-51'}],'CC-MAIN-2025-08-index':ndjson,'data.commoncrawl.org':()=>({status:206,headers:{},bytes:gz,url:''})});
 const index=await run('commoncrawl_index',{url:'www.example.com/perfume/*'},{http});
 assert.equal(index.crawl,'CC-MAIN-2025-08');assert.equal(index.rows.length,1);
 const row=index.rows[0];const saved=[];
 const page=await run('commoncrawl_fetch',{filename:row.filename,offset:row.offset,length:row.length},{http,save:async(i)=>{saved.push(i);return {datasetId:'ds_cc',rowCount:i.rows.length,preview:[]};}});
 const range=http.calls.find(c=>c.mode==='raw');
 assert.equal(range.url,'https://data.commoncrawl.org/crawl-data/CC-MAIN-2025-08/segments/1/warc/x.warc.gz');
 assert.equal(range.o.headers.Range,'bytes=1000-'+(1000+gz.length-1));
 assert.equal(page.fromArchive,true);assert.equal(page.httpStatus,200);assert.equal(page.url,'https://www.example.com/perfume/');assert.equal(page.crawl,'CC-MAIN-2025-08');
 assert.match(page.text,/Top perfumes/);assert.equal(page.tables[0].datasetId,'ds_cc');assert.equal(saved[0].rows[1].Name,'Sauvage');
 const byUrl=await run('commoncrawl_fetch',{url:'https://www.example.com/perfume/'},{http});
 assert.equal(byUrl.title,'Perfumes — Example');
 await assert.rejects(()=>run('commoncrawl_fetch',{filename:'../etc/passwd',offset:0,length:10},{http}),/WARC path/);
 await assert.rejects(()=>run('commoncrawl_fetch',{},{http}),/Give filename/);
});

test('Common Crawl index files: SURT keys, cluster.idx binary search, cdx blocks (index-server fallback)',async()=>{
 assert.deepEqual(archive.surtPattern('www.example.com/Perfume/*'),{prefix:'com,example)/perfume/',mode:'prefix'});
 assert.deepEqual(archive.surtPattern('https://shop.example.co.uk/a'),{prefix:'uk,co,example,shop)/a',mode:'exact'});
 assert.deepEqual(archive.surtPattern('*.example.com'),{prefix:'com,example',mode:'domain'});
 assert.deepEqual(archive.surtPattern('example.com','host'),{prefix:'com,example)/',mode:'prefix'});
 const line=(key,ts,url,status='200')=>key+' '+ts+' '+JSON.stringify({url,mime:'text/html',status,digest:'D',length:'100',offset:'5',filename:'crawl-data/CC-MAIN-2026-43/segments/1/warc/a.warc.gz'});
 assert.equal(archive.cdxLineRow(line('com,example)/perfume/a','20261005124020','https://www.example.com/perfume/a'),'CC-MAIN-2026-43').date,'2026-10-05T12:40:20Z');
 // Three cdx blocks; the perfume pages start in block 1 and continue into block 2.
 const blocks=[[line('com,aaa)/','20261001000000','https://aaa.com/')],
  [line('com,example)/about','20261001000000','https://www.example.com/about'),line('com,example)/perfume/a','20261002000000','https://www.example.com/perfume/a'),line('com,example)/perfume/b','20261002000000','https://www.example.com/perfume/b','404')],
  [line('com,example)/perfume/c','20261003000000','https://www.example.com/perfume/c'),line('com,zzz)/','20261003000000','https://zzz.com/')]].map(b=>gzipSync(b.join('\n')+'\n'));
 let off=0;const filler=Array.from({length:3000},(_,i)=>'com,aa'+String(i).padStart(5,'0')+')/ 20261001000000\tcdx-00000.gz\t0\t'+blocks[0].length+'\t'+i);
 const keys=['com,example)/about 20261001000000','com,example)/perfume/c 20261003000000'];
 const cluster=[...filler,...keys.map((k,i)=>{off+=i?blocks[1].length:blocks[0].length;return k+'\tcdx-00000.gz\t'+off+'\t'+blocks[i+1].length+'\t'+(3000+i);}),'com,zzzz)/ 20261009000000\tcdx-00000.gz\t0\t1\t3002'].join('\n')+'\n';
 const cdx=Buffer.concat(blocks),clusterBytes=Buffer.from(cluster);
 const range=(buf,h)=>{const [a,b]=h.Range.replace('bytes=','').split('-').map(Number);return {status:206,headers:{'content-range':'bytes '+a+'-'+b+'/'+buf.length},bytes:buf.subarray(a,b+1),url:''};};
 const calls=[];const http={json:async()=>{throw Error('no json');},raw:async(url,o)=>{calls.push(url);return url.endsWith('cluster.idx')?range(clusterBytes,o.headers):range(cdx,o.headers);}};
 const rows=await archive.ccIndexFromFiles(http,'CC-MAIN-2026-43',{url:'www.example.com/perfume/*'});
 assert.deepEqual(rows.map(r=>r.url),['https://www.example.com/perfume/a','https://www.example.com/perfume/c'],'404 capture dropped, both blocks read');
 assert.ok(calls.filter(u=>u.endsWith('cluster.idx')).length<12,'binary search, not a full download');
 assert.equal((await archive.ccIndexFromFiles(http,'CC-MAIN-2026-43',{url:'www.example.com/perfume/*',allStatuses:true})).length,3);
 // The server-first path falls back to the files on a 5xx.
 const viaServer=await archive.ccIndex({...http,text:async()=>{throw new sources.PublicHttpError(504,'index.commoncrawl.org','');}},'CC-MAIN-2026-43',{url:'www.example.com/perfume/*'});
 assert.equal(viaServer.length,2);
});

test('fetcher: text and raw modes, Range is part of the cache key',async()=>{
 const seen=[];
 const f=sources.createFetcher({transport:async(url,init)=>{seen.push(init.headers);return {status:init.headers.Range?206:200,headers:{},text:'abc',bytes:Buffer.from(init.headers.Range||'abc')};},sleep:async()=>{},defaultIntervalMs:0});
 const http=f.bind();
 assert.equal(await http.text('https://x.example/a'),'abc');
 const a=await http.raw('https://x.example/f',{headers:{Range:'bytes=0-9'}}),b=await http.raw('https://x.example/f',{headers:{Range:'bytes=10-19'}});
 assert.equal(a.status,206);assert.equal(Buffer.from(a.bytes).toString(),'bytes=0-9');assert.equal(Buffer.from(b.bytes).toString(),'bytes=10-19');
 assert.equal(seen.length,3);assert.equal(sources.HOST_INTERVALS['web.archive.org'],1000);assert.equal(sources.HOST_INTERVALS['index.commoncrawl.org'],1000);
});

test('challenge detection: real interstitials and login walls, not protection scripts',()=>{
 const d=(text,title,url='https://x.com/a',h='')=>parse.detectChallenge({text,title,url,html:h});
 // Real challenges.
 assert.equal(d('Checking if the site connection is secure. www.x.com needs to review the security of your connection before proceeding.','Just a moment...').kind,'challenge');
 assert.equal(d('Enable JavaScript and cookies to continue','x.com','https://x.com/',`<script>window._cf_chl_opt={cvId:'3'}</script>`).via,'Cloudflare challenge');
 assert.equal(d('Please verify you are human','x','https://x.com/',`<div id="px-captcha"></div>`).kind,'captcha');
 assert.equal(d('','x.com','https://x.com/',`<iframe src="https://geo.captcha-delivery.com/captcha/?initialCid=1"></iframe>`).via,'DataDome CAPTCHA');
 assert.equal(d('Please enable JS and disable any ad blocker','nytimes.com','https://x.com/',`<script data-cfasync="false">var dd={'rt':'c','cid':'A'}</script><script src="https://ct.captcha-delivery.com/c.js"></script>`).via,'DataDome CAPTCHA');
 assert.equal(d('Security check','Some shop','https://x.com/',`<iframe src="https://newassets.hcaptcha.com/captcha/v1/abc"></iframe>`).kind,'captcha');
 assert.equal(d('One more thing','Shop','https://x.com/',`<div class="g-recaptcha" data-sitekey="k"></div>`).kind,'captcha');
 assert.equal(d('Our systems have detected unusual traffic from your computer network.','Sorry').kind,'captcha');
 assert.equal(d('You don\'t have permission to access "http://x.com/a" on this server. Reference #18.1','Access Denied').kind,'denied');
 assert.equal(d('Please log in to continue','Sign in','https://x.com/login?next=/a').kind,'login');
 assert.equal(d('Welcome back','My site','https://x.com/a',`<form><input type="email"><input type="password"></form>`).kind,'login');
 // Normal pages that only load a protection or CAPTCHA script stay readable.
 const article='Fragrance notes, ratings and reviews for hundreds of perfumes. '.repeat(80);
 assert.equal(d(article,'Perfumes','https://x.com/p',`<script>window.__CF$cv$params={r:'1'};a.src='/cdn-cgi/challenge-platform/scripts/jsd/main.js'</script><script src="https://js.datadome.co/tags.js"></script>`),null);
 assert.equal(d(article,'Contact','https://x.com/contact',`<iframe src="https://www.google.com/recaptcha/api2/anchor?k=1" style="display:none"></iframe>`),null);
 assert.equal(d('A short product page with a price of $20 and a buy button.','Product','https://x.com/p',`<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async></script>`),null);
 assert.equal(d('Short bio of the author.','Author','https://x.com/author/jane'),null);
 assert.equal(d(article,'Just a moment...'),null,'a long real page titled like a challenge is not one');
 // Structured hint with Wayback and Common Crawl fallbacks.
 const hint=parse.blockedHint('https://www.example.com/perfume/a?x=1',d('','Just a moment...'));
 assert.equal(hint.blocked,true);assert.match(hint.reason,/interactive challenge/);
 assert.equal(hint.fallbacks[0].url,'https://web.archive.org/web/https://www.example.com/perfume/a?x=1');
 assert.deepEqual(hint.fallbacks[1].arguments,{url:'www.example.com/perfume/*'});
});

test('robots.txt switch: respect by default, ignore on CRAWL_ROBOTS=ignore',()=>{
 const rules=robots.parseRobots('User-agent: *\nDisallow: /perfume/\n');
 assert.equal(robots.robotsMode(undefined),'respect');assert.equal(robots.robotsMode('respect'),'respect');assert.equal(robots.robotsMode('bogus'),'respect');assert.equal(robots.robotsMode(' IGNORE '),'ignore');
 assert.equal(robots.crawlAllowed(rules,'/perfume/a','respect'),false);
 assert.equal(robots.crawlAllowed(rules,'/perfume/a','ignore'),true);
 assert.equal(robots.crawlAllowed(rules,'/about','respect'),true);
 assert.equal(robots.crawlAllowed(null,'/perfume/a','respect'),true);
});

test('the crawl result states the robots mode and keeps politeness',()=>{
 const src=readFileSync('app/data-tools/crawl.ts','utf8');
 assert.match(src,/robotsMode\(process\.env\.CRAWL_ROBOTS\)/);assert.match(src,/robots:mode/);assert.match(src,/MIN_GAP_MS=1000/);
 assert.match(readFileSync('app/public-data/service.ts','utf8'),/import '@\/app\/public-data\/archive';/);
 assert.ok(sources.REGISTERED_SOURCES.some(s=>s.id==='archive'),'archive registers itself as a public source');
});
