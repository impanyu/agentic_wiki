process.env.RANKS_SYNC='1';import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';import {createHash} from 'node:crypto';import ts from 'typescript';
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
for(const f of ['client','schema','metrics','embeddings','units','reserved','repo','inherit','dedup','tools','tree-index','members','class-tree']){
 let js=ts.transpileModule(readFileSync(new URL(`../app/entity-db/${f}.ts`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 js=js.replace(/(from\s*|import\()\s*(['"])([^'"]+)\2/g,(m,pre,q,spec)=>stubs[spec]?`${pre}'${stubs[spec]}'`:spec.startsWith('./')?`${pre}'${spec}.mjs'`:m);
 writeFileSync(new URL(f+'.mjs',out),js);
}
{let js=ts.transpileModule(readFileSync(new URL('../app/teams/trunk.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 js=js.replace(/(from\s*|import\()\s*(['"])@\/app\/entity-db\/([a-z-]+)\2/g,(m,pre,q,f)=>`${pre}'./${f}.mjs'`);writeFileSync(new URL('trunk.mjs',out),js);}
{let js=ts.transpileModule(readFileSync(new URL('../app/work/queue.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;writeFileSync(new URL('work-queue.mjs',out),js);}
{let js=ts.transpileModule(readFileSync(new URL('../app/work/checks.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 js=js.replace(/(['"])\.\/queue\1/g,"'./work-queue.mjs'").replace(/(['"])\.\/kinds\1/g,"'./stub-kinds.mjs'").replace(/(['"])@\/app\/entity-db\/inherit\1/g,"'./inherit.mjs'").replace(/(['"])@\/app\/ops\/issues\1/g,"'./stub-issues.mjs'");
 writeFileSync(new URL('work-checks.mjs',out),js);
 let cj=ts.transpileModule(readFileSync(new URL('../app/work/completeness.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 writeFileSync(new URL('work-completeness.mjs',out),cj.replace(/(['"])@\/app\/entity-db\/inherit\1/g,"'./inherit.mjs'"));
 writeFileSync(new URL('stub-kinds.mjs',out),`export const KINDS={class_members:{pool:'collector',target:'class'},class_fields:{pool:'collector',target:'class'},page_build:{pool:'editor',target:'page'},page_refresh:{pool:'editor',target:'page'},page_retire:{pool:'editor',target:'page'},source_repair:{pool:'collector',target:'class'},source_review:{pool:'collector',target:'class'},class_evolution:{pool:'collector',target:'class'},class_patrol:{pool:'collector',target:'class'},page_patrol:{pool:'editor',target:'page'},page_fix:{pool:'editor',target:'page'},check_trial:{pool:'reviewer',target:'none'}};`);
 writeFileSync(new URL('stub-issues.mjs',out),`export const raised=[];export async function raiseIssue(db,x){raised.push(x);return {issue:{id:'i'},isNew:true};}`);}
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

test('identity across the system: one record per thing in a type family, overlap joins also_types, other types become candidates',async()=>{
 await db.query("insert into entity_types(type,label,schema) values ('institution','Institution','{}'::jsonb),('univ','University','{\"extends\":\"institution\"}'::jsonb),('research_univ','Research university','{\"extends\":\"univ\"}'::jsonb),('asian_univ','Asian university','{\"extends\":\"univ\"}'::jsonb),('expat_dest','Expat destination','{}'::jsonb) on conflict do nothing");
 const {clearFamilyCache}=await import(new URL('dedup.mjs',out));clearFamilyCache();
 const u=await db.tx(q=>repo.upsertEntity(q,{type:'research_univ',name:'Peking University',attributes:{country:'China'}}));
 // A sibling type (both extend univ) finds the same record; it joins asian_univ through also_types.
 const v=await db.tx(q=>repo.upsertEntity(q,{type:'asian_univ',name:'Peking University',attributes:{country:'China'}}));
 assert.equal(v.id,u.id);assert.equal(v.action,'merged');
 assert.deepEqual((await db.query("select also_types from entities where id=$1::uuid",[u.id])).rows[0].also_types,['asian_univ']);
 assert.ok(await repo.inScope(db,{type:'asian_univ'},u.id),'an also-type entity is in that type\'s scope');
 // Same name in another country: a different university.
 const w=await db.tx(q=>repo.upsertEntity(q,{type:'asian_univ',name:'Peking University',attributes:{country:'Taiwan'}}));
 assert.notEqual(w.id,u.id);
 // An unrelated type with the same name: a candidate pair for the resolver, not a silent duplicate.
 const c=await db.tx(q=>repo.upsertEntity(q,{type:'country',name:'Japan'}));
 const e=await db.tx(q=>repo.upsertEntity(q,{type:'expat_dest',name:'Japan'}));
 assert.notEqual(e.id,c.id);
 assert.equal((await db.query("select count(*)::int n from entity_candidates where a=$1::uuid and b=$2::uuid",[e.id,c.id])).rows[0].n,1);
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
 // income: P 100, Q 50, R 0, S 80 ; crime: P 10, Q 0, R 5, S missing
 await repo.recordObservations(db,[o('P','income',100),o('Q','income',50),o('R','income',0),o('S','income',80),o('P','crime',10),o('Q','crime',0),o('R','crime',5)]);
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
 assert.deepEqual(c.top.map(x=>[x.name,x.rank,x.value]),[['City S',1,80],['City P',2,75],['City Q',3,62.5],['City R',4,12.5]],'0–100, crime (negative weight) reversed');
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
 r=metrics.evaluateDefinition(def({inputs:[{metric:'x'},{metric:'y'}],combine:'weighted_geomean',weights:[1,1]}),data);assert.equal(r.get('a').value,0,'composites are rescaled to 0–100');assert.equal(r.get('c').value,100);
 r=metrics.evaluateDefinition(def({inputs:[{metric:'x'}],normalize:'zscore',combine:'weighted_sum',weights:[1]}),data);assert.deepEqual([r.get('b').value,r.get('c').value],[0,100]);
 r=metrics.evaluateDefinition(def({inputs:[{metric:'x',transform:'rank_pct'}],combine:'weighted_sum',weights:[1]}),data);assert.deepEqual([r.get('b').value,r.get('a').value,r.get('c').value],[0,50,100]);
 const partial={...data,inputs:[pts({a:1,b:1}),pts({a:1})]};
 r=metrics.evaluateDefinition(def({inputs:[{metric:'x'},{metric:'y'}],combine:'weighted_sum',weights:[1,1],missing:'zero'}),partial);assert.equal(r.get('b').value,0);assert.equal(r.get('a').value,100);
 // On a 0–1 scale: 100 × the weighted mean; a negative weight is a measure where lower is better.
 r=metrics.evaluateDefinition(def({inputs:[{metric:'x'},{metric:'y'}],normalize:'minmax',combine:'weighted_sum',weights:[3,-1]}),data);
 assert.equal(r.get('c').value,100);assert.equal(r.get('b').value,0);assert.ok(Math.abs(r.get('a').value-(3*0.375+1)/4*100)<1e-6);
 assert.match(metrics.formulaText(def({inputs:[{metric:'x'},{metric:'y',transform:'log'}],normalize:'minmax',combine:'weighted_sum',weights:[3,-1]}),k=>k.toUpperCase()),/^Score from 0 to 100, higher is better: the weighted average of 75% × X, 25% × log\(Y\) \(lower is better\)/);
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

test('trunk and tags: an off-division subtopic becomes a tag of its class; tagged entities are in the tag\'s rankings',async()=>{
 const trunk=await import(new URL('trunk.mjs',out));const inh=await import(new URL('inherit.mjs',out));
 const P=await repo.createTopic(db,{slug:'t-laptops',name:'Laptops'});const C=await repo.createTopic(db,{slug:'t-gaming-laptops',name:'Gaming laptops',description:'Laptops built for games: a dedicated GPU and a high refresh-rate screen.',parentId:P.id});
 await db.query(`insert into entity_types(type,topic_id,schema) values ('t_laptop',$1,'{"metrics":[{"key":"weight_kg"}]}'),('t_gaming_laptop',$2,'{"extends":"t_laptop","metrics":[{"key":"gpu_score"}]}')`,[P.id,C.id]);inh.clearTypeCache();
 const a=await repo.upsertEntity(db,{type:'t_laptop',name:'Zephyrus G14'});const b=await repo.upsertEntity(db,{type:'t_gaming_laptop',name:'Zephyrus G14 '});
 await repo.upsertEntity(db,{type:'t_gaming_laptop',name:'Legion 7'});
 await assert.rejects(trunk.checkTrunkSplit(db,'t-laptops',''),/division/);
 await trunk.setDivision(db,'t-laptops','form factor');
 await assert.rejects(trunk.checkTrunkSplit(db,'t-laptops','use case'),/view/);await trunk.checkTrunkSplit(db,'t-laptops','By form-factor');
 const r=await trunk.convertToInterface(db,'t-gaming-laptops','use case, not form factor');assert.equal(r.ok,true);
 const et=(await db.query("select topic_id, schema from entity_types where type='t_gaming_laptop'")).rows[0];
 assert.equal(et.schema.kind,'interface');assert.equal(et.schema.appliesTo,'t_laptop');assert.equal(et.schema.extends,undefined);assert.equal(et.topic_id,P.id);
 const rows=(await db.query("select name, type, also_types from entities where type in ('t_laptop','t_gaming_laptop') order by name")).rows;
 assert.ok(rows.every(x=>x.type==='t_laptop'),'members are of the class');assert.ok(rows.every(x=>x.also_types.includes('t_gaming_laptop')),'and tagged');
 assert.equal((await db.query("select status from topics where slug='t-gaming-laptops'")).rows[0].status,'archived');
 // Loaded under the tag later: the class, tagged. Scope of the tag = its members; the class scope has all.
 await repo.upsertEntity(db,{type:'t_gaming_laptop',name:'ROG Strix'});
 const strix=(await db.query("select type, also_types from entities where name='ROG Strix'")).rows[0];assert.equal(strix.type,'t_laptop');assert.deepEqual(strix.also_types,['t_gaming_laptop']);
 await repo.upsertEntity(db,{type:'t_laptop',name:'ThinkPad X1'});
 assert.equal((await repo.entitySearchIds(db,{type:'t_gaming_laptop'})).length,3);assert.equal((await repo.entitySearchIds(db,{type:'t_laptop'})).length,4);
 const eff=await inh.effectiveType(db,'t_gaming_laptop');assert.deepEqual(eff.schema.metrics.map(m=>m.key),['weight_kg','gpu_score'],'a tag has its class\'s schema plus its own');
 // An editor's own tag: defined, then entities tagged by name.
 await trunk.defineInterface(db,P.id,{type:'t_business_laptop',label:'business laptop',rule:'Sold in the maker\'s business line (ThinkPad, Latitude, EliteBook) per the maker\'s site.'});
 const t=await trunk.tagEntities(db,P.id,{iface:'t_business_laptop',entities:['ThinkPad X1','Nope'],evidence:'https://example.com/thinkpad'});
 assert.equal(t.tagged,1);assert.deepEqual(t.unknown,['Nope']);assert.equal((await repo.entitySearchIds(db,{type:'t_business_laptop'})).length,1);
 const u=await trunk.revertConversion(db,'t-gaming-laptops');assert.equal(u.ok,true);
 assert.equal((await db.query("select status from topics where slug='t-gaming-laptops'")).rows[0].status,'active');
 assert.equal((await db.query("select schema->>'extends' e from entity_types where type='t_gaming_laptop'")).rows[0].e,'t_laptop');
 assert.equal((await db.query("select count(*)::int n from entities where type='t_gaming_laptop'")).rows[0].n,3,'members retyped back');
 void a;void b;
});

test('the tree is the index: entities sit at the deepest node their attributes lead to; a view subtopic becomes a query of its parent',async()=>{
 const trunk=await import(new URL('trunk.mjs',out));const idx=await import(new URL('tree-index.mjs',out));const inh=await import(new URL('inherit.mjs',out));
 const P=await repo.createTopic(db,{slug:'x-players',name:'Football players'});
 const PL=await repo.createTopic(db,{slug:'x-pl-players',name:'Premier League players',parentId:P.id});
 const LL=await repo.createTopic(db,{slug:'x-laliga-players',name:'La Liga players',parentId:P.id});
 const V=await repo.createTopic(db,{slug:'x-young-players',name:'Young stars',parentId:P.id});
 await db.query(`insert into entity_types(type,topic_id,schema) values ('x_player',$1,'{"metrics":[{"key":"goals"}]}'),('x_pl_player',$2,'{"extends":"x_player"}'),('x_young_player',$3,'{"extends":"x_player","metrics":[{"key":"potential"}]}')`,[P.id,PL.id,V.id]);inh.clearTypeCache();
 await repo.upsertEntity(db,{type:'x_pl_player',name:'Bukayo Saka'});
 await repo.upsertEntity(db,{type:'x_player',name:'Pedri',attributes:{league:'La Liga'}});
 await repo.upsertEntity(db,{type:'x_player',name:'Nobody Known'});
 await repo.upsertEntity(db,{type:'x_player',name:'Lamine Yamal',attributes:{league:'la liga'}});
 await repo.upsertEntity(db,{type:'x_young_player',name:'Lamine Yamal'});
 await repo.upsertEntity(db,{type:'x_young_player',name:'Endrick'});
 await db.query(`insert into rankings(slug,title,topic_id,scope,criteria,config,status) values ('x-young','Young stars',$1,'{"type":"x_young_player"}','{}','{}','published')`,[V.id]);
 await trunk.applySplit(db,P.id,{key:'league',label:'league',why:'',children:[
  {slug:'x-pl-players',role:'value',values:['Premier League','EPL'],filter:{key:'',value:''}},
  {slug:'x-laliga-players',role:'value',values:['La Liga'],filter:{key:'',value:''}},
  {slug:'x-young-players',role:'view',values:[],filter:{key:'young_star',value:'yes'}}]},['x-pl-players','x-laliga-players','x-young-players']);
 // A member collected for a value carries it.
 assert.equal((await db.query("select attributes->>'league' l from entities where name='Bukayo Saka'")).rows[0].l,'Premier League');
 const v=await trunk.convertView(db,'x-young-players');assert.equal(v.ok,true);assert.equal(v.merged,1,'the twin under the class absorbs the view\'s copy');
 const yamal=(await db.query("select type, attributes from entities where ent_norm(name)='lamine yamal'")).rows;
 assert.equal(yamal.length,1);assert.equal(yamal[0].type,'x_player');assert.equal(yamal[0].attributes.young_star,'yes');
 assert.deepEqual((await db.query("select scope from rankings where slug='x-young'")).rows[0].scope,{type:'x_player',filters:{young_star:'yes'}});
 assert.equal((await repo.entitySearchIds(db,{type:'x_player',filters:{young_star:'yes'}})).length,2);
 assert.ok((await db.query("select schema from entity_types where type='x_player'")).rows[0].schema.metrics.some(m=>m.key==='potential'),'the view\'s fields join the class');
 await idx.placeEntities(db);
 const at=async n=>(await db.query("select t.slug from entities e join topics t on t.id=e.node_id where e.name=$1",[n])).rows[0]?.slug;
 assert.equal(await at('Bukayo Saka'),'x-pl-players');assert.equal(await at('Pedri'),'x-laliga-players');assert.equal(await at('Lamine Yamal'),'x-laliga-players');
 assert.equal(await at('Nobody Known'),'x-players','no value for the split: stays at the node (a gap)');assert.equal(await at('Endrick'),'x-players');
 // A transfer: the value changes, the entity moves.
 await db.query("update entities set attributes=attributes||'{\"league\":\"EPL\"}' where name='Pedri'");await idx.placeEntities(db);
 assert.equal(await at('Pedri'),'x-pl-players');
 const ix=await idx.nodeIndex(db,P.id);assert.equal(ix.unplaced,2);assert.deepEqual(ix.views,['x-young-players']);
 void LL;
});

test('a split judgement is used only when the key is an attribute of the entities and every subtopic has its value',async()=>{
 const trunk=await import(new URL('trunk.mjs',out));const node={slug:'musicians',name:'Musicians and singers'};
 const ch=(slug,role,values)=>({slug,role,values,filter:{key:'',value:''}});
 assert.match(trunk.splitProblem({key:'musicians',label:'',why:'',children:[ch('rappers','value',['hip hop'])]},node,['rappers']),/names the node/);
 assert.match(trunk.splitProblem({key:'genre',label:'',why:'',children:[ch('rappers','value',[])]},node,['rappers']),/values missing/);
 assert.match(trunk.splitProblem({key:'genre',label:'',why:'',children:[]},node,['rappers']),/not judged/);
 assert.equal(trunk.splitProblem({key:'genre',label:'',why:'',children:[ch('rappers','value',['hip hop']),ch('spotify-artists','view',[])]},node,['rappers','spotify-artists']),'');
});

test('the database keeps the tree (closure table) and each ranking\'s members (its stored query, materialized)',async()=>{
 const mem=await import(new URL('members.mjs',out));
 const A=await repo.createTopic(db,{slug:'y-parks',name:'Parks'});const B=await repo.createTopic(db,{slug:'y-np',name:'National parks',parentId:A.id});const C=await repo.createTopic(db,{slug:'y-np-ca',name:'Canadian national parks',parentId:B.id});
 const sub=(await db.query("select t.slug from topic_closure c join topics t on t.id=c.descendant where c.ancestor=$1 order by c.depth",[A.id])).rows.map(r=>r.slug);
 assert.deepEqual(sub,['y-parks','y-np','y-np-ca']);
 const D=await repo.createTopic(db,{slug:'y-other',name:'Other'});await db.query('update topics set parent_id=$1 where id=$2',[D.id,C.id]);
 assert.equal((await db.query('select count(*)::int n from topic_closure where ancestor=$1',[A.id])).rows[0].n,2,'moving a node rebuilds the closure');
 await db.query('update topics set parent_id=$1 where id=$2',[B.id,C.id]);
 await db.query(`insert into entity_types(type,topic_id) values ('y_park',$1)`,[B.id]);
 const a=await repo.upsertEntity(db,{type:'y_park',name:'Banff',attributes:{country:'Canada'}});const b=await repo.upsertEntity(db,{type:'y_park',name:'Yosemite',attributes:{country:'USA'}});
 await db.query('update entities set node_id=$1 where id=$2',[C.id,a.id]);await db.query('update entities set node_id=$1 where id=$2',[B.id,b.id]);
 assert.equal((await repo.entitySearchIds(db,{node:'y-parks'})).length,2);assert.equal((await repo.entitySearchIds(db,{node:'y-np-ca'})).length,1);
 const r=(await db.query(`insert into rankings(slug,title,topic_id,scope,criteria,config,status) values ('y-ca','Parks in Canada',$1,'{"type":"y_park","filters":{"country":"canada"}}','{}','{}','published') returning id`,[B.id])).rows[0];
 await mem.refreshMembers(db);
 const m=await mem.memberOf(db,a.id,['y-ca']);assert.equal(m.get('y-ca'),true);assert.equal((await mem.memberOf(db,b.id,['y-ca'])).get('y-ca'),false);
 // A change to the class refreshes the members.
 await db.query("update entities set attributes=attributes||'{\"country\":\"Canada\"}', updated_at=now()+interval '1 second' where id=$1",[b.id]);
 await mem.refreshMembers(db);assert.equal((await mem.memberOf(db,b.id,['y-ca'])).get('y-ca'),true);void r;
});

test('importing the class tree: old types become their classes, view members carry the view\'s values, twins merge, tags end, rankings re-scope',async()=>{
 const ct=await import(new URL('class-tree.mjs',out));const inh=await import(new URL('inherit.mjs',out));
 const F=await repo.createTopic(db,{slug:'z-fp',name:'Football players'});const PL=await repo.createTopic(db,{slug:'z-pl',name:'Premier League players',parentId:F.id});const Y=await repo.createTopic(db,{slug:'z-young',name:'Young',parentId:F.id});
 await db.query(`insert into entity_types(type,topic_id,schema,template,status) values ('z_fp',$1,'{"metrics":[{"key":"goals"}]}','{"lead":["x"]}','published'),('z_pl',$2,'{"extends":"z_fp","metrics":[{"key":"pl_goals"}]}','{}','published'),('z_young',$3,'{"kind":"interface","appliesTo":"z_fp"}','{}','draft')`,[F.id,PL.id,Y.id]);inh.clearTypeCache();
 const k=await repo.upsertEntity(db,{type:'z_fp',name:'Harry Kane'});await db.query("insert into entities(type,name) values ('z_pl','Harry Kane')");await repo.upsertEntity(db,{type:'z_pl',name:'Bukayo Saka'});
 await db.query("update entities set also_types=array['z_young'] where name='Bukayo Saka'");
 await db.query(`insert into rankings(slug,title,topic_id,scope,criteria,config,status) values ('z-pl-r','PL',$1,'{"type":"z_pl"}','{}','{}','published'),('z-y-r','Young',$2,'{"type":"z_young"}','{}','{}','published')`,[PL.id,Y.id]);
 const spec={classes:[{key:'z_fp',label:'Football player',plural:'Football players',parent:null,attributes:[{key:'leagues_played',type:'list'},{key:'young_star',type:'bool'}],metrics:[{key:'caps'}],mapsFrom:{types:['z_fp'],topics:['z-fp']}}],
  views:[{topic:'z-pl',class:'z_fp',filters:{leagues_played:'Premier League'}},{topic:'z-young',class:'z_fp',filters:{young_star:'yes'}}]};
 const dry=await ct.importClassTree(db,spec,{dryRun:true,log:()=>{}});assert.equal(dry.moves.find(m=>m.from==='z_pl').to,'z_fp');
 await assert.rejects(ct.importClassTree(db,spec,{log:()=>{}}),/have no class/);const r=await ct.importClassTree(db,spec,{allowUnmapped:true,log:()=>{}});assert.equal(r.merged,1);
 const rows=(await db.query("select name, type, attributes, also_types from entities where name in ('Harry Kane','Bukayo Saka') and type like 'z_%' order by name")).rows;
 assert.equal(rows.length,2);assert.ok(rows.every(x=>x.type==='z_fp'));
 assert.deepEqual(rows.find(x=>x.name==='Harry Kane').attributes.leagues_played,['Premier League']);
 assert.equal(rows.find(x=>x.name==='Bukayo Saka').attributes.young_star,'yes');assert.deepEqual(rows.find(x=>x.name==='Bukayo Saka').also_types,[]);
 const sc=Object.fromEntries((await db.query("select slug, scope from rankings where slug like 'z-%'")).rows.map(x=>[x.slug,x.scope]));
 assert.deepEqual(sc['z-pl-r'],{type:'z_fp',filters:{leagues_played:'Premier League'}});assert.deepEqual(sc['z-y-r'],{type:'z_fp',filters:{young_star:'yes'}});
 assert.equal((await repo.entitySearchIds(db,{type:'z_fp',filters:{leagues_played:'Premier League'}})).length,2);
 const et=(await db.query("select type, schema, template from entity_types where type in ('z_fp','z_pl')")).rows;
 const fp=et.find(x=>x.type==='z_fp');assert.ok(fp.schema.metrics.some(m=>m.key==='pl_goals'),'old types\' metrics kept');assert.deepEqual(fp.template.lead,['x']);
 assert.equal(et.find(x=>x.type==='z_pl').schema.kind,'retired');void k;
});

test('the work queue: one open task per kind and target (a second request joins it), highest priority first, leases',async()=>{
 const q=await import(new URL('work-queue.mjs',out));
 const a=await q.enqueue(db,{kind:'class_members',pool:'collector',target:'w_film',priority:40,payload:{why:'empty'}});
 const b=await q.enqueue(db,{kind:'class_members',pool:'collector',target:'w_film',priority:70,payload:{why:'a page waits'},requestedBy:'editor'});
 assert.equal(a.created,true);assert.equal(b.created,false);assert.equal(a.id,b.id);
 const row=(await db.query('select priority, payload from work_tasks where id=$1',[a.id])).rows[0];assert.equal(row.priority,70);assert.equal(row.payload.requests.length,2);
 await q.enqueue(db,{kind:'class_fields',pool:'collector',target:'w_film',priority:10});
 await q.enqueue(db,{kind:'page_build',pool:'editor',target:'class:w_film',priority:99});
 const t=await q.claim(db,'collector');assert.equal(t.kind,'class_members');assert.equal(t.attempts,1);
 const t2=await q.claim(db,'collector');assert.equal(t2.kind,'class_fields');assert.equal(await q.claim(db,'collector'),null);
 await q.finish(db,t.id,'done',{summary:'ok'});
 assert.equal((await q.enqueue(db,{kind:'class_members',pool:'collector',target:'w_film'})).created,true,'a finished task does not block a new one');
 await q.finish(db,t2.id,'queued',{requeued:'model busy'});assert.equal((await q.claim(db,'collector')).kind,'class_members');
});

test('checks: one loop turns failing classes and pages into tasks for their owners; agents\' checks go on trial, and pause when they flag most of the site',async()=>{
 const c=await import(new URL('work-checks.mjs',out));
 assert.ok(c.checkSqlProblem('delete from entities'));assert.ok(c.checkSqlProblem('select 1; drop table x'));assert.ok(c.checkSqlProblem("select pg_sleep(10) target"));
 assert.equal(c.checkSqlProblem("select type target from entity_types where schema->>'kind'='class'"),undefined);
 await db.query("insert into entity_types(type,label,plural,description,schema) values ('ck_root','Ck','Cks','',$1::jsonb),('ck_leaf','Ck leaf','Ck leaves','',$2::jsonb) on conflict (type) do update set schema=excluded.schema",
  [JSON.stringify({kind:'class'}),JSON.stringify({kind:'class',extends:'ck_root'})]);
 await db.query("delete from work_tasks");
 const made=await c.runChecks(db,()=>{});
 assert.ok(made['class-empty']>=1,'an empty leaf class gets a members task');
 const t=(await db.query("select kind, pool, requested_by, payload from work_tasks where target='ck_leaf' and kind='class_members'")).rows[0];
 assert.equal(t.pool,'collector');assert.equal(t.requested_by,'check:class-empty');
 assert.equal((await db.query("select count(*)::int n from work_tasks where target='ck_root' and kind='class_members'")).rows[0].n,0,'a class with subclasses is collected through them');
 const again=await c.runChecks(db,()=>{});assert.ok(!again['class-empty']||!(await db.query("select 1 from work_tasks where target='ck_leaf' and kind='class_members' and status='queued' offset 1")).rows.length,'no second open task');
 // An agent's check: trial first (no tasks), a reviewer task to confirm it.
 const p=await c.proposeCheck(db,{title:'Leaf classes named Ck',object:'class',kind:'class_fields',sql:"select type target from entity_types where label like 'Ck%'",why:'test'},'agent:collector');
 assert.equal(p.status,'trial');assert.ok(p.flagged>=2);
 assert.equal((await db.query("select count(*)::int n from work_tasks where kind='check_trial' and target=$1",['check:'+p.id])).rows[0].n,1);
 await c.runChecks(db,()=>{});assert.equal((await db.query("select count(*)::int n from work_tasks where kind='class_fields' and requested_by=$1",['check:'+p.id])).rows[0].n,0,'a check on trial creates no tasks');
 await assert.rejects(c.proposeCheck(db,{title:'bad',object:'class',kind:'class_fields',sql:'update entities set name=1',why:''},'agent:x'));
 await assert.rejects(c.proposeCheck(db,{title:'wrong kind',object:'page',kind:'class_fields',sql:'select slug target from topics',why:''},'agent:x'));
});

test('completeness: a member list counts as complete when two independent lists match it (≥90%); a specification when it declares enough fields with sources',async()=>{
 const c=await import(new URL('work-completeness.mjs',out));
 await db.query("insert into entity_types(type,label,plural,description,schema) values ('cp_x','Cp','Cps','',$1::jsonb) on conflict (type) do update set schema=excluded.schema",[JSON.stringify({kind:'class',metrics:[{key:'a',source:'S'}],attributes:[]})]);
 assert.equal((await c.universeVerdict(db,'cp_x')).complete,false);
 await c.recordUniverseCheck(db,{type:'cp_x',source:'Registry A',url:'',listed:100,matched:95,missingSample:'',by:'t'});
 const half=await c.recordUniverseCheck(db,{type:'cp_x',source:'Wikidata',url:'',listed:100,matched:60,missingSample:'x',by:'t'});
 assert.equal(half.complete,false);assert.match(half.problem,/Wikidata: 60 of 100/);
 const done=await c.recordUniverseCheck(db,{type:'cp_x',source:'wikidata',url:'',listed:100,matched:92,missingSample:'',by:'t'});
 assert.equal(done.complete,true);assert.equal(done.checks.length,2,'one check per source, the latest');
 await assert.rejects(c.recordUniverseCheck(db,{type:'cp_x',source:'B',url:'',listed:10,matched:11,missingSample:'',by:'t'}));
 const sp=await c.specVerdict(db,'cp_x');assert.equal(sp.complete,false);assert.match(sp.problem,/declares 1 measures/);
});
