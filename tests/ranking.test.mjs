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
