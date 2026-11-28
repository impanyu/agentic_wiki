import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';import {z} from 'zod';
// Built-in public data sources: pure normalizers, the HTTP layer (limiter, cache, retries) and
// tool argument validation, loaded without the server runtime or the network.
globalThis.publicSourcesTest={z};
const src=['fetcher.ts','normalize.ts','sources.ts'].map(f=>readFileSync('app/public-data/'+f,'utf8').replace(/^import .*;$/gm,'')).join('\n');
const m=await import('data:text/javascript;base64,'+Buffer.from('const {z}=globalThis.publicSourcesTest;\n'+ts.transpile(src,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
const tool=(source,name)=>m.FIXED_SOURCES.find(s=>s.id===source).tools.find(t=>t.name===name);
const fakeHttp=(responses)=>{const calls=[];return {calls,json:async(url,o)=>{calls.push({url,o});const r=typeof responses==='function'?responses(url):responses[Object.keys(responses).find(k=>url.includes(k))];if(r instanceof Error)throw r;return structuredClone(r);}};};

test('SPARQL results flatten to plain rows',()=>{
 const json={head:{vars:['country','countryLabel','population','area','inception','flag','member','note']},results:{bindings:[
  {country:{type:'uri',value:'http://www.wikidata.org/entity/Q142'},countryLabel:{type:'literal',value:'France','xml:lang':'en'},population:{type:'literal',datatype:'http://www.w3.org/2001/XMLSchema#decimal',value:'68373433'},area:{type:'literal',datatype:'http://www.w3.org/2001/XMLSchema#double',value:'6.4E5'},inception:{type:'literal',datatype:'http://www.w3.org/2001/XMLSchema#dateTime',value:'1792-09-22T00:00:00Z'},flag:{type:'uri',value:'http://commons.wikimedia.org/wiki/Special:FilePath/Flag%20of%20France.svg'},member:{type:'literal',datatype:'http://www.w3.org/2001/XMLSchema#boolean',value:'true'}},
  {country:{type:'uri',value:'http://www.wikidata.org/entity/Q183'},countryLabel:{type:'literal',value:'Germany'},population:{type:'literal',datatype:'http://www.w3.org/2001/XMLSchema#integer',value:'not-a-number'},inception:{type:'literal',datatype:'http://www.w3.org/2001/XMLSchema#dateTime',value:'1949-05-23T12:00:00Z'},note:{type:'bnode',value:'b0'}}]}};
 const {columns,rows}=m.flattenSparql(json);
 assert.deepEqual(columns,json.head.vars);
 assert.deepEqual(rows[0],{country:'Q142',countryLabel:'France',population:68373433,area:640000,inception:'1792-09-22',flag:'https://commons.wikimedia.org/wiki/Special:FilePath/Flag%20of%20France.svg',member:true,note:null});
 assert.equal(rows[1].population,'not-a-number');assert.equal(rows[1].inception,'1949-05-23T12:00:00Z');assert.equal(rows[1].area,null);assert.equal(rows[1].note,null);
 assert.deepEqual(m.flattenSparql({head:{},boolean:true}).rows,[{result:true}]);
 assert.deepEqual(m.flattenSparql(null),{columns:[],rows:[]});
 assert.match(m.sparqlWithLimit('SELECT ?x WHERE {?x ?p ?o};',50),/\nLIMIT 50$/);
 assert.equal(m.sparqlWithLimit('SELECT ?x WHERE {?x ?p ?o} LIMIT 5',50),'SELECT ?x WHERE {?x ?p ?o} LIMIT 5');
 assert.doesNotMatch(m.sparqlWithLimit('PREFIX a: <x>\nASK { ?x ?p ?o }',50),/LIMIT/);
});

test('Wikidata claims: preferred rank, deprecated dropped, units, dates, Commons images and labels',()=>{
 const snak=(datavalue,datatype='quantity')=>({snaktype:'value',datatype,datavalue});
 const claims={
  P1082:[{rank:'normal',mainsnak:snak({type:'quantity',value:{amount:'+60000000',unit:'1'}})},{rank:'preferred',mainsnak:snak({type:'quantity',value:{amount:'+68000000',unit:'1'}}),qualifiers:{P585:[{datavalue:{type:'time',value:{time:'+2024-01-01T00:00:00Z',precision:9}}}]}}],
  P2046:[{rank:'normal',mainsnak:snak({type:'quantity',value:{amount:'+643801',unit:'http://www.wikidata.org/entity/Q712226'}})}],
  P36:[{rank:'deprecated',mainsnak:snak({type:'wikibase-entityid',value:{id:'Q1'}},'wikibase-item')},{rank:'normal',mainsnak:snak({type:'wikibase-entityid',value:{id:'Q90'}},'wikibase-item')}],
  P18:[{rank:'normal',mainsnak:snak({type:'string',value:'Eiffel Tower.jpg'},'commonsMedia')}],
  P571:[{rank:'normal',mainsnak:snak({type:'time',value:{time:'+0843-08-10T00:00:00Z',precision:11}},'time')}],
 };
 const c=m.compactClaims(claims,null);
 assert.deepEqual(c.P1082,[{value:68000000,pointInTime:'2024'}]);
 assert.deepEqual(c.P36,[{id:'Q90'}]);assert.equal(c.P18[0],'https://commons.wikimedia.org/wiki/Special:FilePath/Eiffel_Tower.jpg');assert.deepEqual(c.P571,['843-08-10']);
 const ids=new Set();m.wikidataIds(c,ids);assert.deepEqual([...ids].sort(),['Q712226','Q90']);
 const labelled=m.labelIds(c,new Map([['Q90','Paris'],['Q712226','square kilometre']]));
 assert.deepEqual(labelled.P36,[{id:'Q90',label:'Paris'}]);assert.deepEqual(labelled.P2046,[{amount:643801,unit:'square kilometre'}]);
 assert.deepEqual(Object.keys(m.compactClaims(claims,['P36','P999'])),['P36']);
});

const wbMeta=[{page:1},[
 {id:'FRA',iso2Code:'FR',name:'France',region:{id:'ECS',value:'Europe & Central Asia '},incomeLevel:{id:'HIC',value:'High income'},capitalCity:'Paris',longitude:'2.35',latitude:'48.85'},
 {id:'IND',iso2Code:'IN',name:'India',region:{id:'SAS',value:'South Asia'},incomeLevel:{value:'Lower middle income'},capitalCity:'New Delhi',longitude:'77.2',latitude:'28.6'},
 {id:'WLD',iso2Code:'1W',name:'World',region:{id:'NA',value:'Aggregates'},incomeLevel:{id:'NA',value:'Aggregates'},capitalCity:''},
 {id:'EUU',iso2Code:'EU',name:'European Union',region:{id:'NA',value:'Aggregates'}},
 {id:'TUV',iso2Code:'TV',name:'Tuvalu',region:{id:'EAS',value:'East Asia & Pacific'}}]];
const wbData=[{page:1,total:5},[
 {indicator:{id:'SP.POP.TOTL',value:'Population, total'},country:{id:'1W',value:'World'},countryiso3code:'WLD',date:'2024',value:8e9},
 {indicator:{id:'SP.POP.TOTL',value:'Population, total'},country:{id:'EU',value:'European Union'},countryiso3code:'EUU',date:'2024',value:4.5e8},
 {indicator:{id:'SP.POP.TOTL',value:'Population, total'},country:{id:'FR',value:'France'},countryiso3code:'FRA',date:'2024',value:68e6},
 {indicator:{id:'SP.POP.TOTL',value:'Population, total'},country:{id:'IN',value:'India'},countryiso3code:'IND',date:'2023',value:1.43e9},
 {indicator:{id:'SP.POP.TOTL',value:'Population, total'},country:{id:'TV',value:'Tuvalu'},countryiso3code:'TUV',date:'2024',value:null}]];

test('World Bank: aggregates excluded via region.id "NA", missing values counted, sorted by value',()=>{
 const meta=m.wbCountries(wbMeta);
 assert.deepEqual(meta.filter(c=>c.aggregate).map(c=>c.iso3),['WLD','EUU']);
 assert.equal(meta[0].region,'Europe & Central Asia');assert.equal(meta[0].lat,48.85);
 const r=m.wbIndicatorRows(wbData,meta);
 assert.deepEqual(r.rows,[{name:'India',iso3:'IND',value:1.43e9,year:2023},{name:'France',iso3:'FRA',value:68e6,year:2024}]);
 assert.equal(r.missing,1);assert.deepEqual(r.indicator,{id:'SP.POP.TOTL',name:'Population, total'});
 assert.equal(m.wbIndicatorRows(wbData,meta,{includeAggregates:true}).rows[0].iso3,'WLD');
 assert.equal(m.wbIndicatorRows(wbData,meta,{keepMissing:true}).rows.at(-1).iso3,'TUV');
 assert.throws(()=>m.wbIndicatorRows([{message:[{value:'The indicator was not found.'}]}],meta),/not found/);
 assert.deepEqual(m.searchIndicatorList([{id:'NY.GDP.MKTP.CD',name:'GDP (current US$)'},{id:'NY.GDP.PCAP.CD',name:'GDP per capita (current US$)'},{id:'SP.POP.TOTL',name:'Population, total'}],'gdp capita',5).map(r=>r.id),['NY.GDP.PCAP.CD']);
});

test('worldbank.indicator builds the request and returns rows; countries.list adds flags',async()=>{
 const http=fakeHttp(url=>url.includes('/country?')?wbMeta:url.includes('/indicator/SP.POP.TOTL?format=json&per_page=500')?wbData:url.includes('/indicator/AG.SRF')?[{},[{country:{value:'France'},countryiso3code:'FRA',date:'2022',value:547557}]]:url.match(/\/v2\/indicator\//)?[{},[{id:'SP.POP.TOTL',name:'Population, total',sourceNote:'All residents.'}]]:wbData);
 const r=await tool('worldbank','indicator').run({indicator:'SP.POP.TOTL'},{http,env:()=>undefined});
 assert.match(http.calls[0].url,/\/country\/all\/indicator\/SP\.POP\.TOTL\?format=json&per_page=20000&mrnev=1$/);
 assert.equal(r.rows.length,2);assert.equal(r.indicator.definition,'All residents.');assert.equal(r.period,'most recent value per country');
 await tool('worldbank','indicator').run({indicator:'NY.GDP.MKTP.CD',countries:['fr','IND'],year:2020},{http,env:()=>undefined});
 assert.match(http.calls.at(-3).url,/\/country\/FR;IND\/indicator\/NY\.GDP\.MKTP\.CD\?format=json&per_page=20000&date=2020$/);
 const c=await tool('countries','list').run({},{http,env:()=>undefined});
 const fr=c.rows.find(x=>x.iso3==='FRA');
 assert.equal(fr.flag,'https://flagcdn.com/w320/fr.png');assert.equal(fr.population,68e6);assert.equal(fr.areaKm2,547557);
 assert.ok(!c.rows.some(x=>x.iso3==='WLD'));
});

test('App Store RSS charts normalize to ranked rows with large artwork',()=>{
 const rows=m.appleChartRows({feed:{results:[
  {artistName:'OpenAI',id:'6448311069',name:'ChatGPT',releaseDate:'2023-05-18',kind:'apps',artworkUrl100:'https://is1-ssl.mzstatic.com/image/thumb/x/AppIcon.png/100x100bb.png',genres:[],url:'https://apps.apple.com/us/app/chatgpt/id6448311069'},
  {artistName:'Taylor Swift',id:'1',name:'Song',kind:'songs',artworkUrl100:'https://x/100x100bb.jpg',genres:[{genreId:'34',name:'Music'},{genreId:'14',name:'Pop'}],url:'https://music.apple.com/x'}]}});
 assert.deepEqual(rows[0],{rank:1,id:'6448311069',name:'ChatGPT',artist:'OpenAI',genre:null,releaseDate:'2023-05-18',url:'https://apps.apple.com/us/app/chatgpt/id6448311069',artwork:'https://is1-ssl.mzstatic.com/image/thumb/x/AppIcon.png/512x512bb.png',kind:'apps'});
 assert.equal(rows[1].rank,2);assert.equal(rows[1].genre,'Pop');assert.equal(rows[1].releaseDate,null);
 assert.deepEqual(m.appleChartRows({}),[]);
 assert.equal(m.appleChartUrl('top-paid-apps','GB',30),'https://rss.marketingtools.apple.com/api/v2/gb/apps/top-paid/50/apps.json');
 assert.equal(m.appleChartUrl('most-played-songs','us',10),'https://rss.marketingtools.apple.com/api/v2/us/music/most-played/10/songs.json');
});

test('Overpass and other normalizers',()=>{
 const rows=m.osmRows({elements:[{type:'way',id:5,center:{lat:1,lon:2},tags:{name:'Allianz Arena',capacity:'75024','name:de':'x','name:en':'Allianz Arena',leisure:'stadium',source:'survey'}},{type:'node',id:6,lat:3,lon:4}]});
 assert.deepEqual(rows[0],{osmType:'way',osmId:5,name:'Allianz Arena',lat:1,lon:2,capacity:'75024','name:en':'Allianz Arena',leisure:'stadium',url:'https://www.openstreetmap.org/way/5'});
 assert.equal(rows[1].name,null);
 assert.equal(m.overpassQuery('nwr[leisure=stadium];out;',30),'[out:json][timeout:30];\nnwr[leisure=stadium];out;');
 assert.equal(m.overpassQuery('[out:xml][timeout:900];node;out;',60),'[out:json][timeout:60];node;out;');
 assert.equal(m.coinRow({market_cap_rank:1,id:'bitcoin',symbol:'btc',name:'Bitcoin',current_price:1}).symbol,'BTC');
 assert.equal(m.openAlexRow('institutions',{id:'https://openalex.org/I1',display_name:'MIT',works_count:3,cited_by_count:9,summary_stats:{h_index:7}}).id,'I1');
 assert.equal(m.stripHtml('a <b>&amp;</b> b'),'a & b');
});

test('the host limiter spaces requests per host; other hosts are not delayed',async()=>{
 let clock=0;const waits=[];
 const limiter=new m.HostLimiter(h=>h==='slow.example'?1000:100,()=>clock,async ms=>{waits.push(ms);});
 await limiter.wait('slow.example');await limiter.wait('slow.example');await limiter.wait('slow.example');await limiter.wait('fast.example');
 assert.deepEqual(waits,[1000,2000]);
 clock=5000;await limiter.wait('slow.example');assert.equal(waits.length,2);
 const busy=new m.HostLimiter(()=>40_000,()=>0,async()=>{});await busy.wait('h');await busy.wait('h');
 await assert.rejects(busy.wait('h'),/busy/);
});

test('the fetcher caches GETs for 10 minutes, retries 429/5xx at most twice and reports HTTP errors',async()=>{
 let clock=0,calls=0;const sleeps=[];
 const replies=[];const transport=async(url,init)=>{calls++;assert.match(init.headers['User-Agent'],/^rankwiki-bot\/1\.0/);return replies.shift()||{status:200,headers:{},text:'{"ok":1}'};};
 const f=createF();function createF(){return m.createFetcher({transport,now:()=>clock,sleep:async ms=>{sleeps.push(ms);},defaultIntervalMs:0});}
 assert.deepEqual(await f.json('https://a.example/x'),{ok:1});assert.deepEqual(await f.json('https://a.example/x'),{ok:1});assert.equal(calls,1);
 clock=601_000;await f.json('https://a.example/x');assert.equal(calls,2);
 replies.push({status:429,headers:{'retry-after':'2'},text:''},{status:503,headers:{},text:'down'});
 assert.deepEqual(await f.json('https://a.example/y'),{ok:1});assert.equal(calls,5);assert.ok(sleeps.includes(2000)&&sleeps.includes(3000));
 replies.push({status:500,headers:{},text:''},{status:500,headers:{},text:''},{status:500,headers:{},text:''});
 await assert.rejects(f.json('https://a.example/z'),e=>e instanceof m.PublicHttpError&&e.status===500);assert.equal(calls,8);
 replies.push({status:404,headers:{},text:'{"message":"Not Found"}'});
 await assert.rejects(f.json('https://a.example/w'),/HTTP 404 from a\.example: Not Found/);assert.equal(calls,9);
 replies.push({status:200,headers:{},text:'<html>'});await assert.rejects(f.json('https://a.example/v'),/Invalid JSON/);
 const lru=new m.TtlLru(2,1000,()=>0);lru.set('a',1,10,1000);lru.set('b',2,10,1000);lru.get('a');lru.set('c',3,10,1000);
 assert.equal(lru.get('b'),undefined);assert.equal(lru.get('a'),1);assert.equal(lru.size,2);
});

test('tool arguments are validated with clear errors; schemas and signatures come from the same declaration',async()=>{
 const sparql=tool('wikidata','sparql');
 assert.throws(()=>m.parseToolArgs('wikidata',sparql,{}),/Invalid arguments for wikidata\.sparql: query Required.*Expected sparql\(query, limit\?\)/);
 assert.deepEqual(m.parseToolArgs('wikidata',sparql,{query:'x',bogus:1}),{query:'x'});
 assert.deepEqual(m.parseToolArgs('wikidata',sparql,{sparql:'SELECT'}),{query:'SELECT'});
 assert.deepEqual(m.parseToolArgs('wikidata',sparql,{query:'SELECT',limit:''}),{query:'SELECT'});
 assert.deepEqual(m.parseToolArgs('wikidata',sparql,{query:'SELECT',limit:'20'}),{query:'SELECT',limit:20});
 assert.throws(()=>m.parseToolArgs('appstore',tool('appstore','top_charts'),{chart:'top-grossing'}),/chart/);
 assert.deepEqual(m.parseToolArgs('packages',tool('packages','npm_downloads'),{packages:'react, vue'}).packages,['react','vue']);
 assert.deepEqual(m.toolSchema(sparql).required,['query']);assert.equal(m.toolSchema(sparql).additionalProperties,false);
 for(const s of m.FIXED_SOURCES)for(const t of s.tools){assert.ok(t.description.length>20,s.id+'.'+t.name);assert.equal(m.toolSchema(t).type,'object');}
 const ids=m.FIXED_SOURCES.map(s=>s.id);assert.equal(new Set(ids).size,ids.length);
 for(const id of ['wikidata','wikipedia','worldbank','countries','openalex','coingecko','appstore','steam','openstreetmap','stackexchange','hackernews','packages','gbif','openlibrary','musicbrainz'])assert.ok(ids.includes(id),id);
 const http=fakeHttp({'query.wikidata.org':{head:{vars:['x']},results:{bindings:[{x:{type:'literal',value:'1',datatype:'http://www.w3.org/2001/XMLSchema#integer'}}]}}});
 const r=await sparql.run({query:'SELECT ?x WHERE {}'},{http,env:()=>undefined});
 assert.deepEqual(r.rows,[{x:1}]);assert.equal(new URL(http.calls[0].url).searchParams.get("query"),"SELECT ?x WHERE {}\nLIMIT 1000");
 await assert.rejects(sparql.run({query:'DELETE DATA { <a> <b> <c> }'},{http,env:()=>undefined}),/read-only/);
 const gh=fakeHttp({'api.github.com':new m.PublicHttpError(403,'api.github.com','API rate limit exceeded')});
 await assert.rejects(tool('github','search_repositories').run({query:'x'},{http:gh,env:()=>undefined}),/GitHub rate limit reached \(unauthenticated/);
 assert.equal(m.FIXED_SOURCES.find(s=>s.id==='youtube').available(()=>undefined),false);
});
