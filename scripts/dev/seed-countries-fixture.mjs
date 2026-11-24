// Development fixture for the database-driven pages (/rankings/<slug>, /e/<type>/<slug>): a dozen countries
// with five metrics over 2019–2023, regions, capitals, the "country" entity-type template and two ranking
// definitions. The numbers are rounded approximations for development only — not data to publish.
//
//   node scripts/dev/seed-countries-fixture.mjs            # writes to $DATA_DIR/entity-db (default ./data/entity-db) or ENTITY_DB_URL
//   node scripts/dev/seed-countries-fixture.mjs --memory   # dry run against an in-memory PGlite
//
// PGlite is single-process: run this while no other process (the dev server) has the local entity DB open,
// i.e. before the first request that touches it, or with the dev server stopped. Re-running is idempotent.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import ts from 'typescript';

const out=new URL('../../node_modules/.cache/entity-db-seed/',import.meta.url);mkdirSync(out,{recursive:true});
for(const f of ['client','schema','metrics','embeddings','units','reserved','repo','inherit','dedup']){
 let js=ts.transpileModule(readFileSync(new URL(`../../app/entity-db/${f}.ts`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 js=js.replace(/(from\s*|import\()\s*(['"])([^'"]+)\2/g,(m,pre,q,spec)=>spec.startsWith('./')?`${pre}'${spec}.mjs'`:m);
 writeFileSync(new URL(f+'.mjs',out),js);
}
const client=await import(new URL('client.mjs',out));
const repo=await import(new URL('repo.mjs',out));

export const YEARS=['2019','2020','2021','2022','2023'];
// name, iso3, region, capital, area km², [population 2019→2023 in millions], [GDP 2019→2023 in billion USD], [life expectancy 2019→2023]
export const COUNTRIES=[
 ['India','IND','South Asia','New Delhi',3287263,[1383,1396,1408,1417,1429],[2836,2672,3150,3390,3550],[70.9,70.2,67.2,68.0,70.4]],
 ['China','CHN','East Asia & Pacific','Beijing',9596961,[1407,1411,1412,1412,1410],[14280,14690,17820,17880,17790],[77.9,78.1,78.2,78.6,78.0]],
 ['United States','USA','North America','Washington, D.C.',9833517,[328,331,332,333,335],[21380,21060,23320,25440,27360],[78.8,77.0,76.4,77.4,78.4]],
 ['Indonesia','IDN','East Asia & Pacific','Jakarta',1904569,[270,273,275,276,278],[1119,1059,1186,1319,1371],[70.5,69.6,67.6,68.3,71.0]],
 ['Brazil','BRA','Latin America & Caribbean','Brasília',8515767,[211,213,214,215,216],[1873,1476,1670,1920,2174],[75.3,74.0,72.8,73.4,75.8]],
 ['Nigeria','NGA','Sub-Saharan Africa','Abuja',923768,[203,208,213,218,223],[448,432,441,477,363],[52.9,52.7,52.7,53.6,54.5]],
 ['Japan','JPN','East Asia & Pacific','Tokyo',377975,[126.6,126.3,125.7,125.1,124.5],[5118,5055,5034,4256,4213],[84.4,84.6,84.4,84.0,84.7]],
 ['Germany','DEU','Europe & Central Asia','Berlin',357588,[83.1,83.2,83.2,83.8,84.5],[3889,3887,4278,4082,4456],[81.3,81.0,80.9,80.7,81.2]],
 ['France','FRA','Europe & Central Asia','Paris',551695,[67.4,67.6,67.8,68.0,68.2],[2729,2647,2960,2780,3031],[82.8,82.2,82.3,82.3,83.1]],
 ['United Kingdom','GBR','Europe & Central Asia','London',243610,[66.8,67.1,67.0,67.6,68.3],[2857,2704,3123,3089,3340],[81.4,80.4,80.7,81.0,81.3]],
 ['Italy','ITA','Europe & Central Asia','Rome',302068,[59.7,59.4,59.1,59.0,59.0],[2012,1897,2155,2066,2255],[83.5,82.2,82.9,83.0,83.7]],
 ['Iceland','ISL','Europe & Central Asia','Reykjavík',103000,[0.361,0.366,0.372,0.383,0.393],[24.7,21.6,25.6,28.1,31.0],[83.2,83.1,83.2,82.1,82.7]],
];
const SRC={population:'World Bank WDI SP.POP.TOTL',gdp_usd:'World Bank WDI NY.GDP.MKTP.CD',life_expectancy:'World Bank WDI SP.DYN.LE00.IN',area_km2:'World Bank WDI AG.SRF.TOTL.K2',gdp_per_capita_usd:'derived from World Bank WDI (GDP ÷ population)'};
const METRICS=[
 {key:'population',label:'Population',unit:'people',order:'desc',format:'compact',description:'Total population, mid-year.'},
 {key:'gdp_usd',label:'GDP',unit:'USD',order:'desc',format:'currency',description:'Gross domestic product, current US dollars.'},
 {key:'gdp_per_capita_usd',label:'GDP per capita',unit:'USD',order:'desc',format:'currency',description:'GDP divided by mid-year population, current US dollars.'},
 {key:'area_km2',label:'Area',unit:'km²',order:'desc',format:'number',description:'Total surface area.'},
 {key:'life_expectancy',label:'Life expectancy',unit:'years',order:'desc',format:'decimal',description:'Life expectancy at birth, total.'},
];
export const TEMPLATE={
 lead:[
  '{name} is a {type.label} in {attr.region} with a population of {metric.population} ({period.population}).',
  'It ranks {rank.population} of {of.population} by population and {rank.gdp_usd} by GDP.',
 ],
 card:['population','gdp_usd','gdp_per_capita_usd','area_km2','life_expectancy','rel.capital','attr.region'],
 sections:[
  {kind:'trend',title:'Population',metrics:['population']},
  {kind:'trend',title:'Economy',metrics:['gdp_usd','gdp_per_capita_usd']},
  {kind:'position',metric:'gdp_per_capita_usd'},
  {kind:'peer_compare',metric:'population'},
  {kind:'radar_profile',metrics:['gdp_per_capita_usd','life_expectancy','population','area_km2']},
  {kind:'location_map'},
  {kind:'relations'},
  {kind:'rankings'},
  {kind:'text',title:'Economy',sentences:["{name}'s GDP was {metric.gdp_usd} in {period.gdp_usd}, {change.gdp_usd} on the year before.","Its GDP per capita was {metric.gdp_per_capita_usd}, {rank.gdp_per_capita_usd} of {of.gdp_per_capita_usd}."]},
 ],
};
export const SCHEMA={identity:{ids:['iso3','wikidata'],match:'Rows merge on any shared id, else same type and name/alias.'},
 metrics:METRICS.map(m=>({...m,source:SRC[m.key],history:m.key!=='area_km2'})),attributes:['region','capital'],
 relations:[{predicate:'capital',type:'city'},{predicate:'part_of',type:'region'}],universe:{source:'World Bank country list (excludes aggregates)',expected:217}};
export const RANKINGS=[
 {slug:'country-rankings',title:'Country Rankings',scope:{type:'country',filters:{}},criteria:['population','gdp_usd','gdp_per_capita_usd','area_km2','life_expectancy'],status:'published',
  config:{default:'population',views:'auto',period:'all',group:'region',lead:'All {count} {type.plural}, ranked by {criteria} ({source}).',
   about:['Scope: every country in the World Bank list ({count} of {expected}).'],related:['countries-in-europe-and-central-asia-rankings']}},
 {slug:'countries-in-europe-and-central-asia-rankings',title:'Countries in Europe & Central Asia',scope:{type:'country',filters:{region:'Europe & Central Asia'}},criteria:['gdp_per_capita_usd','population','life_expectancy'],status:'draft',
  config:{default:'gdp_per_capita_usd',period:'all',lead:'{count} {type.plural} in Europe & Central Asia, ranked by {criteria}.',related:['country-rankings']}},
];

export async function seed(db){
 for(const m of METRICS)await repo.defineMetric(db,m);
 const obs=[],rels=[];const ids=new Map();
 for(const [name,iso3,region,capital,area,pop,gdp,life] of COUNTRIES){
  const {id}=await db.tx(q=>repo.upsertEntity(q,{type:'country',name,ids:{iso3},attributes:{region,capital}}));ids.set(name,id);
  const cap=await db.tx(q=>repo.upsertEntity(q,{type:'city',name:capital,attributes:{country:name}}));
  const reg=await db.tx(q=>repo.upsertEntity(q,{type:'region',name:region}));
  rels.push({subjectId:id,predicate:'capital',objectId:cap.id,source:'Wikidata P36'},{subjectId:id,predicate:'part_of',objectId:reg.id,source:'World Bank country classification'});
  obs.push({entityId:id,metric:'area_km2',value:area,period:'2022',source:SRC.area_km2});
  YEARS.forEach((y,i)=>{
   const p=Math.round(pop[i]*1e6),g=Math.round(gdp[i]*1e9);
   obs.push({entityId:id,metric:'population',value:p,period:y,source:SRC.population},{entityId:id,metric:'gdp_usd',value:g,period:y,source:SRC.gdp_usd},
    {entityId:id,metric:'gdp_per_capita_usd',value:Math.round(g/p),period:y,source:SRC.gdp_per_capita_usd},{entityId:id,metric:'life_expectancy',value:life[i],period:y,source:SRC.life_expectancy});
  });
 }
 await repo.recordObservations(db,obs);
 await repo.recordRelations(db,rels);
 await db.query(`insert into entity_types(type,label,plural,description,schema,template,status,updated_by) values ('country','country','countries','Sovereign states in the World Bank country list.',$1::jsonb,$2::jsonb,'published','fixture')
  on conflict (type) do update set label=excluded.label, plural=excluded.plural, description=excluded.description, schema=excluded.schema, template=excluded.template, status=excluded.status, updated_at=now()`,[JSON.stringify(SCHEMA),JSON.stringify(TEMPLATE)]);
 await db.query(`insert into entity_types(type,label,plural) values ('city','city','cities'),('region','region','regions') on conflict (type) do nothing`);
 for(const r of RANKINGS){
  const ex=(await db.query('select id from rankings where slug = $1::text',[r.slug])).rows[0];
  if(ex)await db.query('update rankings set title=$2::text, scope=$3::jsonb, criteria=$4::text[], config=$5::jsonb, status=$6::text, updated_at=now() where id=$1::uuid',[ex.id,r.title,JSON.stringify(r.scope),r.criteria,JSON.stringify(r.config),r.status]);
  else await db.query('insert into rankings(slug,title,scope,criteria,config,status) values ($1::text,$2::text,$3::jsonb,$4::text[],$5::jsonb,$6::text)',[r.slug,r.title,JSON.stringify(r.scope),r.criteria,JSON.stringify(r.config),r.status]);
 }
 // The topic tree: Geography › Countries, owning the country type and its rankings.
 const geo=await repo.getTopic(db,'geography')??await repo.createTopic(db,{slug:'geography',name:'Geography',description:'Places of the world.'});
 const countries=await repo.getTopic(db,'countries')??await repo.createTopic(db,{slug:'countries',name:'Countries',description:'Sovereign states compared.',parentId:geo.id});
 await db.query("update entity_types set topic_id=$1::uuid where type='country'",[countries.id]);
 await db.query('update rankings set topic_id=$1::uuid where slug is not null',[countries.id]);
 // The template is in place now: decide which entities get a page.
 await repo.refreshPages(db);
 return {countries:ids.size,observations:obs.length,relations:rels.length};
}

if(import.meta.url===`file://${process.argv[1]}`){
 const memory=process.argv.includes('--memory');
 const db=await client.createEntityDb(memory?{memory:true}:{});
 try{console.log(db.kind,memory?'(memory)':process.env.ENTITY_DB_URL?'ENTITY_DB_URL':(process.env.DATA_DIR||'./data')+'/entity-db',await seed(db));}
 finally{await db.close();}
}
