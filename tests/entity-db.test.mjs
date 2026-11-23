import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';import {createHash} from 'node:crypto';import ts from 'typescript';
// Entity database (rankwiki) against in-memory PGlite (Postgres + pgvector in WASM).
// The TS modules are transpiled into node_modules/.cache so their package imports (pglite, zod) resolve;
// '@/…' imports are replaced by small stubs.
const out=new URL('../node_modules/.cache/entity-db-test/',import.meta.url);mkdirSync(out,{recursive:true});
const stubs={'@/app/data-tools/datasets':'./stub-datasets.mjs'};
writeFileSync(new URL('stub-datasets.mjs',out),`export const store=new Map();let n=0;
export const datasetScope=ctx=>ctx.agent?.id||ctx.userId||'anonymous';
export async function loadDataset(scope,id){const d=store.get(scope+'/'+id);if(!d)throw Error('Unknown dataset '+id);return d;}
export async function saveDataset(scope,input){const id='ds_test'+String(++n).padStart(8,'0');const rows=input.rows;const columns=input.columns||[...new Set(rows.flatMap(r=>Object.keys(r)))];store.set(scope+'/'+id,{id,title:input.title,source:input.source,columns,rows,notes:input.notes});return {datasetId:id,title:input.title,source:input.source,rowCount:rows.length,columns:columns.map(name=>({name})),preview:rows.slice(0,8),notes:input.notes};}
`);
for(const f of ['client','schema','metrics','embeddings','units','reserved','repo','inherit','tools']){
 let js=ts.transpileModule(readFileSync(new URL(`../app/entity-db/${f}.ts`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 js=js.replace(/(from\s*|import\()\s*(['"])([^'"]+)\2/g,(m,pre,q,spec)=>stubs[spec]?`${pre}'${stubs[spec]}'`:spec.startsWith('./')?`${pre}'${spec}.mjs'`:m);
 writeFileSync(new URL(f+'.mjs',out),js);
}
const client=await import(new URL('client.mjs',out));
const schema=await import(new URL('schema.mjs',out));
const repo=await import(new URL('repo.mjs',out));
const emb=await import(new URL('embeddings.mjs',out));
const metrics=await import(new URL('metrics.mjs',out));
const tools=await import(new URL('tools.mjs',out));
const datasets=await import(new URL('stub-datasets.mjs',out));

const DIM=16;
// Deterministic bag-of-words embedder: each word hashes to a dimension, so shared words → similar vectors.
const fakeEmbed=async texts=>texts.map(t=>{const v=new Array(DIM).fill(0);for(const w of t.toLowerCase().match(/[\p{L}\p{N}]+/gu)||[]){const h=createHash('sha1').update(w).digest();v[h[0]%DIM]+=1;v[h[1]%DIM]+=0.5;}if(v.every(x=>x===0))v[0]=1;return v;});
const db=await client.createEntityDb({memory:true,embedDim:DIM});
client.setEntityDb(db);
test.after(()=>db.close());

test('migrations are versioned and idempotent',async()=>{
 const again=await schema.migrate(db,{embedDim:DIM});
 assert.deepEqual(again.applied,[]);assert.equal(again.version,schema.SCHEMA_VERSION);assert.equal(again.embedDim,DIM);
 const v=await db.query('select version from schema_version');assert.equal(v.rows.length,schema.MIGRATIONS.length);
 const t=await db.query("select table_name from information_schema.tables where table_schema='public' order by 1");
 for(const name of ['topics','editors','roadmap_items','inbox','entities','metrics','observations','rankings','sources','relations','schema_version'])assert.ok(t.rows.some(r=>r.table_name===name),name);
});

test('identity resolution: QID merge, alias match, types kept apart, conflicting ids',async()=>{
 const a=await db.tx(q=>repo.upsertEntity(q,{type:'country',name:'United States',ids:{wikidata:'http://www.wikidata.org/entity/Q30'},attributes:{region:'Americas'}}));
 assert.equal(a.action,'inserted');
 const b=await db.tx(q=>repo.upsertEntity(q,{type:'country',name:'United States of America',ids:{wikidata:'Q30',iso3:'usa'}}));
 assert.equal(b.action,'merged');assert.equal(b.id,a.id);
 const e=await repo.getEntity(db,'iso3:USA');
 assert.equal(e.id,a.id);assert.deepEqual(e.ids,{wikidata:'Q30',iso3:'USA'});assert.deepEqual(e.aliases,['United States of America']);
 // alias match without ids
 const c=await db.tx(q=>repo.upsertEntity(q,{type:'country',name:'united states of america ',aliases:['USA']}));
 assert.equal(c.id,a.id);assert.deepEqual((await repo.getEntity(db,'USA')).aliases.sort(),['USA','United States of America']);
 // same name, different type → separate entity
 const g1=await db.tx(q=>repo.upsertEntity(q,{type:'country',name:'Georgia'}));
 const g2=await db.tx(q=>repo.upsertEntity(q,{type:'us_state',name:'Georgia'}));
 assert.notEqual(g1.id,g2.id);assert.equal(g2.action,'inserted');
 assert.equal((await repo.getEntity(db,'Georgia','us_state')).id,g2.id);
 // same name and type but a different QID → not merged
 const g3=await db.tx(q=>repo.upsertEntity(q,{type:'country',name:'Georgia',ids:{wikidata:'Q230'}}));
 assert.equal(g3.id,g1.id,'no-id entity adopts the QID');
 const g4=await db.tx(q=>repo.upsertEntity(q,{type:'country',name:'Georgia',ids:{wikidata:'Q1428'}}));
 assert.notEqual(g4.id,g1.id);
 // ids pointing at two entities: first (wikidata) wins, conflicting key not written
 const x=await db.tx(q=>repo.upsertEntity(q,{type:'country',name:'Georgia',ids:{wikidata:'Q230',iso3:'USA'}}));
 assert.equal(x.id,g1.id);assert.equal(x.idConflicts,1);
 assert.equal((await repo.getEntity(db,'Q230')).ids.iso3,undefined);
});

test('upsertEntities maps dataset rows; observations upsert per (entity, metric, period, source)',async()=>{
 const rows=[{name:'Alpha',code:'ALP',region:'North',pop:'1,000',year:2022},{name:'Beta',code:'BET',region:'South',pop:3000,year:2022},{name:'Gamma',code:'GAM',region:'North',pop:'n/a',year:2022},{name:'',code:'X'}];
 const mapping={type:'land',nameColumn:'name',idColumns:{iso3:'code'},attributeColumns:['region'],metricColumns:{pop:{metric:'pop_test',unit:'people',period:'year'}}};
 const r=await repo.upsertEntities(db,rows,mapping,{source:'test-src'});
 assert.equal(r.inserted,3);assert.equal(r.skipped,1);assert.equal(r.observations,2);
 const again=await repo.upsertEntities(db,[{name:'Alpha',code:'ALP',region:'North',pop:'1,500',year:2022}],mapping,{source:'test-src'});
 assert.equal(again.merged,1);
 const obs=await db.query("select o.value, o.period from observations o join entities e on e.id=o.entity_id where e.name='Alpha' and o.metric='pop_test'");
 assert.deepEqual(obs.rows,[{value:1500,period:'2022'}]);
 await repo.recordObservations(db,[{entityId:again.entityIds[0],metric:'pop_test',value:1600,period:'2023',source:'test-src'}]);
 const a=await repo.getEntity(db,'iso3:ALP','land');
 assert.equal(a.facts[0].value,1600);assert.equal(a.facts[0].period,'2023');assert.equal(a.facts[0].rank,2);assert.equal(a.facts[0].of,2);
 assert.equal(a.history.length,2);
 assert.equal((await repo.getMetric(db,'pop_test')).unit,'people');
});

test('hybridSearch: vector + text + filters fused by RRF; text-only fallback',async()=>{
 const T='planet';
 const items=[['Mars','red desert planet with iron oxide dust',{moons:2,zone:'outer'}],['Venus','hot cloudy planet with sulfuric acid clouds',{moons:0,zone:'inner'}],['Earth','blue ocean planet with life',{moons:1,zone:'inner'}],['Jupiter','gas giant with a great red spot storm',{moons:95,zone:'outer'}]];
 for(const [name,description,attributes] of items)await db.tx(q=>repo.upsertEntity(q,{type:T,name,description,attributes}));
 const p=await db.query("select e.id from entities e where e.name='Earth' and e.type='planet'");
 await repo.recordObservations(db,[{entityId:p.rows[0].id,metric:'radius_km',value:6371,period:'2020',source:'s'}]);
 // text only (no embedder)
 emb.setEmbedder(null);
 let r=await repo.hybridSearch(db,{query:'red',type:T});
 assert.equal(r.mode,'text');assert.deepEqual(r.results.map(x=>x.name).sort(),['Jupiter','Mars']);
 // with embeddings
 emb.setEmbedder(fakeEmbed);
 const done=await repo.embedPending(db,1000);assert.ok(done.entities>=4);
 r=await repo.hybridSearch(db,{query:'ocean life',type:T,limit:4});
 assert.equal(r.mode,'hybrid');assert.equal(r.results[0].name,'Earth');assert.ok(r.results[0].matchedBy.includes('vector'));assert.ok(r.results[0].matchedBy.includes('text'));
 // exact name ranks first
 assert.equal((await repo.hybridSearch(db,{query:'Venus',type:T})).results[0].name,'Venus');
 // attribute filters and numeric attribute comparisons
 r=await repo.hybridSearch(db,{query:'planet',type:T,filters:{zone:'INNER'}});assert.deepEqual(r.results.map(x=>x.name).sort(),['Earth','Venus']);
 r=await repo.hybridSearch(db,{query:'',type:T,filters:{moons:{'>':1}}});assert.deepEqual(r.results.map(x=>x.name),['Jupiter','Mars']);
 r=await repo.hybridSearch(db,{query:'',type:T,filters:{zone:['outer'],moons:{'<':50}}});assert.deepEqual(r.results.map(x=>x.name),['Mars']);
 // metric filter on the latest value
 r=await repo.hybridSearch(db,{query:'planet',type:T,filters:{radius_km:{'>=':6000}}});assert.deepEqual(r.results.map(x=>x.name),['Earth']);
 // hostile input stays a parameter
 r=await repo.hybridSearch(db,{query:"'); drop table entities; --",type:T,filters:{"zone') or true --":'x'}});assert.equal(r.results.length,0);
 assert.ok((await db.query('select count(*)::int as n from entities')).rows[0].n>0);
 emb.setEmbedder(null);
});

test('metricTable: competition ranks with ties, missing values, asc order, period selection',async()=>{
 const T='team';const ids={};
 for(const n of ['A','B','C','D','E'])ids[n]=(await db.tx(q=>repo.upsertEntity(q,{type:T,name:'Team '+n})) ).id;
 await repo.defineMetric(db,{key:'goals',label:'Goals',unit:'goals'});
 await repo.defineMetric(db,{key:'conceded',label:'Goals conceded',order:'asc'});
 const o=(n,metric,value,period='2024')=>({entityId:ids[n],metric,value,period,source:'league'});
 await repo.recordObservations(db,[o('A','goals',10),o('B','goals',20),o('C','goals',20),o('D','goals',5),o('A','goals',99,'2023'),o('A','conceded',3),o('B','conceded',3),o('C','conceded',1),o('E','conceded',7)]);
 const t=await repo.metricTable(db,{type:T,metrics:['goals','conceded']});
 const by=Object.fromEntries(t.rows.map(r=>[r.name,r]));
 assert.deepEqual(t.rows.map(r=>[r.name,r.rank]),[['Team B',1],['Team C',1],['Team A',3],['Team D',4],['Team E',null]]);
 assert.equal(by['Team A'].goals_period,'2024');assert.equal(by['Team A'].goals_source,'league');
 assert.equal(by['Team C'].conceded_rank,1);assert.equal(by['Team A'].conceded_rank,2);assert.equal(by['Team B'].conceded_rank,2);assert.equal(by['Team E'].conceded_rank,4);
 assert.equal(by['Team D'].conceded,null);assert.equal(by['Team D'].conceded_rank,null);
 assert.equal(t.metrics[0].count,4);assert.equal(t.metrics[1].count,4);assert.equal(t.metrics[1].order,'asc');
 const y=await repo.metricTable(db,{type:T,metrics:['goals'],period:'2023'});
 assert.deepEqual(y.rows.map(r=>[r.name,r.goals,r.rank]),[['Team A',99,1]]);
});

test('derived metric: weighted_sum + minmax with missing=reweight, versioning, sensitivity, metricTable',async()=>{
 const T='city';const ids={};
 for(const n of ['P','Q','R','S'])ids[n]=(await db.tx(q=>repo.upsertEntity(q,{type:T,name:'City '+n}))).id;
 await repo.defineMetric(db,{key:'income',label:'Income'});
 await repo.defineMetric(db,{key:'crime',label:'Crime rate',order:'asc'});
 const o=(n,metric,value)=>({entityId:ids[n],metric,value,period:'2024',source:'stats'});
 // income: P 100, Q 50, R 0, S 75 ; crime: P 10, Q 0, R 5, S missing
 await repo.recordObservations(db,[o('P','income',100),o('Q','income',50),o('R','income',0),o('S','income',75),o('P','crime',10),o('Q','crime',0),o('R','crime',5)]);
 const definition={inputs:[{metric:'income'},{metric:'crime'}],normalize:'minmax',combine:'weighted_sum',weights:[3,-1],missing:'reweight',min_inputs:1,scope:{type:T}};
 // invalid definitions are rejected with a readable message
 await assert.rejects(()=>repo.defineDerivedMetric(db,{key:'liveability',definition:{...definition,weights:[1]}}),/weights has 1 numbers for 2 inputs/);
 await assert.rejects(()=>repo.defineDerivedMetric(db,{key:'liveability',definition:{...definition,inputs:[{metric:'nope'},{metric:'crime'}]}}),/does not exist/);
 const d1=await repo.defineDerivedMetric(db,{key:'liveability',label:'Liveability',methodology:'Income up, crime down.',definition});
 assert.deepEqual([d1.version,d1.status,d1.action],[1,'draft','created']);
 // draft and unused: edits in place
 const d1b=await repo.defineDerivedMetric(db,{key:'liveability',definition:{...definition,weights:[2,-1]}});
 assert.deepEqual([d1b.version,d1b.action],[1,'updated']);
 await repo.defineDerivedMetric(db,{key:'liveability',definition});
 const c=await repo.computeDerivedMetric(db,'liveability',1);
 // minmax: income P1 Q.5 R0 S.75 ; crime P1 Q0 R.5 ; score=(3x-1y)/4, S reweighted → 3*.75/3=.75
 // P (3-1)/4=.5, Q 1.5/4=.375, R -.5/4=-.125, S .75
 assert.equal(c.computed,4);assert.equal(c.source,'derived:liveability@v1');
 assert.deepEqual(c.top.map(x=>[x.name,x.rank,x.value]),[['City S',1,0.75],['City P',2,0.5],['City Q',3,0.375],['City R',4,-0.125]]);
 // used → a changed definition creates v2; v1 and its values stay
 const d2=await repo.defineDerivedMetric(db,{key:'liveability',definition:{...definition,missing:'skip_entity'}});
 assert.deepEqual([d2.version,d2.action,d2.status],[2,'new_version','draft']);
 assert.equal((await repo.getMetric(db,'liveability',1)).definition.missing,'reweight');
 // presentation edits on a used version stay in place
 const same=await repo.defineDerivedMetric(db,{key:'liveability',label:'Liveability index',definition:{...definition,missing:'skip_entity'}});
 assert.deepEqual([same.version,same.action],[2,'updated']);
 const c2=await repo.computeDerivedMetric(db,'liveability',2);assert.equal(c2.computed,3);assert.equal(c2.skipped,1);
 // metricTable: derived metrics transparently (latest version unless one is published; key@N pins one)
 let t=await repo.metricTable(db,{type:T,metrics:['liveability']});
 assert.equal(t.metrics[0].version,2);assert.equal(t.rows.filter(r=>r.liveability!=null).length,3);
 await repo.publishMetric(db,'liveability',1);
 t=await repo.metricTable(db,{type:T,metrics:['liveability','income']});
 assert.equal(t.metrics[0].version,1);assert.equal(t.metrics[0].kind,'derived');assert.equal(t.rows[0].name,'City S');assert.equal(t.rows[0].liveability_source,'derived:liveability@v1');
 t=await repo.metricTable(db,{type:T,metrics:['liveability@2']});assert.equal(t.metrics[0].column,'liveability_v2');assert.equal(t.rows[0].name,'City P');
 await repo.publishMetric(db,'liveability',2);assert.equal((await repo.getMetric(db,'liveability',1)).status,'retired');
 // sensitivity
 const s=await repo.sensitivity(db,'liveability',1);
 assert.equal(s.top.length,4);assert.equal(s.scenarios.length,6,'2 weights × ±20% + 2 drops');
 for(const x of s.scenarios){assert.ok(['weight','drop'].includes(x.kind));assert.equal(typeof x.meanAbsShift,'number');assert.equal(typeof x.maxAbsShift,'number');assert.ok(Array.isArray(x.moved));assert.ok(x.topRetained<=4);}
 const noCrime=s.scenarios.find(x=>x.kind==='drop'&&x.input==='crime');
 assert.ok(noCrime.moved.some(m=>m.name==='City P'&&m.from===2&&m.to===1),'without crime, P (richest) is first');
 assert.match(s.summary,/scenarios/);
 // the observed unit change of a published observed metric creates a new version
 const inc=await repo.defineMetric(db,{key:'income',unit:'USD'});assert.deepEqual([inc.version,inc.action],[2,'new_version']);
});

test('evaluateDefinition: geomean, ratio, zscore, rank_pct, zero',()=>{
 const pts=o=>new Map(Object.entries(o).map(([k,v])=>[k,{value:v,period:'2024'}]));
 const data={inputs:[pts({a:4,b:1,c:9}),pts({a:1,b:4,c:1})],denominators:{population:pts({a:2,b:2,c:3}),area_km2:new Map()}};
 const def=x=>metrics.parseDefinition({scope:{type:'t'},...x});
 let r=metrics.evaluateDefinition(def({inputs:[{metric:'x'},{metric:'y'}],combine:'ratio'}),data);assert.deepEqual([...r].map(([k,v])=>[k,v.value]),[['a',4],['b',0.25],['c',9]]);
 r=metrics.evaluateDefinition(def({inputs:[{metric:'x',transform:'per_capita'},{metric:'y'}],combine:'difference'}),data);assert.equal(r.get('c').value,2);
 r=metrics.evaluateDefinition(def({inputs:[{metric:'x'},{metric:'y'}],combine:'weighted_geomean',weights:[1,1]}),data);assert.equal(r.get('a').value,2);assert.equal(r.get('c').value,3);
 r=metrics.evaluateDefinition(def({inputs:[{metric:'x'}],normalize:'zscore',combine:'weighted_sum',weights:[1]}),data);assert.ok(Math.abs([...r.values()].reduce((s,v)=>s+v.value,0))<1e-9);
 r=metrics.evaluateDefinition(def({inputs:[{metric:'x',transform:'rank_pct'}],combine:'weighted_sum',weights:[1]}),data);assert.deepEqual([r.get('b').value,r.get('a').value,r.get('c').value],[0,0.5,1]);
 const partial={...data,inputs:[pts({a:1,b:1}),pts({a:1})]};
 r=metrics.evaluateDefinition(def({inputs:[{metric:'x'},{metric:'y'}],combine:'weighted_sum',weights:[1,1],missing:'zero'}),partial);assert.equal(r.get('b').value,0.5);
 r=metrics.evaluateDefinition(def({inputs:[{metric:'x'},{metric:'y'}],combine:'weighted_sum',weights:[1,1],missing:'skip_entity'}),partial);assert.equal(r.has('b'),false);
 assert.throws(()=>def({inputs:[{metric:'x'}],combine:'ratio'}),/exactly 2 inputs/);
 assert.throws(()=>def({inputs:[{metric:'x'}],combine:'weighted_sum',weights:[1],code:'1'}),/Invalid derived metric/);
 assert.deepEqual([...metrics.competitionRanks(pts({a:3,b:5,c:5,d:1}))],[['b',1],['c',1],['a',3],['d',4]]);
});

test('editors: leases never hand out the same editor; expiry makes it leasable again',async()=>{
 const topic=await repo.createTopic(db,{name:'Lease test topic',description:'x'});
 const now=new Date('2030-01-01T00:00:00Z');
 const e1=await repo.createEditor(db,{topicId:topic.id,nextShiftAt:new Date('2029-12-31T00:00:00Z')});
 const e2=await repo.createEditor(db,{topicId:topic.id,nextShiftAt:new Date('2029-12-31T01:00:00Z')});
 await repo.createEditor(db,{topicId:topic.id,nextShiftAt:new Date('2030-02-01T00:00:00Z')});// not due
 const [a,b]=await Promise.all([repo.leaseDueEditors(db,{limit:1,now}),repo.leaseDueEditors(db,{limit:1,now})]);
 assert.equal(a.length,1);assert.equal(b.length,1);assert.notEqual(a[0].id,b[0].id);
 assert.deepEqual([a[0].id,b[0].id].sort(),[e1.id,e2.id].sort());
 assert.deepEqual(await repo.leaseDueEditors(db,{limit:5,now}),[],'all due editors are leased');
 assert.equal(await repo.renewLease(db,a[0].id,b[0].leaseId,60,now),false,'wrong lease id');
 assert.equal(await repo.renewLease(db,a[0].id,a[0].leaseId,3600,now),true);
 // b crashes: after its lease expires it is leased again
 const later=new Date(now.getTime()+11*60_000);
 const again=await repo.leaseDueEditors(db,{limit:5,now:later});
 assert.deepEqual(again.map(e=>e.id),[b[0].id]);assert.notEqual(again[0].leaseId,b[0].leaseId);
 assert.equal(await repo.releaseEditor(db,b[0].id,b[0].leaseId),false,'stale lease cannot release');
 assert.equal(await repo.releaseEditor(db,a[0].id,a[0].leaseId,{nextShiftAt:new Date('2030-01-02T00:00:00Z'),memory:['done'],stats:{shifts:1}}),true);
 const ed=await repo.getEditor(db,a[0].id);assert.equal(ed.state,'idle');assert.equal(ed.leaseId,null);assert.deepEqual(ed.memory,['done']);
});

test('roadmap cadence → next due; failures back off; inbox triage; topics',async()=>{
 assert.equal(repo.nextDue('monthly',new Date('2024-01-31T10:00:00Z')).toISOString(),'2024-02-29T10:00:00.000Z');
 assert.equal(repo.nextDue('yearly',new Date('2024-02-29T00:00:00Z')).toISOString(),'2025-02-28T00:00:00.000Z');
 assert.equal(repo.nextDue('weekly',new Date('2024-01-01T00:00:00Z')).toISOString(),'2024-01-08T00:00:00.000Z');
 assert.equal(repo.nextDue('6h',new Date('2024-01-01T00:00:00Z')).toISOString(),'2024-01-01T06:00:00.000Z');
 assert.equal(repo.nextDue('',new Date()),null);assert.throws(()=>repo.nextDue('fortnightly'),/Unknown cadence/);
 const root=await repo.createTopic(db,{name:'Countries',description:'Sovereign states and their statistics'});
 const child=await repo.createTopic(db,{parentId:root.id,name:'Cities of Asia',description:'Asian cities, population and economy'});
 assert.deepEqual((await repo.listChildTopics(db,root.id)).map(t=>t.slug),['cities-of-asia']);
 assert.equal((await repo.getTopic(db,'cities-of-asia')).id,child.id);
 emb.setEmbedder(null);
 assert.equal((await repo.nearestTopics(db,'asian cities',3))[0].id,child.id,'text fallback');
 emb.setEmbedder(fakeEmbed);await repo.embedPending(db,1000);
 assert.equal((await repo.nearestTopics(db,'Cities of Asia population',3))[0].id,child.id,'vector');
 emb.setEmbedder(null);
 const ed=await repo.createEditor(db,{topicId:child.id});
 const now=new Date('2031-03-01T00:00:00Z');
 const refresh=await repo.addRoadmapItem(db,{editorId:ed.id,kind:'refresh',title:'Refresh populations',cadence:'monthly',dueAt:now,priority:10});
 const demand=await repo.addRoadmapItem(db,{editorId:ed.id,kind:'ranking',title:'Largest cities by GDP',origin:'query',dueAt:now,priority:1});
 await repo.addRoadmapItem(db,{editorId:ed.id,kind:'review',title:'later',dueAt:new Date('2031-04-01T00:00:00Z')});
 assert.deepEqual((await repo.dueRoadmapItems(db,ed.id,{now})).map(i=>i.title),['Largest cities by GDP','Refresh populations'],'reader demand first');
 const done=await repo.completeRoadmapItem(db,refresh.id,{ok:true,result:{rows:10},now});
 assert.equal(done.status,'pending');assert.equal(done.dueAt,'2031-04-01T00:00:00.000Z');assert.deepEqual(done.lastResult,{rows:10});
 assert.equal((await repo.completeRoadmapItem(db,demand.id,{now})).status,'done');
 let f=await repo.addRoadmapItem(db,{editorId:ed.id,kind:'ingest',title:'flaky',dueAt:now});
 f=await repo.completeRoadmapItem(db,f.id,{ok:false,result:{error:'429'},now});assert.equal(f.status,'pending');assert.equal(f.attempts,1);assert.equal(f.dueAt,'2031-03-01T01:00:00.000Z');
 for(let i=0;i<4;i++)f=await repo.completeRoadmapItem(db,f.id,{ok:false,now});
 assert.equal(f.status,'failed');
 assert.equal((await repo.updateRoadmapItem(db,f.id,{status:'pending',priority:90})).priority,90);
 const q1=await repo.addInbox(db,{editorId:ed.id,query:'largest cities in asia',language:'en',served:false});
 await repo.addInbox(db,{editorId:ed.id,query:'tokyo population',served:true});
 assert.equal((await repo.listInbox(db,ed.id)).length,2);
 assert.equal(await repo.triageInbox(db,ed.id,[q1.id],'added roadmap item'),1);
 assert.deepEqual((await repo.listInbox(db,ed.id)).map(i=>i.query),['tokyo population']);
});

test('agent tools: entity_upsert from a dataset, entity_search, entity_get, metric_table, define/compute/sensitivity',async()=>{
 const ctx={userId:'u1',language:'en',ownerId:'u1',visibility:'public',agent:{id:'editor-1'}};
 const ds=await datasets.saveDataset('editor-1',{title:'Islands',source:'https://example.org/islands',rows:[
  {Island:'Ilha A',qid:'Q1001',Area:'1,200',Pop:500,Ocean:'Atlantic',Year:2020},{Island:'Ilha B',qid:'Q1002',Area:'800',Pop:900,Ocean:'Pacific',Year:2020},{Island:'Ilha C',qid:'Q1003',Area:'800',Pop:'',Ocean:'Pacific',Year:2020}]});
 assert.equal(tools.entityTools.length,9);
 for(const t of tools.entityTools){assert.deepEqual(t.parameters.required,Object.keys(t.parameters.properties));assert.ok(t.description.includes('xample'),t.name+' has an example');}
 const up=await tools.runEntityTool('entity_upsert',{datasetId:ds.datasetId,type:'Island',nameColumn:'Island',idColumns:'{"wikidata":"qid"}',aliasColumns:'',descriptionColumn:'',attributeColumns:'Ocean=ocean',metricColumns:'{"Area":{"metric":"island_area","unit":"km2","period":"Year"},"Pop":{"metric":"island_pop","unit":"people","period":"2020"}}',relationColumns:'',source:'',topicId:''},ctx);
 assert.equal(up.data.inserted,3);assert.equal(up.data.observations,5);
 await assert.rejects(()=>tools.runEntityTool('entity_upsert',{datasetId:ds.datasetId,type:'island',nameColumn:'Nope',idColumns:'',aliasColumns:'',descriptionColumn:'',attributeColumns:'',metricColumns:'',relationColumns:'',source:'',topicId:''},ctx),/not in the dataset/);
 const s=await tools.runEntityTool('entity_search',{query:'',type:'island',filters:'{"ocean":"pacific","island_area":{"<":1000}}',limit:0},ctx);
 assert.deepEqual(s.data.results.map(r=>r.name),['Ilha B','Ilha C']);
 const g=await tools.runEntityTool('entity_get',{entity:'Q1002',type:''},ctx);
 const area=g.data.facts.find(f=>f.metric==='island_area');assert.equal(area.rank,2);assert.equal(area.of,3);
 const mt=await tools.runEntityTool('metric_table',{type:'island',filters:'',metrics:'island_area,island_pop',period:'latest',title:'Islands by area'},ctx);
 assert.equal(mt.data.rowCount,3);
 const rows=(await datasets.loadDataset('editor-1',mt.data.datasetId)).rows;
 assert.deepEqual(rows.map(r=>[r.name,r.island_area_rank]),[['Ilha A',1],['Ilha B',2],['Ilha C',2]]);
 assert.equal(rows[0].wikidata,'Q1001');
 const dm=await tools.runEntityTool('define_metric',{key:'island_density',label:'Density',unit:'people/km2',description:'',methodology:'People per km2.',order:'',format:'decimal:1',
  definition:JSON.stringify({inputs:[{metric:'island_pop'},{metric:'island_area'}],combine:'ratio',scope:{type:'island'}})},ctx);
 assert.equal(dm.data.version,1);assert.equal(dm.data.metric.createdBy,'editor-1');assert.equal(dm.data.metric.kind,'derived');
 const cm=await tools.runEntityTool('compute_metric',{key:'island_density',version:0},ctx);
 assert.equal(cm.data.computed,2);assert.equal(cm.data.top[0].name,'Ilha B');
 const sm=await tools.runEntityTool('metric_sensitivity',{key:'island_density',version:0},ctx);
 assert.equal(sm.data.scenarios.length,0);assert.match(sm.data.summary,/Not applicable/);
 await assert.rejects(()=>tools.runEntityTool('define_metric',{key:'Bad Key',label:'',unit:'',description:'',methodology:'',order:'',format:'',definition:''},ctx),/Invalid metric key/);
});

test('relations: upsert links entities (stubs for unknown names, ids), rel filters (direct and transitive), entity_get both directions',async()=>{
 const ctx={agent:{id:'editor-rel'}};
 const geo=await datasets.saveDataset('editor-rel',{title:'geo',source:'t',rows:[
  {name:'Europa',kind:'continent'},
  {name:'Francia',qid:'Q9142',cont:'Europa'},{name:'Germania',qid:'Q9183',cont:'Europa'},
  {name:'Lutetia',country:'Q9142'},{name:'Lugdunum',country:'Q9142'},{name:'Colonia',country:'Q9183'}]});
 const up=async(rows,args)=>{const d=await datasets.saveDataset('editor-rel',{title:'x',source:'t',rows});return (await tools.runEntityTool('entity_upsert',{datasetId:d.datasetId,idColumns:'',aliasColumns:'',descriptionColumn:'',attributeColumns:'',metricColumns:'',relationColumns:'',source:'geo-src',topicId:'',...args},ctx)).data;};
 const all=(await datasets.loadDataset('editor-rel',geo.datasetId)).rows;
 await up(all.slice(0,1),{type:'continent',nameColumn:'name'});
 const c=await up(all.slice(1,3),{type:'nation',nameColumn:'name',idColumns:'{"wikidata":"qid"}',relationColumns:'{"cont":{"predicate":"part_of","type":"continent"}}'});
 assert.equal(c.relations,2);assert.equal(c.unresolved,0);
 const t=await up(all.slice(3),{type:'town',nameColumn:'name',relationColumns:'{"country":{"predicate":"located_in","type":"nation","by":"wikidata"}}'});
 assert.equal(t.relations,3);
 // Unknown brand names become minimal entities; several in one cell; create:false skips.
 const p=await up([{name:'Fleur Une',brand:'Maison X'},{name:'Fleur Deux',brand:'Maison X; Maison Y'},{name:'Fleur Trois',brand:'Nobody'}],
  {type:'scent',nameColumn:'name',relationColumns:'{"brand":{"predicate":"brand","type":"maison"}}'});
 assert.equal(p.relations,4);assert.equal((await repo.hybridSearch(db,{type:'maison'})).results.length,3);
 const q=await up([{name:'Fleur Quatre',brand:'Unknown House'}],{type:'scent',nameColumn:'name',relationColumns:'{"brand":{"predicate":"brand","type":"maison","create":false}}'});
 assert.equal(q.relations,0);assert.equal(q.unresolved,1);
 const names=async(type,filters)=>(await tools.runEntityTool('entity_search',{query:'',type,filters:JSON.stringify(filters),limit:0},ctx)).data.results.map(r=>r.name).sort();
 assert.deepEqual(await names('scent',{'rel.brand':'Maison X'}),['Fleur Deux','Fleur Une']);
 assert.deepEqual(await names('scent',{'rel.brand':['Maison Y','Nobody']}),['Fleur Deux','Fleur Trois']);
 assert.deepEqual(await names('town',{'rel.located_in':'Q9142'}),['Lugdunum','Lutetia']);
 assert.deepEqual(await names('town',{'rel.located_in':'Europa'}),[]);
 assert.deepEqual(await names('town',{'rel.located_in+':'Europa'}),[]);// different predicates: part_of is not followed
 assert.deepEqual(await names('',{'rel.part_of+':'Europa'}),['Francia','Germania']);
 assert.deepEqual(await names('town',{'rel.located_in|part_of+':'Europa'}),['Colonia','Lugdunum','Lutetia']);
 assert.deepEqual(await names('',{'rel.located_in|part_of':'Q9183'}),['Colonia']);
 assert.deepEqual(await names('town',{'rel.located_in':'Nowhere'}),[]);
 const f=(await tools.runEntityTool('entity_get',{entity:'Q9142',type:''},ctx)).data;
 assert.deepEqual(f.relations.outgoing.map(r=>[r.predicate,r.object.name,r.source]),[['part_of','Europa','geo-src']]);
 assert.deepEqual(f.relations.incoming.map(r=>[r.predicate,r.type,r.count,r.sample.map(x=>x.name)]),[['located_in','town',2,['Lugdunum','Lutetia']]]);
 await assert.rejects(()=>up([{name:'a',b:'c'}],{type:'scent',nameColumn:'name',relationColumns:'{"b":{"type":"maison"}}'}),/needs \{"predicate"/);
 // Repeats update instead of duplicating.
 await up(all.slice(3,4),{type:'town',nameColumn:'name',relationColumns:'{"country":{"predicate":"located_in","type":"nation","by":"wikidata"}}'});
 assert.equal(Number((await db.query("select count(*) n from relations where predicate='located_in'")).rows[0].n),3);
});

test('latest snapshot: values, ranks over the type, relations; kept current on writes; rebuild; promote_attribute',async()=>{
 const ctx={agent:{id:'editor-snap'}};
 const d=await datasets.saveDataset('editor-snap',{title:'peaks',source:'t',rows:[
  {name:'Mons A',h:'4800',y:2020,range:'Alpi',stars:'3'},{name:'Mons B',h:'4500',y:2020,range:'Alpi',stars:'x'},{name:'Mons C',h:'4500',y:2020,range:'Pyrenaei'}]});
 await tools.runEntityTool('entity_upsert',{datasetId:d.datasetId,type:'peak',nameColumn:'name',idColumns:'',aliasColumns:'',descriptionColumn:'',attributeColumns:'stars',
  metricColumns:'{"h":{"metric":"peak_height","unit":"m","period":"y"}}',relationColumns:'{"range":{"predicate":"range","type":"mountain_range"}}',source:'peak-src',topicId:''},ctx);
 const latest=async name=>(await db.query("select latest from entities where type='peak' and name=$1",[name])).rows[0].latest;
 let a=await latest('Mons A'),c=await latest('Mons C');
 assert.deepEqual([a.metrics.peak_height.value,a.metrics.peak_height.period,a.metrics.peak_height.source,a.metrics.peak_height.rank,a.metrics.peak_height.of],[4800,'2020','peak-src',1,3]);
 assert.equal(c.metrics.peak_height.rank,2);// tie with B
 assert.deepEqual(a.relations.range.map(x=>x.name),['Alpi']);
 // A newer value for C moves the others' ranks too.
 const cId=(await db.query("select id from entities where name='Mons C'")).rows[0].id;
 await repo.recordObservations(db,[{entityId:cId,metric:'peak_height',value:4900,period:'2024',source:'survey'}]);
 a=await latest('Mons A');c=await latest('Mons C');
 assert.equal(c.metrics.peak_height.value,4900);assert.equal(c.metrics.peak_height.rank,1);assert.equal(a.metrics.peak_height.rank,2);assert.equal((await latest('Mons B')).metrics.peak_height.rank,3);
 // Same ranks as metric_table.
 const t=await repo.metricTable(db,{type:'peak',metrics:['peak_height']});
 for(const r of t.rows)assert.equal((await latest(r.name)).metrics.peak_height.rank,r.peak_height_rank);
 // Rebuild from scratch gives the same snapshot.
 const before=await latest('Mons B');await db.query("update entities set latest='{}'::jsonb where type='peak'");
 assert.deepEqual(await repo.rebuildLatest(db,{type:'peak'}),{entities:3});assert.deepEqual(await latest('Mons B'),before);
 // promote_attribute: numeric attribute → metric with ranks; non-numbers skipped; attribute kept.
 const p=await tools.runEntityTool('promote_attribute',{type:'peak',attribute:'stars',metric:'',unit:'stars',period:'',source:''},ctx);
 assert.deepEqual([p.data.metric,p.data.withAttribute,p.data.promoted,p.data.skipped],['stars',2,1,1]);
 a=await latest('Mons A');assert.deepEqual([a.metrics.stars.value,a.metrics.stars.rank,a.metrics.stars.of,a.metrics.stars.source],[3,1,1,'attribute:stars']);
 assert.equal(a.metrics.peak_height.rank,2);// other ranks kept
 assert.equal((await db.query("select attributes->>'stars' s from entities where name='Mons A'")).rows[0].s,'3');
});

test('units: values are stored in base units; the conversion is reported',async()=>{
 const units=await import(new URL('units.mjs',out)).catch(()=>null);
 const d=await datasets.saveDataset('editor-units',{title:'gdp',source:'t',rows:[{name:'Atlantis',gdp:'2,500,000',area:'100'}]});
 const r=(await tools.runEntityTool('entity_upsert',{datasetId:d.datasetId,type:'realm',nameColumn:'name',idColumns:'',aliasColumns:'',descriptionColumn:'',attributeColumns:'',
  metricColumns:'{"gdp":{"metric":"realm_gdp","unit":"million USD","period":"2024"},"area":{"metric":"realm_area","unit":"sq mi","period":"2024"}}',relationColumns:'',source:'s',topicId:''},{agent:{id:'editor-units'}})).data;
 assert.deepEqual(r.units.map(u=>[u.column,u.to,u.factor]),[['gdp','USD',1e6],['area','km2',2.589988110336]]);
 const v=Object.fromEntries((await db.query("select o.metric, o.value from observations o join entities e on e.id=o.entity_id where e.name='Atlantis'")).rows.map(x=>[x.metric,Number(x.value)]));
 assert.equal(v.realm_gdp,2.5e12);assert.ok(Math.abs(v.realm_area-258.9988110336)<1e-6);
 assert.equal((await repo.getMetric(db,'realm_gdp')).unit,'USD');
});
test('normalizeUnit: scale words, Chinese scales, currencies, imperial → SI, unknown units unchanged',async()=>{
 const {normalizeUnit:n}=await import(new URL('units.mjs',out));
 assert.deepEqual([n('million USD').unit,n('million USD').factor],['USD',1e6]);
 assert.deepEqual([n('US$ bn').unit,n('US$ bn').factor],['USD',1e9]);
 assert.deepEqual([n('亿元人民币').unit,n('亿元人民币').factor],['CNY',1e8]);
 assert.deepEqual([n('百万美元').unit,n('百万美元').factor],['USD',1e6]);
 assert.deepEqual([n('万人').unit,n('万人').factor],['people',1e4]);
 assert.deepEqual([n('hectares').unit,n('hectares').factor],['km2',0.01]);
 assert.deepEqual(n('years'),{unit:'years',factor:1,changed:false});
 assert.deepEqual(n('%'),{unit:'%',factor:1,changed:false});
});
test('metric_table stops at a rank limit: rows are the union of each metric\'s top N, with exact ranks',async()=>{
 const ctx={agent:{id:'editor-limit'}};
 const rows=Array.from({length:12},(_,i)=>({name:'Lim '+i,a:String(100-i),b:String(i)}));
 const d=await datasets.saveDataset('editor-limit',{title:'lim',source:'t',rows});
 await tools.runEntityTool('entity_upsert',{datasetId:d.datasetId,type:'limtest',nameColumn:'name',idColumns:'',aliasColumns:'',descriptionColumn:'',attributeColumns:'',
  metricColumns:'{"a":{"metric":"lim_a","period":"2024"},"b":{"metric":"lim_b","period":"2024"}}',relationColumns:'',source:'s',topicId:''},ctx);
 const t=await repo.metricTable(db,{type:'limtest',metrics:['lim_a','lim_b'],limit:3});
 assert.deepEqual(t.rows.map(r=>r.name).sort(),['Lim 0','Lim 1','Lim 10','Lim 11','Lim 2','Lim 9'].sort());
 assert.equal(t.rows.find(r=>r.name==='Lim 11').lim_b_rank,1);assert.equal(t.rows.find(r=>r.name==='Lim 11').lim_a_rank,12);
 assert.equal((await repo.metricTable(db,{type:'limtest',metrics:['lim_a']})).rows.length,12);
});
test('metric_table period "all": long form, one row per entity and period',async()=>{
 const ctx={agent:{id:'editor-hist'}};
 const rows=[];for(const [n,base] of [['Hist A',10],['Hist B',20]])for(const y of [2020,2021,2022])rows.push({name:n,year:String(y),v:String(base+y-2020)});
 const d=await datasets.saveDataset('editor-hist',{title:'h',source:'t',rows});
 await tools.runEntityTool('entity_upsert',{datasetId:d.datasetId,type:'histtest',nameColumn:'name',idColumns:'',aliasColumns:'',descriptionColumn:'',attributeColumns:'',
  metricColumns:'{"v":{"metric":"hist_v","period":"year"}}',relationColumns:'',source:'s',topicId:''},ctx);
 const t=await repo.metricTable(db,{type:'histtest',metrics:['hist_v'],period:'all'});
 assert.equal(t.period,'all');assert.deepEqual(t.rows.map(r=>[r.name,r.period,r.hist_v]),[['Hist A','2020',10],['Hist A','2021',11],['Hist A','2022',12],['Hist B','2020',20],['Hist B','2021',21],['Hist B','2022',22]]);
});

// Topic team configuration (app/teams/config.ts) on the same database.
{
 let js=ts.transpileModule(readFileSync(new URL('../app/teams/config.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 js=js.replace(/(from\s*)(['"])@\/app\/entity-db\/(client|repo)\2/g,(m,pre,q,f)=>`${pre}'./${f}.mjs'`);
 writeFileSync(new URL('teams-config.mjs',out),js);
}
const teams=await import(new URL('teams-config.mjs',out));
test('team config: entity type templates validated and merged; ranking definitions checked; recipes; team runs',async()=>{
 await assert.rejects(()=>teams.saveEntityType(db,{type:'realm',template:{sections:[{kind:'nonsense'}]},updatedBy:'t'}),/Unknown section kind/);
 const t1=await teams.saveEntityType(db,{type:'Realm',label:'realm',plural:'realms',schema:{identity:{ids:['iso3']}},updatedBy:'collector'});
 const t2=await teams.saveEntityType(db,{type:'realm',template:{lead:['{name} is a realm.'],card:['realm_gdp'],sections:[{kind:'trend',metrics:['realm_gdp']}]},updatedBy:'editor'});
 assert.equal(t1.type,'realm');assert.deepEqual(t2.schema,{identity:{ids:['iso3']}});assert.equal(t2.label,'realm');assert.equal(t2.template.lead[0],'{name} is a realm.');assert.equal(t2.status,'draft');
 await assert.rejects(()=>teams.saveRankingDef(db,{slug:'Bad Slug',title:'Realm Rankings',scope:{type:'realm'},criteria:['realm_gdp'],config:{}}),/slug/);
 await assert.rejects(()=>teams.saveRankingDef(db,{slug:'top-realms',title:'Top realms by GDP',scope:{type:'realm'},criteria:['realm_gdp'],config:{}}),/Rankings/);
 await assert.rejects(()=>teams.saveRankingDef(db,{slug:'realm-rankings',title:'Realm Rankings',scope:{type:'realm'},criteria:['no_such_metric'],config:{}}),/Unknown metrics: no_such_metric/);
 const r=await teams.saveRankingDef(db,{slug:'realm-rankings',title:'Realm Rankings',scope:{type:'Realm',filters:{}},criteria:['realm_gdp','realm_area'],config:{default:'realm_gdp',period:'all'}});
 assert.equal(r.scope.type,'realm');assert.deepEqual(r.criteria,['realm_gdp','realm_area']);
 await teams.saveRankingDef(db,{slug:'realm-rankings',title:'Realm Rankings',scope:{type:'realm'},criteria:['realm_area'],config:{}});
 assert.deepEqual((await teams.getRankingDef(db,'realm-rankings')).criteria,['realm_area']);
 assert.equal((await teams.listRankingDefs(db,{type:'realm'})).length,1);
 await teams.setStatus(db,'ranking','realm-rankings','published');assert.equal((await teams.getRankingDef(db,'realm-rankings')).status,'published');
 const rc=await teams.saveRecipe(db,{type:'realm',name:'wb-gdp',steps:[{id:'a',tool:'fetch_data',args:{}}],schedule:'monthly',createdBy:'collector'});
 await teams.recordRecipeRun(db,rc.id,false,{ok:false});assert.equal((await teams.getRecipe(db,'realm','wb-gdp')).status,'failed');
 const run=await teams.startTeamRun(db,{topicId:null,role:'editor',task:'plan'});
 await teams.logTeamCall(db,run,{tool:'team_state'});await teams.finishTeamRun(db,run,{status:'done',summary:'ok'});
 const runs=await teams.listTeamRuns(db);assert.equal(runs[0].calls,1);assert.equal(runs[0].status,'done');
});
test('ranking view texts: the whole ranking and one per criterion, with scope filters',()=>{
 const metrics=new Map([['co2_pc',{label:'CO2 emissions per capita',unit:'t CO2e per capita',description:'Fossil CO2 per person.'}]]);
 const v=teams.rankingViewTexts({title:'Country Rankings in Europe',scope:{type:'country',filters:{region:'Europe'}},criteria:['co2_pc','population']},metrics);
 assert.deepEqual(v.map(x=>x.criterion),['','co2_pc','population']);
 assert.equal(v[0].text,'Country Rankings in Europe. Ranks every country where region is Europe by CO2 emissions per capita, population.');
 assert.match(v[1].text,/^Country Rankings in Europe by CO2 emissions per capita\. Every country where region is Europe ranked by CO2 emissions per capita \(t CO2e per capita\): Fossil CO2 per person\.$/);
});

test('retracting a ruled-out source rebuilds the snapshot from what remains; keepSource never empties a metric',async()=>{
 const {id}=await db.tx(q=>repo.upsertEntity(q,{type:'retract_land',name:'Retractia'}));
 await repo.recordObservations(db,[{entityId:id,metric:'land_km2',value:500,period:'2025',source:'flags https://x'},{entityId:id,metric:'land_km2',value:480,period:'2024',source:'worldbank:AG.SRF'},{entityId:id,metric:'land_km2',value:470,period:'2023',source:'worldbank:AG.SRF'}]);
 const snap=async()=>(await db.query('select latest from entities where id=$1::uuid',[id])).rows[0].latest.metrics.land_km2;
 assert.equal((await snap()).period,'2025');
 await assert.rejects(repo.retractObservations(db,{type:'retract_land',metric:'land_km2',keepSource:'nosuch'}),/nothing would remain/);
 await assert.rejects(repo.retractObservations(db,{type:'retract_land',metric:'land_km2'}),/exactly one/);
 const r=await repo.retractObservations(db,{type:'retract_land',metric:'land_km2',keepSource:'worldbank:'});
 assert.equal(r.removed,1);assert.equal(r.remaining,2);assert.deepEqual(r.sourcesLeft.map(x=>x.source),['worldbank:AG.SRF']);
 const s=await snap();assert.equal(s.period,'2024');assert.equal(Number(s.value),480);
});
