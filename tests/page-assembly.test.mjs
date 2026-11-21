import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';import ts from 'typescript';
// Database-driven pages: text assembly (app/seo/assemble.ts, pure) and the page data builders
// (app/entity-db/pages.ts) against an in-memory PGlite seeded with the development fixture.
const tr=src=>ts.transpile(src,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022});
const pure=['app/workflows/viz/world-codes.ts','app/workflows/viz/rich-helpers.ts','app/workflows/viz/ranking-data.ts','app/seo/urls.ts','app/seo/assemble.ts']
 .map(f=>readFileSync(f,'utf8').replace(/^import .*;$/gm,'')).join('\n');
const a=await import('data:text/javascript;base64,'+Buffer.from(tr(pure)).toString('base64'));

const pop={key:'population',label:'Population',unit:'people',order:'desc',format:'compact'};
const gdp={key:'gdp_usd',label:'GDP',unit:'USD',order:'desc',format:''};
const life={key:'life_expectancy',label:'Life expectancy',unit:'years',order:'desc',format:'decimal'};
const rate={key:'unemployment',label:'Unemployment',unit:'%',order:'asc',format:''};

test('metric definitions become ranking criteria (currency and percent from the unit)',()=>{
 assert.deepEqual(a.criterionOf(gdp,{year:'2023'}),{key:'gdp_usd',label:'GDP',order:'desc',format:'currency',currency:'USD',year:'2023'});
 assert.deepEqual(a.criterionOf(rate),{key:'unemployment',label:'Unemployment',order:'asc',format:'percent'});
 assert.equal(a.criterionOf({key:'area_km2',label:'Area',unit:'km2',order:'desc',format:''}).unit,'km²');
 assert.equal(a.criterionOf({key:'x',label:'X',unit:'ppm',order:'desc',format:''}).format,'number');
 assert.equal(a.formatMetric(pop,84_500_000),'84.5M people');
 assert.equal(a.formatMetric(gdp,4.456e12),'$4.5T');
 assert.equal(a.formatMetric(life,81.23),'81.2 years');
 assert.equal(a.formatMetric(rate,5.25),'5.3%');
});

test('ordinals, counts, lists, labels',()=>{
 assert.deepEqual([1,2,3,4,11,12,13,21,22,101,111].map(n=>a.ordinal(n)),['1st','2nd','3rd','4th','11th','12th','13th','21st','22nd','101st','111th']);
 assert.equal(a.ordinal(4,'zh'),'第4');assert.equal(a.ordinal(4,'de'),'4.');
 assert.equal(a.countText(12345),'12,345');
 assert.equal(a.listText(['population','GDP','life expectancy']),'population, GDP, and life expectancy');
 assert.equal(a.listText(['one']),'one');
 assert.equal(a.lowerLabel('GDP per capita'),'GDP per capita');assert.equal(a.lowerLabel('Life expectancy'),'life expectancy');
});

test('changes since the previous period; percentage points for percent metrics',()=>{
 const h=[{period:'2021',value:100},{period:'2022',value:110},{period:'2023',value:99}];
 assert.equal(a.changeText(pop,{value:110,period:'2022',history:h}),'+10%');
 assert.equal(a.changeText(pop,{value:99,period:'2023',history:h}),'−10%');
 assert.equal(a.changeText(pop,{value:100,period:'2021',history:h}),null,'no earlier period');
 assert.equal(a.changeText(pop,{value:5,period:'2023',history:[]}),null);
 assert.equal(a.changeText(rate,{value:5.5,period:'2023',history:[{period:'2022',value:4.25},{period:'2023',value:5.5}]}),'+1.3 pp');
 assert.equal(a.changeText(pop,{value:1012,period:'2023',history:[{period:'2022',value:1000},{period:'2023',value:1012}]}),'+1.2%');
});

const values=a.entityValues({name:'Germany',typeLabel:'country',typePlural:'countries',defs:{population:pop,gdp_usd:gdp},attributes:{region:'Europe & Central Asia',tags:['a','b'],nested:{x:1}},
 relations:{capital:[{name:'Berlin'},{name:'Bonn'}]},
 metrics:{population:{value:84_500_000,period:'2023',rank:19,of:217,history:[{period:'2022',value:83_800_000},{period:'2023',value:84_500_000}]},
  gdp_usd:{value:4.456e12,period:'2023',rank:1200,of:2000}}});

test('template values: metric, period, rank (≤ 1,000 only), of, change, attr, rel, name, type',()=>{
 assert.equal(values.name,'Germany');assert.equal(values['type.label'],'country');assert.equal(values['type.plural'],'countries');
 assert.equal(values['metric.population'],'84.5M people');assert.equal(values['period.population'],'2023');
 assert.equal(values['rank.population'],'19th');assert.equal(values['of.population'],'217');assert.equal(values['change.population'],'+0.8%');
 assert.equal(values['metric.gdp_usd'],'$4.5T');assert.equal(values['rank.gdp_usd'],undefined,'outside the top 1,000');assert.equal(values['of.gdp_usd'],'2,000');
 assert.equal(values['change.gdp_usd'],undefined);
 assert.equal(values['attr.region'],'Europe & Central Asia');assert.equal(values['attr.tags'],'a, b');assert.equal(values['attr.nested'],undefined);
 assert.equal(values['rel.capital'],'Berlin');
});

test('a sentence that names a missing value is dropped, never printed with a blank',()=>{
 assert.equal(a.fill('{name} is a {type.label} in {attr.region} with a population of {metric.population} ({period.population}).',values),
  'Germany is a country in Europe & Central Asia with a population of 84.5M people (2023).');
 assert.equal(a.fill('It ranks {rank.population} of {of.population} by population and {rank.gdp_usd} by GDP.',values),null);
 assert.equal(a.fill('{name} has {metric.nope}.',values),null);
 assert.equal(a.fill('No placeholders.',values),'No placeholders.');
 assert.equal(a.fill('{}',values),'{}');
 assert.deepEqual(a.fillAll(['{name}.','{attr.none}.',3,'Capital: {rel.capital}.'],values),['Germany.','Capital: Berlin.']);
 assert.deepEqual(a.fillAll('{name}!',values),['Germany!']);assert.deepEqual(a.fillAll(null,values),[]);
});

const data=(over={})=>({entity:{id:'e1',name:'Germany',type:'country',description:'',aliases:[],ids:{iso3:'DEU'},attributes:{region:'Europe & Central Asia',founded:'1871-01-18'}},
 type:{label:'country',plural:'countries',template:{
  lead:['{name} is a {type.label} in {attr.region}.','It ranks {rank.gdp_usd} by GDP.',['It is {rank.population} of {of.population} by population.','Its population is {metric.population}.']],
  card:['population','gdp_usd','missing_metric','rel.capital','attr.region','attr.none'],
  sections:[{kind:'trend',title:'Population',metrics:['population']},{kind:'trend',metrics:['gdp_usd']},{kind:'position',metric:'gdp_usd'},{kind:'peer_compare',metric:'population'},
   {kind:'radar_profile',metrics:['population','gdp_usd']},{kind:'location_map'},{kind:'relations'},{kind:'rankings'},{kind:'timeline'},{kind:'sparkles'},
   {kind:'text',title:'Economy',sentences:['GDP was {metric.gdp_usd} in {period.gdp_usd}.','Unknown {metric.nope}.']}]}},
 defs:{population:pop,gdp_usd:gdp},
 metrics:{population:{value:84_500_000,period:'2023',source:'WB POP',retrievedAt:'2026-01-02T00:00:00Z',rank:19,of:217,history:[{period:'2023',value:84_500_000},{period:'2022',value:83_800_000}]},
  gdp_usd:{value:4.456e12,period:'2023',source:'WB GDP',retrievedAt:'2026-03-04T00:00:00Z',rank:1200,of:2000,history:[{period:'2023',value:4.456e12}]}},
 relations:{outgoing:[{predicate:'capital',name:'Berlin',type:'city',source:'Wikidata P36'}],incoming:[{predicate:'located_in',type:'city',count:2,sample:[{name:'Munich'},{name:'Hamburg'}]}]},
 peers:{population:[{name:'India',type:'country',value:1.4e9},{name:'Germany',type:'country',value:84_500_000}],gdp_usd:[{name:'United States',type:'country',value:2.7e13}]},
 rankings:[{slug:'country-rankings',title:'Country Rankings',ranks:[{key:'population',label:'Population',rank:19,of:217},{key:'gdp_usd',label:'GDP',rank:1200,of:2000},{key:'area_km2',label:'Area',rank:null,of:217}]}],...over});

test('entity page: lead, card, sections in template order, references, as-of stamp',()=>{
 const m=a.assembleEntityPage(data({links:{berlin:'/e/city/berlin',munich:'/e/city/munich',hamburg:'/e/city/hamburg'}}));
 assert.equal(m.title,'Germany');
 assert.deepEqual(m.lead,['Germany is a country in Europe & Central Asia.','It is 19th of 217 by population.'],'GDP rank outside the top 1,000 drops its sentence; alternatives pick the first that fills');
 assert.deepEqual(m.cards.map(c=>c.label),['Population','GDP','Missing metric'].slice(0,2).concat(['Capital','Region']));
 const [p,g,cap]=m.cards;
 assert.equal(p.rank,19);assert.equal(p.of,217);assert.equal(p.format,'compact');assert.equal(p.unit,'people');assert.equal(p.href,'/rankings/country-rankings');
 assert.deepEqual(p.history.map(x=>x.period),['2022','2023'],'history sorted oldest first');
 assert.equal(g.rank,undefined);assert.equal(g.note,'Outside the top 1,000 of 2,000');assert.equal(g.currency,'USD');assert.equal(g.href,'/rankings/country-rankings?rank=gdp_usd');
 assert.deepEqual(cap,{label:'Capital',value:'Berlin',href:'/e/city/berlin'});
 assert.deepEqual(m.sections.map(s=>s.component),['trend','position','peer_compare','location_map','relation_graph','rankings','timeline','text'],'single-point trend, 2-metric radar and unknown kinds are left out');
 const pos=m.sections[1];assert.equal(pos.props.highlight,'Germany');assert.equal(pos.props.values.length,2,'the entity is added when outside the peers');assert.match(pos.props.subtitle,/outside them \(1200th of 2,000\)/);
 const peers=m.sections[2];assert.equal(peers.props.values.length,2);assert.equal(peers.props.subtitle,undefined);assert.equal(peers.props.values[0].href,'/e/country/india');
 assert.deepEqual(m.sections[3].props,{name:'Germany',region:'DEU'});
 assert.deepEqual(m.sections[4].props.relations.map(r=>r.predicate+':'+r.name+':'+r.href),['Capital:Berlin:/e/city/berlin','Located in of:Munich:/e/city/munich','Located in of:Hamburg:/e/city/hamburg']);
 assert.equal(m.sections[5].links[0].detail,'Population: 19th of 217 · GDP: outside the top 1,000 · Area: not ranked');
 assert.deepEqual(m.sections[6].props.events,[{date:'1871-01-18',label:'Founded'}]);
 assert.deepEqual(m.sections[7].paragraphs,['GDP was $4.5T in 2023.']);
 assert.deepEqual(m.references,[{source:'WB POP',what:'Population (2022–2023)'},{source:'WB GDP',what:'GDP (2023)'},{source:'Wikidata P36',what:'Capital'}]);
 assert.equal(m.asOf,'2026-03-04T00:00:00Z');
 assert.ok(m.properties.some(x=>x.name==='Population'&&x.value===84_500_000&&x.unitText==='people'));
 assert.ok(m.description.startsWith('Germany is a country'));
});

test('entity page without a template: a default built from its metrics',()=>{
 const m=a.assembleEntityPage(data({type:{label:'country',plural:'countries',template:null}}));
 assert.deepEqual(m.lead,['Germany is a country.','Its population is 84.5M people (2023), 19th of 217.']);
 assert.deepEqual(m.cards.map(c=>c.label),['Population','GDP','Capital','Region']);
 assert.ok(m.sections.some(s=>s.component==='trend'&&s.title==='Population'));
 assert.ok(m.sections.some(s=>s.component==='position'));
 const bare=a.assembleEntityPage(data({type:{label:'',plural:'',template:{}},metrics:{},peers:{},rankings:[],relations:{outgoing:[],incoming:[]},entity:{id:'x',name:'Nowhere',type:'thing',description:'A thing.',aliases:[],ids:{},attributes:{}}}));
 assert.deepEqual(bare.lead,['Nowhere is a thing.']);assert.deepEqual(bare.sections,[]);assert.deepEqual(bare.cards,[]);assert.equal(bare.asOf,null);
});

const rankingInput={def:{slug:'country-rankings',title:'Country Rankings',scope:{type:'country'},criteria:['population','gdp_usd'],
  config:{default:'gdp_usd',group:'region',lead:'All {count} {type.plural}, ranked by {criteria} ({source}).',about:['Scope: {count} of {expected}.','Missing {nope}.']}},
 defs:{population:pop,gdp_usd:gdp},columns:[{column:'population',key:'population',count:2},{column:'gdp_usd',key:'gdp_usd',count:1}],
 rows:[{entity_id:'1',name:'A',type:'country',period:'2022',population:10,population_source:'S1',gdp_usd:null},{entity_id:'1',name:'A',type:'country',period:'2023',population:11,population_source:'S1',gdp_usd:5,gdp_usd_source:'S2'},
  {entity_id:'2',name:'B',type:'country',period:'2023',population:20,population_source:'S1'}],
 type:{label:'country',plural:'countries',expected:217},entities:{'1':{group:'Europe',code:'AAA'},'2':{group:null,code:null}},related:[{slug:'sub',title:'Sub ranking'}]};

test('ranking page: criteria, rows for the component, lead, about lines, related',()=>{
 const m=a.assembleRankingPage(rankingInput);
 assert.equal(m.title,'Country Rankings');assert.equal(m.defaultKey,'gdp_usd');assert.equal(m.groupKey,'region');assert.equal(m.count,2);
 assert.deepEqual(m.criteria.map(c=>[c.key,c.format,c.year]),[['population','compact','2023'],['gdp_usd','currency','2023']]);
 assert.equal(m.lead,'All 2 countries, ranked by population and GDP (S1; S2).');
 assert.deepEqual(m.rows[1],{entity_id:'1',name:'A',type:'country',period:'2023',population:11,gdp_usd:5,question:'A',region:'Europe',code:'AAA'},'sources dropped, group and code added');
 assert.equal(m.rows[2].region,undefined);
 assert.deepEqual(m.periods,['2023','2022']);
 assert.equal(m.about[0],'Population (people). Source: S1. Years 2022–2023. 2 ranked.');
 assert.equal(m.about[1],'GDP (USD). Source: S2. Year 2023. 1 ranked of 2.');
 assert.equal(m.about[2],'Scope: 2 of 217.');
 assert.ok(m.about[3].startsWith('Rankings list the top 1,000'),'unfillable about pattern dropped');
 assert.deepEqual(m.related,[{href:'/rankings/sub',title:'Sub ranking'}]);
 const fallback=a.assembleRankingPage({...rankingInput,def:{...rankingInput.def,config:{lead:'{nope}'}}});
 assert.equal(fallback.lead,'2 countries, ranked by population and GDP.');assert.equal(fallback.defaultKey,'population');
});

test('addresses and CSV',()=>{
 assert.equal(a.entityPath('country','Côte d’Ivoire'),'/e/country/'+encodeURIComponent('côte-divoire'));
 assert.equal(a.entityPath('city','Washington, D.C.'),'/e/city/washington-d-c');
 assert.equal(a.rankingPath('country-rankings'),'/rankings/country-rankings');
 assert.equal(a.rowsCsv([{name:'A, "x"',v:1},{name:'B',v:null}],['name','v']),'name,v\n"A, ""x""",1\nB,\n');
});

// ───────────── page data builders against PGlite ─────────────
const out=new URL('../node_modules/.cache/page-assembly-test/',import.meta.url);mkdirSync(out,{recursive:true});
const write=(name,src,map={})=>{let js=tr(src);js=js.replace(/(from\s*|import\()\s*(['"])([^'"]+)\2/g,(m,pre,q,spec)=>map[spec]?`${pre}'${map[spec]}'`:spec.startsWith('./')?`${pre}'${spec}.mjs'`:m);writeFileSync(new URL(name+'.mjs',out),js);};
for(const f of ['client','schema','metrics','embeddings','units','repo'])write(f,readFileSync(`app/entity-db/${f}.ts`,'utf8'));
writeFileSync(new URL('pure.mjs',out),tr(pure));
write('pages',readFileSync('app/entity-db/pages.ts','utf8'),{'@/app/seo/urls':'./pure.mjs','@/app/seo/assemble':'./pure.mjs'});
const client=await import(new URL('client.mjs',out));
const pages=await import(new URL('pages.mjs',out));
const {seed,COUNTRIES}=await import('../scripts/dev/seed-countries-fixture.mjs');
const db=await client.createEntityDb({memory:true,embedDim:8});
test.after(()=>db.close());
await seed(db);

test('entity lookup by type and slug (exact, alias, unknown)',async()=>{
 const de=await pages.findEntityBySlug(db,'country','germany');assert.equal(de.name,'Germany');assert.equal(de.canonical,true);
 assert.equal((await pages.findEntityBySlug(db,'country','united-kingdom')).name,'United Kingdom');
 assert.equal(await pages.findEntityBySlug(db,'city','reykjavík'),null,'cities have no template, so no page');
 assert.equal(await pages.findEntityBySlug(db,'city','germany'),null,'type matters');
 assert.equal(await pages.findEntityBySlug(db,'country','germ'),null);
 await db.query("update entities set aliases = array['Deutschland'] where name = 'Germany'");
 const alias=await pages.findEntityBySlug(db,'country','deutschland');assert.equal(alias.name,'Germany');assert.equal(alias.canonical,false);
});

test('ranking page data: long rows, columns, groups, codes, related',async()=>{
 const input=await pages.loadRankingPage(db,'country-rankings');
 assert.equal(input.def.title,'Country Rankings');assert.equal(input.type.plural,'countries');assert.equal(input.type.expected,217);
 assert.deepEqual(input.columns.map(c=>c.column),['population','gdp_usd','gdp_per_capita_usd','area_km2','life_expectancy']);
 assert.equal(input.rows.length,COUNTRIES.length*5);
 const de=input.rows.find(r=>r.name==='Germany'&&r.period==='2023');assert.equal(de.population,84_500_000);
 assert.equal(Object.values(input.entities).filter(x=>x.group==='Europe & Central Asia').length,5);
 assert.ok(Object.values(input.entities).some(x=>x.code==='DEU'));
 assert.deepEqual(input.related.map(r=>r.slug),['countries-in-europe-and-central-asia-rankings']);
 const m=(await import(new URL('pure.mjs',out))).assembleRankingPage(input);
 assert.equal(m.lead,'All 12 countries, ranked by population, GDP, GDP per capita, area, and life expectancy (World Bank WDI SP.POP.TOTL; World Bank WDI NY.GDP.MKTP.CD; derived from World Bank WDI (GDP ÷ population); World Bank WDI AG.SRF.TOTL.K2; World Bank WDI SP.DYN.LE00.IN).');
 const sub=await pages.loadRankingPage(db,'countries-in-europe-and-central-asia-rankings');
 assert.equal(sub.def.status,'draft');assert.deepEqual([...new Set(sub.rows.map(r=>r.name))].sort(),['France','Germany','Iceland','Italy','United Kingdom']);
 assert.equal(await pages.loadRankingPage(db,'nope'),null);
});

test('entity page data: facts with rank and history, peers, relations, rankings containing it',async()=>{
 const r=await pages.loadEntityPage(db,'country','germany');
 const d=r.data;assert.equal(d.entity.name,'Germany');assert.equal(d.type.label,'country');assert.ok(d.type.template.lead.length);
 assert.equal(d.metrics.population.value,84_500_000);assert.equal(d.metrics.population.period,'2023');
 assert.equal(d.metrics.population.rank,8);assert.equal(d.metrics.population.of,12);assert.equal(d.metrics.population.history.length,5);
 assert.equal(d.defs.gdp_usd.label,'GDP');
 assert.equal(d.peers.gdp_per_capita_usd.length,12);assert.equal(d.peers.population.length,12);
 assert.deepEqual(d.relations.outgoing.map(x=>x.predicate+':'+x.name).sort(),['capital:Berlin','part_of:Europe & Central Asia']);
 assert.deepEqual(d.rankings.map(x=>x.slug),['country-rankings','countries-in-europe-and-central-asia-rankings'],'whole-type ranking first');
 assert.deepEqual(d.rankings[1].ranks.map(x=>x.key+':'+x.rank+'/'+x.of),['gdp_per_capita_usd:2/5','population:1/5','life_expectancy:5/5']);
 const india=await pages.loadEntityPage(db,'country','india');assert.deepEqual(india.data.rankings.map(x=>x.slug),['country-rankings'],'not in the Europe sub-ranking');
 const m=(await import(new URL('pure.mjs',out))).assembleEntityPage(d);
 assert.equal(m.lead.join(' '),'Germany is a country in Europe & Central Asia with a population of 84.5M people (2023). It ranks 8th of 12 by population and 3rd by GDP.');
 assert.equal(await pages.loadEntityPage(db,'city','berlin'),null,'a city has no template, so no page');
 assert.equal(await pages.loadEntityPage(db,'country','atlantis'),null);
});

test('sitemap lists rankings with their criteria views and entities of listed types',async()=>{
 const rk=await pages.sitemapRankings(db);
 assert.ok(rk.some(x=>x.path==='/rankings/country-rankings'));assert.ok(rk.some(x=>x.path==='/rankings/country-rankings?rank=gdp_usd'));
 assert.ok(!rk.some(x=>x.path==='/rankings/country-rankings?rank=population'),'the default criterion is the plain address');
 assert.equal(await pages.countSitemapEntities(db),COUNTRIES.length,'cities and regions have neither a template nor a ranking');
 const en=await pages.sitemapEntities(db,0,5);assert.equal(en.length,5);assert.match(en[0].path,/^\/e\/country\//);
});

test('/?ask= questions resolve to rankings and entities by name',async()=>{
 const t=await pages.resolveNamedTargets(db,['Country Rankings','germany','Deutschland','Paris','Atlantis']);
 assert.deepEqual(t,{'country rankings':'/rankings/country-rankings',germany:'/e/country/germany',deutschland:'/e/country/germany'},'Paris has no page (cities have no template)');
});
// (added) A trend section naming metrics in different units becomes one chart per unit.
test('a trend section naming metrics in different units becomes one chart per unit',()=>{
 const base=data();
 const d={...base,type:{...base.type,template:{sections:[{kind:'trend',title:'Overview',metrics:['population','gdp_usd']}]}},
  metrics:{...base.metrics,gdp_usd:{...base.metrics.gdp_usd,history:[{period:'2022',value:4.1e12},{period:'2023',value:4.456e12}]}}};
 const trends=a.assembleEntityPage(d).sections.filter(s=>s.component==='trend');
 assert.equal(trends.length,2);
 assert.deepEqual(trends.map(t=>[t.props.unit??t.props.currency,t.props.series.map(x=>x.label)]),[['people',['Population']],['USD',['GDP']]]);
});
test('lead: type labels read as common nouns; a sentence repeating facts already stated is dropped',()=>{
 const base=data();
 const d={...base,type:{...base.type,label:'Country',template:{lead:['{name} is a {type.label}. Its population is {metric.population} ({period.population}), {rank.population} of {of.population}.',
  '{name} is a {type.label} with a population of {metric.population} ({period.population}), ranked {rank.population} of {of.population} by population.','It lies in {attr.region}.']}}};
 const lead=a.assembleEntityPage(d).lead;
 assert.equal(lead.length,2);assert.match(lead[0],/^Germany is a country\./);assert.equal(lead[1],'It lies in Europe & Central Asia.');
});
test('links: filled values link to existing pages only; attributes fall back to the sub-ranking scoped to them; ranks link to the ranking view',()=>{
 const base=data();
 const d={...base,type:{...base.type,template:{lead:['{name}\'s capital is {rel.capital}; it lies in {attr.region} and is {rank.population} by population.'],card:['rel.capital','attr.region']}},
  rankings:[...base.rankings,{slug:'country-rankings-europe',title:'Country Rankings in Europe & Central Asia',filters:{region:'Europe & Central Asia'},ranks:[]}]};
 const without=a.assembleEntityPage(d);
 assert.deepEqual(without.leadParts[0].filter(p=>p.href).map(p=>[p.text,p.href]),[['Europe & Central Asia','/rankings/country-rankings-europe'],['19th','/rankings/country-rankings']]);
 assert.equal(without.cards[0].href,undefined,'no page for Berlin yet: plain text');
 // Once Berlin has a page, the same page links to it — no change to the page itself.
 const withBerlin=a.assembleEntityPage({...d,links:{berlin:'/e/city/berlin'}});
 assert.deepEqual(withBerlin.leadParts[0].find(p=>p.text==='Berlin'),{text:'Berlin',href:'/e/city/berlin'});
 assert.equal(withBerlin.cards[0].href,'/e/city/berlin');assert.equal(withBerlin.cards[1].href,'/rankings/country-rankings-europe');
 assert.equal(a.partsText(withBerlin.leadParts[0]),withBerlin.lead[0]);
});
test('every entity page lists its rankings, even when the template leaves the section out; each rank opens that criterion',()=>{
 const base=data();
 const m=a.assembleEntityPage({...base,type:{...base.type,template:{lead:['{name}.'],sections:[{kind:'trend',metrics:['population']}]}}});
 const r=m.sections[m.sections.length-1];
 assert.equal(r.component,'rankings');
 assert.deepEqual(r.links[0].ranks.map(x=>[x.text,x.href]),[['19th of 217','/rankings/country-rankings'],['outside the top 1,000','/rankings/country-rankings?rank=gdp_usd'],['not ranked','/rankings/country-rankings?rank=area_km2']]);
});
test('related entities link by id, so a shared name never links to the wrong page',()=>{
 const base=data();
 const d={...base,type:{...base.type,template:{lead:['It borders {rel.borders}.'],card:['rel.borders']}},
  relations:{outgoing:[{id:'id-ga-state',predicate:'borders',name:'Georgia',type:'us_state'}],incoming:[]},
  links:{georgia:'/e/country/georgia'},entityLinks:{'id-ga-state':'/e/us_state/georgia'}};
 const m=a.assembleEntityPage(d);
 assert.deepEqual(m.leadParts[0].find(p=>p.text==='Georgia'),{text:'Georgia',href:'/e/us_state/georgia'});
 assert.equal(m.cards[0].href,'/e/us_state/georgia');
 const noPage=a.assembleEntityPage({...d,entityLinks:{}});
 assert.equal(noPage.cards[0].href,undefined,'the state has no page: no link, never the country of the same name');
});

test('only entities that pass their type\'s page threshold get a page; stubs and untemplated types do not',async()=>{
 const repo=await import(new URL('repo.mjs',out));
 const {id}=await db.tx(q=>repo.upsertEntity(q,{type:'country',name:'Stubland'}));
 await repo.refreshPages(db,{ids:[id]});
 assert.equal(await pages.findEntityBySlug(db,'country','stubland'),null,'a name with no data gets no page');
 assert.equal((await db.query("select count(*)::int n from entities where type='city' and has_page")).rows[0].n,0,'cities have no template');
 const tpl=(await db.query("select template from entity_types where type='country'")).rows[0].template;
 try{
  await db.query("update entity_types set template=$1::jsonb where type='country'",[JSON.stringify({...tpl,page:{minMetrics:50}})]);
  await repo.refreshPages(db,{type:'country'});
  assert.equal(await pages.findEntityBySlug(db,'country','germany'),null,'below the template\'s minMetrics');
  assert.equal(await pages.countSitemapEntities(db),0);
 }finally{
  await db.query("update entity_types set template=$1::jsonb where type='country'",[JSON.stringify(tpl)]);
  await repo.refreshPages(db,{type:'country'});
  await db.query("delete from entities where id=$1::uuid",[id]);
 }
 assert.equal((await pages.findEntityBySlug(db,'country','germany')).name,'Germany');
});

test('topic navigation: the tree opens level by level, with counts from the whole branch',async()=>{
 const root=await pages.loadTopicNav(db,null);
 assert.deepEqual(root.children.map(x=>x.slug),['geography'],'only topics with something published, at the top level');
 assert.equal(root.children[0].sub[0].slug,'countries');assert.ok(root.children[0].rankings>=1);assert.equal(root.children[0].pages,COUNTRIES.length);
 const geo=await pages.loadTopicNav(db,'geography');
 assert.deepEqual(geo.children.map(x=>x.slug),['countries']);assert.ok(geo.rankings.length>=1,'a branch shows its leading rankings');
 const c=await pages.loadTopicNav(db,'countries');
 assert.deepEqual(c.trail.map(x=>x.slug),['geography']);assert.equal(c.children.length,0);
 assert.equal(c.types[0].type,'country');assert.equal(c.types[0].pages,COUNTRIES.length);assert.match(c.types[0].href,/^\/rankings\//);
 assert.equal(c.rankings[0].top.length,3);
 assert.equal(await pages.loadTopicNav(db,'nowhere'),null);
});
