import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';
// Pure helpers behind the ranking component (ranking-data.ts with its two pure dependencies inlined).
const src=['world-codes.ts','rich-helpers.ts','ranking-data.ts'].map(f=>readFileSync('app/workflows/viz/'+f,'utf8').replace(/^import .*;$/gm,'')).join('\n');
const m=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile(src,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));

const rows=[{name:'A',pop:10},{name:'B',pop:'30'},{name:'C',pop:'1,234.5'},{name:'D',pop:30},{name:'E',pop:null},{name:'F',pop:''},{name:'G'},{name:'',pop:99},{pop:5},'junk',{name:'H',pop:5}];

test('numbers and numeric strings parse; everything else is no data',()=>{
 assert.equal(m.parseNumber(12.5),12.5);assert.equal(m.parseNumber('1,234.5'),1234.5);assert.equal(m.parseNumber(' 72.5% '),72.5);
 assert.equal(m.parseNumber('$1 200'),1200);assert.equal(m.parseNumber('-3e2'),-300);assert.equal(m.parseNumber('1_000'),1000);assert.equal(m.parseNumber('−4'),-4);
 for(const bad of [null,undefined,'','  ','abc','12abc',NaN,Infinity,{},[],true,'1.2.3'])assert.equal(m.parseNumber(bad),null,String(bad));
});

test('competition ranking with ties, descending by default; missing values follow unranked',()=>{
 const {ranked,missing}=m.rankEntries(m.toEntries(rows),'pop');
 assert.deepEqual(ranked.map(e=>[e.name,e.rank,e.value]),[['C',1,1234.5],['B',2,30],['D',2,30],['A',4,10],['H',5,5]]);
 assert.deepEqual(missing.map(e=>[e.name,e.rank,e.value]),[['E',null,null],['F',null,null],['G',null,null]]);
});

test('ascending order ranks the smallest first; ties keep input order',()=>{
 const {ranked}=m.rankEntries(m.toEntries(rows),'pop','asc');
 assert.deepEqual(ranked.map(e=>[e.name,e.rank]),[['H',1],['A',2],['B',3],['D',3],['C',5]]);
});

test('entries carry question, group, safe image and code',()=>{
 const [e,f]=m.toEntries([{country:'France',question:'France economy',region:'Europe',image:'https://x.org/fr.svg',code:'FRA'},{country:'X',image:'javascript:alert(1)'}],'country','region');
 assert.equal(e.name,'France');assert.equal(e.question,'France economy');assert.equal(e.group,'Europe');assert.equal(e.image,'https://x.org/fr.svg');assert.equal(e.code,'FRA');
 assert.equal(f.question,'X');assert.equal(f.image,null);assert.equal(f.group,null);
 assert.equal(m.askHref('Côte d’Ivoire & co'),'/?ask=C%C3%B4te%20d%E2%80%99Ivoire%20%26%20co');
 assert.deepEqual(m.toEntries({name:'solo'}).map(e=>e.name),['solo']);assert.deepEqual(m.toEntries('x'),[]);
});

test('criteria are normalized defensively',()=>{
 const c=m.normalizeCriteria([{key:'pop',label:'Population',format:'compact',order:'desc'},{key:'pop'},{label:'no key'},{key:'imr',order:'asc',format:'weird',decimals:'2',currency:'eur',year:2023},null]);
 assert.deepEqual(c.map(x=>[x.key,x.label,x.order,x.format]),[['pop','Population','desc','compact'],['imr','imr','asc','number']]);
 assert.equal(c[1].decimals,2);assert.equal(c[1].currency,'EUR');assert.equal(c[1].year,'2023');
 assert.deepEqual(m.normalizeCriteria('x'),[]);
});

test('formats: number, compact, percent, currency, decimal, units',()=>{
 const f=(c,vals,n)=>m.makeFormatter(c,vals,'en-US')(n);
 assert.equal(f({format:'number'},[1,2],1234567),'1,234,567');
 assert.equal(f({format:'number'},[1.5,2],1234.567),'1,234.57');
 assert.equal(f({format:'number',unit:'km²'},[1],1500),'1,500 km²');
 assert.equal(f({format:'compact'},[1],1_412_000_000),'1.4B');
 assert.equal(f({format:'percent',unit:'ignored'},[1],72.54),'72.5%');
 assert.equal(f({format:'currency'},[100,200],1234),'$1,234');
 assert.equal(f({format:'currency',currency:'EUR'},[1.5],12.5),'€12.50');
 assert.equal(f({format:'currency'},[25e12],25.44e12),'$25.4T');
 assert.equal(f({format:'decimal'},[1],80),'80.0');
 assert.equal(f({format:'decimal',decimals:2,unit:'years'},[1],80.126),'80.13 years');
 assert.equal(f({format:'number',unit:'°C'},[1],12),'12°C');
 assert.equal(f({format:'number'},[1],null),'—');
 assert.equal(m.makeFormatter({format:'number',unit:'people'},[1],'en-US',{unit:false})(5),'5');
 assert.equal(m.makeFormatter({format:'number'},[1],'en-US',{compact:true})(25_000),'25K');
 assert.equal(m.makeFormatter({format:'number'},[1],'not a locale!!')(1000),'1,000');
});

test('summary: top, median, sum or average, counts; share and percentile',()=>{
 const {ranked,missing}=m.rankEntries(m.toEntries(rows),'pop');
 const s=m.summarize(ranked,missing,{format:'number'});
 assert.equal(s.top.name,'C');assert.equal(s.median,30);assert.equal(s.aggregate,'sum');assert.equal(s.aggregateValue,1309.5);assert.equal(s.ranked,5);assert.equal(s.total,8);
 assert.deepEqual(m.shareOf(ranked[0],s,'en-US'),{kind:'share',text:'94.3%'});
 const avg=m.summarize(ranked,missing,{format:'percent'});
 assert.equal(avg.aggregate,'average');assert.equal(avg.aggregateValue,1309.5/5);
 assert.deepEqual(m.shareOf(ranked[0],avg,'en-US'),{kind:'top',text:'20%'});assert.deepEqual(m.shareOf(ranked[4],avg,'en-US'),{kind:'top',text:'100%'});
 assert.equal(m.shareOf(missing[0],s,'en-US'),null);
 assert.equal(m.median([4,1,3,2]),2.5);assert.equal(m.median([]),null);
 const empty=m.summarize([],[],{format:'number'});assert.equal(empty.top,null);assert.equal(empty.aggregateValue,null);
});

test('chart auto mode picks the map when at least 60% of rows have a country code',()=>{
 const e=codes=>codes.map(code=>({code}));
 assert.equal(m.chartMode('auto',e(['USA','FR','076','XXX','CHN'])),'map');
 assert.equal(m.chartMode(undefined,e(['USA','FR',null,null,null])),'bar');
 assert.equal(m.chartMode('auto',e(['USA','FR'])),'bar');
 assert.equal(m.chartMode('auto',[]),'bar');
 assert.equal(m.chartMode('none',e(['USA','FR','DE'])),'none');assert.equal(m.chartMode('map',[]),'map');assert.equal(m.chartMode('bar',e(['USA','FR','DE'])),'bar');
});

test('country codes match by alpha-3, alpha-2 and numeric',()=>{
 assert.equal(m.countryKey('USA'),'840');assert.equal(m.countryKey('us'),'840');assert.equal(m.countryKey('840'),'840');assert.equal(m.countryKey(840),'840');
 assert.equal(m.countryKey('4'),'004');assert.equal(m.countryKey('AFG'),'004');assert.equal(m.countryKey(' gbr '),'826');assert.equal(m.countryKey('UK'),'826');
 assert.equal(m.countryKey('XKX'),'XKX');assert.equal(m.countryKey('XK'),'XKX');
 for(const bad of ['ZZZ','',null,undefined,'999',3.5,{}])assert.equal(m.countryKey(bad),null,String(bad));
 // Every country in the world-atlas geometry is covered by the table.
 const atlas=JSON.parse(readFileSync('node_modules/world-atlas/countries-110m.json','utf8'));
 for(const g of atlas.objects.countries.geometries)if(g.id)assert.equal(m.countryKey(g.id),g.id,g.properties.name);
});

test('color scale goes logarithmic for skewed positive values',()=>{
 assert.deepEqual(m.colorScale([1e5,1e9]),{log:true,min:5,max:9});
 assert.deepEqual(m.colorScale([50,80]),{log:false,min:50,max:80});
 assert.deepEqual(m.colorScale([1,100]),{log:true,min:0,max:2});assert.equal(m.colorScale([1,99]).log,false);
 assert.deepEqual(m.colorScale([-5,1e6]),{log:false,min:-5,max:1e6});
 assert.deepEqual(m.colorScale([7,7]),{log:false,min:7,max:8});
});

test('equal earth projection round-trips',()=>{
 for(const p of [[0,0],[120,45],[-75,-30],[179,80]]){const q=m.equalEarthInvert(m.equalEarth(p));assert.ok(Math.abs(q[0]-p[0])<1e-6&&Math.abs(q[1]-p[1])<1e-6,String(p));}
 assert.ok(m.equalEarth([0,60])[1]<0,'north is up');
});

test('groups, html escaping and source links',()=>{
 assert.deepEqual(m.groupsOf([{group:'Asia'},{group:null},{group:'Europe'},{group:'Asia'}]),['Asia','Europe']);
 assert.equal(m.escapeHtml('<b a="1">&\''),'&lt;b a=&quot;1&quot;&gt;&amp;&#39;');
 assert.deepEqual(m.linkParts('UN WPP (https://population.un.org/wpp/). Also http://x.org'),[{text:'UN WPP ('},{text:'https://population.un.org/wpp/',href:'https://population.un.org/wpp/'},{text:'). Also '},{text:'http://x.org',href:'http://x.org'}]);
 assert.deepEqual(m.linkParts('plain'),[{text:'plain'}]);
});

test('polygons crossing the antimeridian are pinned to one edge',()=>{
 const g=m.fixAntimeridian({type:'MultiPolygon',coordinates:[[[[170,60],[179,62],[-178,64],[175,66],[170,60]]],[[[10,10],[11,10],[10,11],[10,10]]]]});
 assert.deepEqual(g.coordinates[0][0],[[170,60],[179,62],[180,64],[175,66],[170,60]]);
 assert.deepEqual(g.coordinates[1][0],[[10,10],[11,10],[10,11],[10,10]]);
 const p=m.fixAntimeridian({type:'Polygon',coordinates:[[[-179,-16],[-178,-17],[179,-17],[-179,-16]]]});
 assert.deepEqual(p.coordinates[0],[[-179,-16],[-178,-17],[-180,-17],[-179,-16]]);
 assert.deepEqual(m.fixAntimeridian({type:'Point',coordinates:[1,2]}),{type:'Point',coordinates:[1,2]});
});

// Views and geography (ranking-chart.ts and ranking-geo.ts with their pure parts inlined).
const views=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile(
 ['world-codes.ts','rich-helpers.ts','ranking-data.ts','ranking-geo.ts','ranking-chart.ts'].map(f=>readFileSync('app/workflows/viz/'+f,'utf8').replace(/^import .*;$/gm,'')).join('\n'),
 {module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
test('U.S. states match by name, postal code, US-XX or FIPS; geoKind needs most entities on one map',()=>{
 assert.equal(views.usStateKey(null,'California'),'06');assert.equal(views.usStateKey('CA'),'06');assert.equal(views.usStateKey('US-TX'),'48');
 assert.equal(views.usStateKey('6'),'06');assert.equal(views.usStateKey(null,'Washington (U.S. state)'),'53');assert.equal(views.usStateKey(null,'Narnia'),null);
 assert.equal(views.geoKind([{code:null,name:'Texas'},{code:null,name:'Ohio'},{code:null,name:'Utah'},{code:null,name:'Guam'}]),'us');
 assert.equal(views.geoKind([{code:'FRA',name:'France'},{code:'DEU',name:'Germany'},{code:'JPN',name:'Japan'}]),'world');
 assert.equal(views.geoKind([{code:null,name:'Chanel No. 5'},{code:null,name:'Sauvage'},{code:null,name:'Texas'}]),null);
});
test('views: share views only for additive quantities, maps only for geographic entities; explicit lists filtered',()=>{
 assert.deepEqual(views.autoViews({additive:true,geo:'us',criteria:3,groups:4,count:50}),['bar','treemap','donut','sunburst','map','map3d','scatter','lorenz','distribution','boxplot','heatmap','parallel','slope','radar']);
 assert.deepEqual(views.autoViews({additive:true,geo:null,criteria:1,count:4}),['bar','treemap','donut']);
 assert.deepEqual(views.autoViews({additive:false,geo:null,criteria:1,count:5}),['bar']);
 const auto=views.autoViews({additive:false,geo:'world',criteria:2});
 assert.deepEqual(views.pickViews(['map','treemap','scatter','nonsense'],auto),['map','scatter']);
 assert.deepEqual(views.pickViews(['treemap'],auto),auto);assert.deepEqual(views.pickViews('auto',auto),auto);
});
test('points: lat/lon in several spellings; counties by 5-digit FIPS; regions win over points',()=>{
 assert.deepEqual(views.pointOf({lat:35.68,lon:139.69}),[139.69,35.68]);
 assert.deepEqual(views.pointOf({latitude:'-23.5',longitude:'-46.6'}),[-46.6,-23.5]);
 assert.deepEqual(views.pointOf({coordinates:'40.71, -74.01'}),[-74.01,40.71]);
 assert.equal(views.pointOf({lat:95,lon:0}),null);assert.equal(views.pointOf({}),null);
 const city=(name,lat,lon)=>({code:null,name,row:{lat,lon}});
 assert.equal(views.geoKind([city('A',1,2),city('B',3,4),city('C',5,6)]),'points');
 assert.equal(views.geoKind([{code:'06037',name:'Los Angeles'},{code:'17031',name:'Cook'},{code:'48201',name:'Harris'}]),'us-counties');
 assert.equal(views.geoKind([{code:null,name:'Texas',row:{lat:31,lon:-99}},{code:null,name:'Ohio',row:{lat:40,lon:-82}},{code:null,name:'Utah',row:{lat:39,lon:-111}}]),'us');
});
test('percentiles respect order and ties; ranks on another criterion; cumulative share',()=>{
 const rows=[{n:'a',v:10,w:1},{n:'b',v:20,w:3},{n:'c',v:20,w:2},{n:'d',v:40}].map(row=>({row,name:row.n}));
 const p=views.percentiles(rows,{key:'v',order:'desc'});
 assert.deepEqual(rows.map(r=>Math.round(p.get(r.row))),[0,50,50,100]);
 const pa=views.percentiles(rows,{key:'v',order:'asc'});assert.equal(Math.round(pa.get(rows[0].row)),100);
 const r=views.ranksOn(rows,{key:'w',order:'desc'});assert.deepEqual(rows.map(x=>r.get(x.row)??null),[3,1,2,null]);
 const cs=views.cumulativeShare([{value:50},{value:30},{value:20},{value:0}]);
 assert.deepEqual(cs.map(x=>[x.k,Math.round(x.share)]),[[1,50],[2,80],[3,100]]);
});
test('subdivisions of any country: ISO 3166-2 codes pick the country; a template hint names it; loose names match across scripts',()=>{
 const sub=(code,name)=>({code,name});
 assert.equal(views.geoKind([sub('CN-GD','Guangdong'),sub('CN-JS','Jiangsu'),sub('CN-SD','Shandong'),sub('FR-IDF','x')]),'admin1:CN');
 assert.equal(views.geoKind([sub('US-CA','California'),sub('US-TX','Texas'),sub('US-NY','New York')]),'us');
 assert.equal(views.geoKind([sub(null,'Hokkaido'),sub(null,'Aomori')],'admin1:JP'),'admin1:JP');
 assert.equal(views.geoKind([sub(null,'a')],'admin1:US'),'us');
 assert.equal(views.geoKind([sub(null,'a'),sub(null,'b'),sub(null,'c')],'nonsense'),null);
 assert.equal(views.looseName('Guangdong Province'),views.looseName('guangdong'));
 assert.equal(views.looseName('广东省'),views.looseName('广东'));
 assert.equal(views.looseName('Île-de-France'),'iledefrance');
 const data={kind:'admin1:JP',lookup:new Map([['JP-01','JP-01'],['Q1037393','JP-01'],[views.looseName('北海道'),'JP-01'],[views.looseName('Hokkaido'),'JP-01']])};
 const key=views.geoKeyOf('admin1:JP',data);
 assert.equal(key({code:'jp-01',name:''}),'JP-01');assert.equal(key({code:null,name:'北海道'}),'JP-01');assert.equal(key({code:null,name:'Hokkaido Prefecture'}),'JP-01');
 assert.equal(key({code:null,name:'x',row:{wikidata:'Q1037393'}}),'JP-01');assert.equal(views.geoKeyOf('admin1:JP')({code:null,name:'Hokkaido'}),null);
});
test('time: long-form rows give periods, a row per entity for any period or the latest value of each criterion, and series',()=>{
 const rows=[{name:'A',year:2020,pop:1,gdp:5},{name:'A',year:2021,pop:2,gdp:null},{name:'B',year:2020,pop:3,gdp:6},{name:'B',year:2021,pop:4}];
 assert.equal(m.periodKeyOf(rows),'year');assert.equal(m.periodKeyOf([{name:'A',year:2020},{name:'B',year:2021}]),null);
 assert.deepEqual(m.rowPeriods(rows,'year'),['2021','2020']);
 const latest=m.rowsAt(rows,{nameKey:'name',periodKey:'year',period:'latest',keys:['pop','gdp']});
 assert.deepEqual(latest.map(r=>[r.name,r.pop,r.gdp,r['__period.gdp']]),[['A',2,5,'2020'],['B',4,6,'2020']]);
 const y2020=m.rowsAt(rows,{nameKey:'name',periodKey:'year',period:'2020',keys:['pop']});assert.deepEqual(y2020.map(r=>[r.name,r.pop]),[['A',1],['B',3]]);
 assert.deepEqual([...m.seriesOf(rows,{nameKey:'name',periodKey:'year',key:'pop'})],[['A',[['2020',1],['2021',2]]],['B',[['2020',3],['2021',4]]]]);
 const r=views.ranksByPeriod({periods:['2020','2021'],series:new Map([['A',[['2020',1],['2021',5]]],['B',[['2020',3],['2021',4]]]])},'desc');
 assert.deepEqual([r.get('2020').get('A'),r.get('2021').get('A')],[2,1]);
});
