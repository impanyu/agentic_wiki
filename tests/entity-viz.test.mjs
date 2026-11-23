import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';import ts from 'typescript';
// Pure helpers behind the entity-page components (entity-data.ts and entity-chart.ts with their pure dependencies inlined).
const files=['world-codes.ts','rich-helpers.ts','ranking-data.ts','ranking-geo.ts','entity-data.ts','entity-chart.ts'];
const src=files.map(f=>readFileSync('app/workflows/viz/'+f,'utf8').replace(/^import .*;$/gm,'')).join('\n');
const m=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile(src,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
const require=createRequire(import.meta.url);const topo=require('topojson-client');

test('periods sort as years, months, quarters and dates; points are cleaned and ordered',()=>{
 assert.equal(m.periodKey('2023'),2023);assert.equal(m.periodKey(2023),2023);assert.equal(m.periodKey('FY2021'),2021);assert.equal(m.periodKey('-500'),-500);
 assert.ok(m.periodKey('2023-Q2')>m.periodKey('2023-03')&&m.periodKey('2023-Q2')<m.periodKey('2023-05'));
 assert.ok(m.periodKey('2023-05-17')>m.periodKey('2023-05'));assert.equal(m.periodKey('c. 1769'),1769);
 assert.equal(m.periodKey('n/a'),null);assert.equal(m.periodKey(''),null);
 assert.deepEqual(m.normalizePoints([{period:'2021',value:'3'},{period:2019,value:1},{period:'2020',value:null},{year:2020,value:2},{period:'2021',value:4},'x']),
  [{period:'2019',value:1},{period:'2020',value:2},{period:'2021',value:4}]);
 // Without a year in every period the given order stays.
 assert.deepEqual(m.normalizePoints([{period:'b',value:1},{period:'a',value:2}]).map(p=>p.period),['b','a']);
});

test('ordinals, percentiles (ties count half, asc inverts) and top percent',()=>{
 assert.deepEqual([1,2,3,4,11,12,13,21,22,101,111].map(n=>m.ordinal(n,'en')),['1st','2nd','3rd','4th','11th','12th','13th','21st','22nd','101st','111th']);
 assert.equal(m.ordinal(4,'zh-CN'),'4','templates carry the ordinal form');assert.equal(m.ordinal(4,'de'),'4');
 const v=[10,20,30,40,50];
 assert.equal(m.percentileOf(50,v),100);assert.equal(m.percentileOf(10,v),0);assert.equal(m.percentileOf(30,v),50);
 assert.equal(m.percentileOf(10,v,'asc'),100);assert.equal(m.percentileOf(50,v,'asc'),0);
 assert.equal(m.percentileOf(20,[20,20,10]),75);assert.equal(m.percentileOf(5,[5]),100);
 assert.equal(m.topPercent(4,195),3);assert.equal(m.topPercent(1,1000),1);assert.equal(m.topPercent(195,195),100);
});

test('stat cards: change against the previous period, goodness by order, sparkline series',()=>{
 const [pop,unemp,cap,pct]=m.normalizeStats([
  {label:'Population',value:'38,965,193',format:'compact',year:2023,rank:1,of:50,history:[{period:2020,value:39538223},{period:2022,value:39029342},{period:2023,value:38965193}]},
  {label:'Unemployment',value:5.1,format:'percent',order:'asc',year:'2024',history:[{period:2023,value:4.8}]},
  {label:'Capital',value:'Sacramento'},
  {label:'Growth',value:2,history:[{period:'2022',value:0},{period:'2023',value:2}]},
  {label:'',value:1},{label:'Empty'},null]);
 assert.equal(pop.value,38965193);assert.equal(pop.rank,1);assert.equal(pop.of,50);assert.equal(pop.change.from,'2022');
 assert.equal(Math.round(pop.change.pct*100)/100,-0.16);assert.equal(pop.change.good,false);
 assert.equal(unemp.change.from,'2023');assert.equal(Math.round(unemp.change.delta*10)/10,0.3);assert.equal(unemp.change.good,false);
 assert.equal(m.changeText(unemp.change,unemp,'en-US'),'+0.3 pp');
 assert.equal(m.changeText(pop.change,pop,'en-US'),'−0.2%');
 assert.equal(cap.value,null);assert.equal(cap.text,'Sacramento');assert.equal(cap.change,null);
 // Without a year: the point before the last one when the last one is the current value; from 0 there is no relative change.
 assert.equal(pct.change.from,'2022');assert.equal(pct.change.pct,null);assert.equal(m.changeText(pct.change,pct,'en-US'),'+2');
 assert.deepEqual(m.sparkSeries(unemp).map(p=>p.period),['2023','2024']);assert.equal(m.sparkSeries(pop).length,3);
});

test('sparkline paths stay inside the box; flat series sit in the middle',()=>{
 const p=m.sparkPath([1,3,2],100,20,2);
 assert.equal(p.line,'M2,18L50,2L98,10');assert.ok(p.area.endsWith('L98,20L2,20Z'));assert.deepEqual(p.end,[98,10]);
 assert.equal(m.sparkPath([5,5],10,10,0).line,'M0,5L10,5');assert.equal(m.sparkPath([1],10,10),null);
});

const peers=[{name:'A',value:5},{name:'B',value:'50'},{name:'Côte d’Ivoire',value:20},{name:'D',value:20},{name:'E',value:1},{name:'F',value:null},{name:'G',value:9}];
test('peers rank with ties; highlight is found ignoring case and accents; position summary',()=>{
 const r=m.rankPeers(peers);
 assert.deepEqual(r.map(p=>[p.name,p.rank]),[['B',1],['Côte d’Ivoire',2],['D',2],['G',4],['A',5],['E',6]]);
 assert.equal(m.findPeer(r,'cote d’ivoire'),1);assert.equal(m.findPeer(r,'Z'),-1);assert.equal(m.findPeer(r,''),-1);
 const s=m.positionOf(r,'G');
 assert.equal(s.rank,4);assert.equal(s.n,6);assert.equal(s.top,67);assert.equal(s.percentile,40);assert.equal(s.median,14.5);
 assert.equal(s.min.name,'E');assert.equal(s.max.name,'B');
 const asc=m.rankPeers(peers,'asc');assert.equal(asc[0].name,'E');assert.equal(m.positionOf(asc,'E','asc').percentile,100);
 assert.equal(m.positionOf(r,'nobody').peer,null);
});

test('scales: auto log for skewed positive values, round ticks',()=>{
 const s=m.scaleOf([1e3,1e7]);assert.equal(s.log,true);assert.equal(m.scaleX(s,1e5,0,100),50);
 assert.deepEqual(m.ticksOf(s),[1e3,1e4,1e5,1e6,1e7]);
 const l=m.scaleOf([3,97]);assert.equal(l.log,false);assert.deepEqual(m.ticksOf(l),[25,50,75]);
 assert.equal(m.scaleOf([-5,500]).log,false);assert.equal(m.scaleOf([2,2]).max,3);
 assert.equal(m.scaleOf([1,10],true).log,true);assert.equal(m.scaleOf([0,10],true).log,false);
});

test('beeswarm: circles never overlap and stay near the axis',()=>{
 const xs=Array.from({length:200},(_,i)=>50+((i*37)%101)*.8+Math.sin(i)*3);
 const r=4,ys=m.beeswarm(xs,r);
 for(let i=0;i<xs.length;i++)for(let j=i+1;j<xs.length;j++){const d=Math.hypot(xs[i]-xs[j],ys[i]-ys[j]);assert.ok(d>=2*r-1e-3,`overlap ${i} ${j} ${d}`);}
 assert.deepEqual(m.beeswarm([0,100,200],5),[0,0,0]);
 const capped=m.beeswarm(Array(30).fill(10),3,12);assert.ok(capped.every(y=>Math.abs(y)<=12));
});

test('neighbours: a window around the entity, the leaders above a gap, the rest counted',()=>{
 const ps=Array.from({length:30},(_,i)=>({name:'P'+(i+1),value:100-i,rank:i+1,index:i,href:null}));
 const show=rows=>rows.map(r=>r.kind==='gap'?'…'+r.skipped:(r.highlight?'*':'')+r.peer.rank).join(' ');
 assert.equal(show(m.neighbours(ps,14,2,3)),'1 2 3 …9 13 14 *15 16 17 …13');
 assert.equal(show(m.neighbours(ps,0,2,3)),'*1 2 3 …27');
 assert.equal(show(m.neighbours(ps,5,2,3)),'1 2 3 4 5 *6 7 8 …22');// a gap of one shows the peer instead
 assert.equal(show(m.neighbours(ps,29,2,0)),'…27 28 29 *30');
 assert.equal(show(m.neighbours(ps,27,1,3)),'1 2 3 …23 27 *28 29 30');
 assert.equal(show(m.neighbours(ps,-1,2,3)),'1 2 3 4 5 …25');
 assert.deepEqual(m.neighbours([],0),[]);
});

test('radar profile: percentiles within the peer set, asc criteria inverted, unknown names kept',()=>{
 const rows=[{name:'A',gdp:10,crime:5},{name:'B',gdp:30,crime:1},{name:'C',gdp:20,crime:9},{name:'D',gdp:40}];
 const p=m.radarProfile([{key:'gdp',label:'GDP'},{key:'crime',label:'Crime',order:'asc'}],rows,['b','D','Nope','B','x','y']);
 assert.deepEqual(p.criteria.map(c=>c.key),['gdp','crime']);assert.deepEqual(p.counts,[4,3]);
 assert.deepEqual(p.entities.map(e=>[e.name,e.found]),[['B',true],['D',true],['Nope',false],['x',false]]);
 assert.deepEqual(p.entities[0].percentiles,[66.7,100]);assert.deepEqual(p.entities[0].ranks,[2,1]);
 assert.deepEqual(p.entities[1].percentiles,[100,null]);
 assert.equal(m.radarPolygon([100,100,100,100],50,50,10),'50,40 60,50 50,60 40,50');
});

test('trend: series cleaned, periods merged in time order, fallback paths, chart option',()=>{
 const s=m.normalizeSeries([{label:'GDP',unit:'USD',points:[{period:2001,value:2},{period:2000,value:1}]},{name:'Debt',data:[{year:2002,value:'3'}]},{label:'empty',points:[]}]);
 assert.deepEqual(s.map(x=>x.label),['GDP','Debt']);assert.deepEqual(m.periodsOf(s),['2000','2001','2002']);
 assert.deepEqual(m.normalizeSeries(undefined,[{period:'x',value:1}]).map(x=>x.points.length),[1]);
 const f=m.trendPaths(s,100,50,false,0);assert.equal(f.paths[0],'M0,50L50,25');assert.equal(f.paths[1],'M100,0');
 assert.deepEqual(m.normalizeAnnotations([{period:2008,label:'Crisis'},{label:'no period'}]),[{period:'2008',label:'Crisis'}]);
 const fmt=v=>String(v);
 const o=m.trendOption({series:s,periods:m.periodsOf(s),annotations:[{period:'2001',label:'X'},{period:'1999',label:'out'}],log:false,area:true,fmts:[fmt,fmt],axisFmts:[fmt,fmt]});
 assert.equal(o.series.length,2);assert.deepEqual(o.series[0].data,[1,2,null]);assert.equal(o.yAxis.length,2,'two units → two axes');
 assert.deepEqual(o.series[0].markLine.data,[{xAxis:'2001',name:'X'}]);
});

test('relations: deduplicated, grouped by predicate; one node per name',()=>{
 const rels=m.normalizeRelations([{predicate:'founder',name:'Ann',href:'/p/ann'},{predicate:'founder',name:'Ann'},{predicate:'CEO',name:'Ann',href:'javascript:x'},{predicate:'subsidiary',name:'Co',type:'company',href:'https://co.example'},{name:'Misc'},{predicate:'x'}]);
 assert.deepEqual(rels.map(r=>[r.predicate,r.name,r.href]),[['founder','Ann','/p/ann'],['CEO','Ann',null],['subsidiary','Co','https://co.example'],['related','Misc',null]]);
 assert.deepEqual(m.groupRelations(rels).map(g=>[g.predicate,g.items.length]),[['founder',1],['CEO',1],['subsidiary',1],['related',1]]);
 const g=m.relationGraph('Acme',rels);
 assert.equal(g.nodes.length,4);assert.equal(g.links.length,4);assert.deepEqual(g.nodes[1].predicates,['founder','CEO']);assert.equal(g.nodes[1].href,'/p/ann');
 const o=m.graphOption({...g,layout:'force'});assert.equal(o.series[0].data.length,4);assert.equal(o.series[0].data[0].txt,'Acme');assert.equal(o.series[0].categories.length,4);
});

test('timeline: events sorted by date, older items form read, dates formatted',()=>{
 const e=m.normalizeEvents([{date:'1850-09-09',label:'Statehood'},{date:'1848',label:'Gold',href:'https://en.wikipedia.org/wiki/California_Gold_Rush'},{date:'1769-07',label:'Mission',href:'//evil'},{label:''}]);
 assert.deepEqual(e.map(x=>x.label),['Mission','Gold','Statehood']);assert.equal(e[0].href,null);assert.ok(e[1].href.startsWith('https://'));
 assert.deepEqual(m.normalizeEvents([{date:'2000',label:'a'},{date:'2010',label:'b'}],'desc').map(x=>x.label),['b','a']);
 assert.deepEqual(m.normalizeEvents([{date:'later',label:'a'},{date:'2010',label:'b'}]).map(x=>x.label),['a','b']);
 const old=m.normalizeEvents([{time:'2024-01-02',title:'Deploy',text:'ok',tone:'success'}]);assert.deepEqual(old[0],{date:'2024-01-02',label:'Deploy',href:null,key:old[0].key,detail:'ok',tone:'success'});
 assert.equal(m.formatDate('1850-09-09','en-US'),'Sep 9, 1850');assert.equal(m.formatDate('1850-09','en-US'),'Sep 1850');
 assert.equal(m.formatDate('c. 1769','en-US'),'c. 1769');assert.equal(m.formatDate('2020-13','en-US'),'2020-13');
});

test('links: same-site paths and https only',()=>{
 assert.equal(m.safeHref('/p/x?a=1'),'/p/x?a=1');assert.equal(m.safeHref('https://x.org/a'),'https://x.org/a');
 for(const bad of ['//evil.com','http://x.org','javascript:alert(1)','data:text/html,x',' ',null,5])assert.equal(m.safeHref(bad),null,String(bad));
});

test('regions: countries, U.S. states and counties; regionType forces the reading',()=>{
 assert.deepEqual(m.regionOf('California'),{kind:'us',key:'06'});assert.deepEqual(m.regionOf('CA'),{kind:'us',key:'06'});
 assert.deepEqual(m.regionOf('CA','country'),{kind:'world',key:'124'});assert.deepEqual(m.regionOf('FRA'),{kind:'world',key:'250'});
 assert.deepEqual(m.regionOf('fr'),{kind:'world',key:'250'});assert.deepEqual(m.regionOf('250'),{kind:'world',key:'250'});
 assert.deepEqual(m.regionOf('06037'),{kind:'us-counties',key:'06037'});assert.deepEqual(m.regionOf(6037,'us_county'),{kind:'us-counties',key:'06037'});
 assert.equal(m.regionOf('France'),null,'names are matched against the map later');assert.equal(m.regionOf(''),null);
});

test('Albers USA matches the us-atlas projection: cities fall inside their states',()=>{
 const atlas=JSON.parse(readFileSync('node_modules/us-atlas/states-albers-10m.json','utf8'));
 const fc=topo.feature(atlas,atlas.objects.states);
 const box=id=>{const f=fc.features.find(f=>f.id===id);let b=[Infinity,Infinity,-Infinity,-Infinity];const walk=c=>{if(typeof c[0]==='number'){b=[Math.min(b[0],c[0]),Math.min(b[1],c[1]),Math.max(b[2],c[2]??c[0]),Math.max(b[3],c[1])];b[2]=Math.max(b[2],c[0]);}else c.forEach(walk);};walk(f.geometry.coordinates);return b;};
 const inside=([x,y],b)=>x>=b[0]&&x<=b[2]&&y>=b[1]&&y<=b[3];
 for(const [name,lon,lat,id] of [['Sacramento',-121.49,38.58,'06'],['Denver',-104.99,39.74,'08'],['Miami',-80.19,25.76,'12'],['Boston',-71.06,42.36,'25'],['Honolulu',-157.86,21.31,'15'],['Anchorage',-149.9,61.22,'02'],['Juneau',-134.42,58.3,'02']])
  assert.ok(inside(m.albersUsa(lon,lat),box(id)),name+' '+m.albersUsa(lon,lat)+' '+box(id));
});

test('main box skips small far-away parts (France without French Guiana)',()=>{
 const atlas=JSON.parse(readFileSync('node_modules/world-atlas/countries-110m.json','utf8'));
 const fc=topo.feature(atlas,atlas.objects.countries);
 const fr=m.mainBox(fc.features.find(f=>f.id==='250').geometry);
 assert.ok(fr[0]>-6&&fr[2]<10&&fr[1]>41,String(fr));
 const us=m.mainBox(fc.features.find(f=>f.id==='840').geometry);assert.ok(us[3]>65,'Alaska is a main part of the U.S.');
 assert.deepEqual(m.padBox([0,0,10,10],.1,0),[-1,-1,11,11]);assert.deepEqual(m.padBox([5,5,5,5],.1,10),[0,2,10,8]);
 assert.deepEqual(m.unionBox(null,[1,2,3,4]),[1,2,3,4]);assert.deepEqual(m.boxOfPoints([[1,5],[3,2]]),[1,2,3,5]);
 assert.equal(m.latLonText([-119.42,36.78]),'36.78° N, 119.42° W');
 const o=m.locationOption({kind:'us',map:'m',regionKey:'06',box:[0,-10,10,0],point:[1,2],nearby:[{name:'LA',at:[3,4],href:null}],name:'California'});
 assert.deepEqual(o.geo.boundingCoords,[[0,0],[10,-10]]);assert.equal(o.series.length,2);assert.equal(o.geo.regions[0].name,'06');
});
