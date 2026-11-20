import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {isIP} from 'node:net';import ts from 'typescript';import jsonata from 'jsonata';
// Data acquisition tools (rankwiki): pure parsing, table extraction, crawl rules, queries and address checks.
const load=async(file,prelude='')=>import('data:text/javascript;base64,'+Buffer.from(prelude+ts.transpile(readFileSync(file,'utf8').replace(/^import .*;$/gm,''),{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
const html=await load('app/data-tools/html.ts');
const parse=await load('app/data-tools/parse.ts');
const robots=await load('app/data-tools/robots.ts');
const paging=await load('app/data-tools/paging.ts');
const ops=await load('app/data-tools/table-ops.ts');
globalThis.__jsonata=jsonata;
const query=await load('app/data-tools/query.ts','const jsonata=globalThis.__jsonata;\n');
globalThis.__isIP=isIP;
const fetchMod=await load('app/url-content/fetch.ts','const isIP=globalThis.__isIP,lookup=null,httpRequest=null,httpsRequest=null,gunzipSync=null,inflateSync=null,brotliDecompressSync=null;\n');
globalThis.__fetch=fetchMod;
globalThis.__lookup=async(host)=>({'rebind.example.com':[{address:'127.0.0.1',family:4}],'mixed.example.com':[{address:'93.184.216.34',family:4},{address:'10.0.0.5',family:4}],'ok.example.com':[{address:'93.184.216.34',family:4}]})[host]||[];
const net=await load('app/data-tools/net.ts','const {sourceUrl,fetchSource,publicIPv4}=globalThis.__fetch;const isIP=globalThis.__isIP;const lookup=globalThis.__lookup;\n');

const WIKI=`<html><head><title>List of things - Wikipedia</title></head><body>
<h2><span class="mw-headline">Countries</span><span class="mw-editsection">[edit]</span></h2>
<table class="wikitable sortable"><caption>Countries by area</caption>
<thead><tr><th rowspan="2">Rank</th><th rowspan="2">Country</th><th colspan="2">Total area</th><th rowspan="2">Notes</th></tr>
<tr><th>km<sup>2</sup></th><th>mi<sup>2</sup></th></tr></thead>
<tbody><tr class="mw-empty-elt"></tr>
<tr><td>1</td><td><span class="flagicon"><img alt="Flag of Russia" src="x.png"></span> <a href="/wiki/Russia">Russia</a><sup class="reference"><a href="#cite_note-1">[1]</a></sup></td><td>17,098,246</td><td>6,601,670</td><td>Largest[a]</td></tr>
<tr><td>2</td><td><a href="/wiki/Canada">Canada</a></td><td><span data-sort-value="9984670" style="display:none">x</span>9,984,670 (incl. water)</td><td>3,855,100</td><td rowspan="2">Shared note</td></tr>
<tr><td>—</td><td><a href="/wiki/World">World</a>&nbsp;[note 2]</td><td>148,940,000</td><td>57,510,000</td></tr>
<tr><td colspan="5">Dependencies</td></tr>
<tr><td>4</td><td><img alt="Greenland" src="g.png"></td><td>2,166,086</td><td>836,330</td><td>&minus;</td></tr>
</tbody></table>
<table class="navbox"><tr><td>nav</td></tr></table>
<table class="wikitable"><tr><td>Year</td><td>Value</td></tr><tr><td>1990–2000</td><td>12.5%</td></tr><tr><td>2001</td><td>−3.4</td></tr><tr><td>2002</td><td>007</td></tr></table>
</body></html>`;

test('Wikipedia-like table: rowspan/colspan, multi-row headers, footnotes, flags, sort keys, numbers',()=>{
 const tables=html.extractTables(WIKI,{baseUrl:'https://en.wikipedia.org/wiki/List'});
 assert.equal(tables.length,2,'navbox skipped');
 const t=tables[0];
 assert.equal(t.caption,'Countries by area');assert.equal(t.section,'Countries');
 assert.deepEqual(t.headers,['Rank','Country','Country (url)','Total area - km2','Total area - km2 (number)','Total area - mi2','Notes','_group']);
 assert.ok(t.headers.includes('Total area - km2'));assert.ok(t.headers.includes('Total area - km2 (number)'));assert.ok(t.headers.includes('Country (url)'));
 assert.equal(t.rows.length,4,'the full-width group row is not a data row');
 const [russia,canada,world,greenland]=t.rows;
 assert.equal(russia.Country,'Russia','a flag\'s alt text does not repeat the name');assert.equal(russia['Country (url)'],'https://en.wikipedia.org/wiki/Russia');
 assert.equal(russia['Total area - km2'],'17,098,246');assert.equal(russia['Total area - km2 (number)'],17098246);
 assert.equal(russia['Total area - mi2'],6601670,'pure-number column is numeric');
 assert.equal(russia.Notes,'Largest');assert.equal(russia.Rank,1);
 assert.equal(canada['Total area - km2'],'9,984,670 (incl. water)');assert.equal(canada['Total area - km2 (number)'],9984670);
 assert.equal(world.Notes,'Shared note','rowspan copies the cell down');assert.equal(world.Country,'World');assert.equal(world.Rank,'—');
 assert.equal(greenland._group,'Dependencies');assert.equal(greenland.Country,'Greenland','a flag-only cell uses its alt text');assert.equal(russia._group,'');
 const t2=tables[1];
 assert.equal(t2.rows[0].Year,'1990–2000','a range is not a number');assert.equal(t2.rows[0]['Year (number)'],null);assert.equal(t2.rows[1].Year,'2001','a mixed column keeps its text');assert.equal(t2.rows[1]['Year (number)'],2001);
 assert.equal(t2.rows[0].Value,12.5);assert.equal(t2.rows[1].Value,-3.4);
});

test('number parsing keeps codes and dates as text',()=>{
 assert.deepEqual(html.parseNumber('1,234,567'),{value:1234567,pure:true});
 assert.equal(html.parseNumber('~400').pure,false);
 assert.equal(html.parseNumber('12 May 2020').pure,false);
 assert.equal(html.parseNumber('abc'),null);
 assert.equal(parse.castValue('007'),'007');assert.equal(parse.castValue('1,234'),1234);assert.equal(parse.castValue('-0.5'),-0.5);assert.equal(parse.castValue('x1'),'x1');
});

test('CSV/TSV parsing: quotes, embedded newlines, numeric casting, BOM',()=>{
 const rows=parse.parseDelimited('\uFEFFname,pop,note\n"Côte d\'Ivoire",28160542,"a, ""b""\nc"\nChad,"17,723,315",\n');
 assert.deepEqual(rows,[{name:"Côte d'Ivoire",pop:28160542,note:'a, "b"\nc'},{name:'Chad',pop:17723315,note:''}]);
 assert.deepEqual(parse.parseDelimited('a\tb\n1\tx\n','\t'),[{a:1,b:'x'}]);
 assert.deepEqual(parse.parseDelimited('a;b\n1;2\n'),[{a:1,b:2}],'delimiter detected');
 assert.equal(parse.detectFormat('text/csv','a,b'),'csv');assert.equal(parse.detectFormat('','{"a":1}\n{"a":2}\n'),'jsonl');
 assert.equal(parse.detectFormat('application/json','[1]'),'json');assert.equal(parse.detectFormat('application/rss+xml','<rss>'),'xml');
});

test('JSON responses: the largest array of objects, flattened; JSON Lines',()=>{
 const wb=[{page:1,pages:1,total:2},[{country:{id:'FR',value:'France'},countryiso3code:'FRA',date:'2023',value:68170228},{country:{id:'DE',value:'Germany'},countryiso3code:'DEU',date:'2023',value:84482267}]];
 const r=parse.jsonRows(wb);assert.equal(r.path,'$[1]');assert.equal(r.rows.length,2);assert.equal(r.rows[0]['country.value'],'France');assert.equal(r.rows[1].value,84482267);
 assert.equal(parse.jsonRows({meta:{n:1},data:{results:[{a:1},{a:2},{a:3}]}}).path,'$.data.results');
 const col=parse.jsonRows({values:[5,6,7],years:[2000,2001,2002],entities:[1,1,2],meta:{x:1}});assert.deepEqual(col.rows[2],{values:7,years:2002,entities:2},'columnar arrays are zipped');
 assert.deepEqual(parse.parseJsonLines('{"a":1}\n\n{"a":2}\n'),[{a:1},{a:2}]);
 assert.throws(()=>parse.parseJsonLines('{"a":1}\nnope'),/Line 2/);
 assert.match(parse.describeShape({data:[{id:1,name:'x'}],total:3}),/data:array\(1×object\{id,name\}\)/);
});

test('XML: RSS items and Atom entries become rows',()=>{
 const rss=`<?xml version="1.0"?><rss version="2.0"><channel><title>Feed</title>
  <item><title>One &amp; two</title><link>https://a.example/1</link><category>x</category><category>y</category></item>
  <item><title><![CDATA[Three <b>3</b>]]></title><link>https://a.example/3</link></item></channel></rss>`;
 const r=parse.xmlRows(rss);assert.equal(r.element,'item');assert.equal(r.rows.length,2);
 assert.equal(r.rows[0].title,'One & two');assert.equal(r.rows[0].category,'x; y');assert.equal(r.rows[1].title,'Three <b>3</b>');
 const atom=`<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>1</id><link href="https://b/1"/></entry><entry><id>2</id><link href="https://b/2"/></entry></feed>`;
 const a=parse.xmlRows(atom);assert.equal(a.element,'entry');assert.equal(a.rows[1]['link.@href'],'https://b/2');assert.equal(a.rows[0].id,1);
});

test('blocked pages are recognised',()=>{
 assert.match(parse.blockedReason('Checking your browser… Verify you are human','Just a moment...','https://x.com/a'),/interactive challenge/);
 assert.match(parse.blockedReason('Please log in to continue','Sign in','https://x.com/login'),/login/);
 assert.equal(parse.blockedReason('A long ordinary article '.repeat(300),'Article','https://x.com/a'),null);
});

test('JSONata query joins datasets, with errors that name position and inputs',async()=>{
 const scope={pop:[{name:'France',iso3:'FRA',population:68e6},{name:'Chad',iso3:'TCD',population:18e6},{name:'Nowhere',iso3:'XXX',population:0}],gdp:[{iso3:'FRA',value:3.0e12},{iso3:'TCD',value:1.3e10}]};
 const expr='($g := gdp{iso3: value}; pop[$lookup($g, iso3) and population > 0].{"name":name,"gdpPerCapita":$round($lookup($g, iso3)/population,0)}^(>gdpPerCapita))';
 const r=await query.evaluateJsonata(expr,scope);
 assert.deepEqual(query.resultRows(r,10).rows,[{name:'France',gdpPerCapita:44118},{name:'Chad',gdpPerCapita:722}]);
 await assert.rejects(query.evaluateJsonata('pop[name = ',scope,{},1000,()=>'pop (3 rows)'),/character \d+.*Available: pop/);
 await assert.rejects(query.evaluateJsonata('($f := function($n){ $f($n+1) }; $f(0))',{},{},2000),/too deep|longer/);
 assert.throws(()=>query.resultRows([1,2],10),/array of row objects/);
 assert.equal((await query.evaluateJsonata('$setParam($url,"page",2)',{}, {url:'https://a.example/x?page=1&q=1',setParam:paging.setParam})),'https://a.example/x?page=2&q=1');
 const wb=[{page:1,pages:2},[{country:{value:'France'},countryiso3code:'FRA',value:1}]];
 assert.deepEqual(await query.evaluateJsonata('$[1].{"name":country.value,"code":countryiso3code}',wb),{name:'France',code:'FRA'});
});

test('pagination stops at the limit, on repeats, on empty pages and on null',async()=>{
 const fetchPage=async(url)=>{const n=Number(new URL(url).searchParams.get('p'));return {url,raw:{n},rows:n<=3?[{n}]:[]};};
 const next=async(page)=>'https://a.example/?p='+(page.raw.n+1);
 let r=await paging.paginate('https://a.example/?p=1',2,fetchPage,next);assert.equal(r.rows.length,2);assert.match(r.stop,/page limit/);
 r=await paging.paginate('https://a.example/?p=1',10,fetchPage,next);assert.equal(r.rows.length,3);assert.match(r.stop,/no rows/);
 r=await paging.paginate('https://a.example/?p=1',10,fetchPage,async()=>'https://a.example/?p=1');assert.equal(r.rows.length,1);assert.match(r.stop,/repeated/);
 r=await paging.paginate('https://a.example/?p=1',10,fetchPage,async()=>null);assert.equal(r.pages.length,1);assert.match(r.stop,/last page/);
});

test('robots.txt rules: groups, longest match, Allow ties, wildcards',()=>{
 const rules=robots.parseRobots(`User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /w/\nDisallow: /*?action=\nAllow: /w/load.php\nDisallow: /private$\nCrawl-delay: 2\n`);
 assert.equal(robots.robotsAllows(rules,'/wiki/France'),true);
 assert.equal(robots.robotsAllows(rules,'/w/index.php'),false);
 assert.equal(robots.robotsAllows(rules,'/w/load.php'),true);
 assert.equal(robots.robotsAllows(rules,'/wiki/X?action=edit'),false);
 assert.equal(robots.robotsAllows(rules,'/private'),false);assert.equal(robots.robotsAllows(rules,'/private/x'),true);
 assert.equal(rules.crawlDelay,2);
 const named=robots.parseRobots('User-agent: *\nDisallow: /\nUser-agent: rankwiki-bot\nDisallow: /tmp\n');
 assert.equal(robots.robotsAllows(named,'/x'),true);assert.equal(robots.robotsAllows(named,'/tmp/a'),false);
 assert.equal(robots.robotsAllows(robots.parseRobots(''),'/anything'),true);
});

test('same-site checks and link patterns',()=>{
 assert.equal(robots.siteOf('www.bbc.co.uk'),'bbc.co.uk');assert.equal(robots.siteOf('en.wikipedia.org'),'wikipedia.org');
 assert.equal(robots.sameSite('en.wikipedia.org','de.wikipedia.org'),true);assert.equal(robots.sameSite('a.com','a.com.evil.net'),false);
 assert.equal(robots.linkMatcher('/page/')('https://x.com/page/2'),true);assert.equal(robots.linkMatcher('/page/')('https://x.com/p/2'),false);
 assert.equal(robots.linkMatcher('page=\\d+')('https://x.com/?page=3'),true);
 assert.throws(()=>robots.linkMatcher('(['),/regular expression/);
});

test('private, loopback and rebinding addresses are refused',async()=>{
 for(const u of ['http://localhost/x','http://127.0.0.1/','http://10.0.0.1/','http://169.254.169.254/latest/meta-data','http://192.168.1.1/','http://[::1]/','http://foo.internal/'])assert.throws(()=>net.publicUrl(u),/public/,u);
 assert.throws(()=>net.publicUrl('file:///etc/passwd'),/valid/);
 assert.equal(net.publicUrl('https://api.worldbank.org/v2/x').hostname,'api.worldbank.org');
 assert.equal(await net.allowedRequestUrl('http://127.0.0.1:8080/'),false);
 assert.equal(await net.allowedRequestUrl('http://rebind.example.com/'),false,'a name resolving to loopback');
 assert.equal(await net.allowedRequestUrl('http://mixed.example.com/'),false,'any private address refuses the host');
 assert.equal(await net.allowedRequestUrl('https://ok.example.com/a.json'),true);
 assert.equal(await net.allowedRequestUrl('ws://192.168.0.2/socket'),false);
 assert.equal(await net.allowedRequestUrl('data:text/plain,hi'),true);
 assert.equal(await net.allowedRequestUrl('file:///etc/passwd'),false);
 assert.equal(net.publicIPv6('::1'),false);assert.equal(net.publicIPv6('fe80::1'),false);assert.equal(net.publicIPv6('::ffff:10.0.0.1'),false);assert.equal(net.publicIPv6('2606:4700::1111'),true);
});

test('table operations: stats, ranges, column selection, CSV quoting',()=>{
 const rows=[{a:1,b:'x'},{a:3,b:'x'},{a:'',b:'y, "z"'}];
 const [a,b]=ops.columnStats(rows,['a','b']);
 assert.deepEqual([a.type,a.min,a.max,a.mean,a.missing],['number',1,3,2,1]);assert.equal(b.top[0].value,'x');
 assert.deepEqual(ops.rowRange('2-3',10),{start:1,end:3});assert.equal(ops.rowRange('all-if-small',500).end,0);assert.throws(()=>ops.rowRange('x',3));
 const p=ops.pickColumns(rows,['a','b'],['b','a'],{b:'label'});assert.deepEqual(p.columns,['label','a']);
 assert.equal(ops.toCsv(p.rows,p.columns),'label,a\nx,1\nx,3\n"y, ""z""",\n');
 assert.throws(()=>ops.pickColumns(rows,['a','b'],['c']),/Unknown column/);
});
