// Builds public/geo/admin1/<ISO2>.json: first-level subdivisions (states, provinces, regions…) of every
// country as simplified TopoJSON, from Natural Earth's 1:10m "admin 1 – states, provinces" (public domain,
// https://github.com/nvkelso/natural-earth-vector, geojson/ne_10m_admin_1_states_provinces.geojson).
// Each feature keeps: id (ISO 3166-2, e.g. "CN-GD"), name (English), zh (Chinese), alt (other names),
// wd (Wikidata QID), postal. Usage: node scripts/geo/build-admin1.mjs <admin1.geojson>
import {readFileSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {topology} from 'topojson-server';
import {presimplify,simplify,quantile} from 'topojson-simplify';
import {quantize} from 'topojson-client';
const src=process.argv[2];if(!src){console.error('Usage: node scripts/geo/build-admin1.mjs <ne_10m_admin_1_states_provinces.geojson>');process.exit(1);}
const out=new URL('../../public/geo/admin1/',import.meta.url);
rmSync(out,{recursive:true,force:true});mkdirSync(out,{recursive:true});
const BUDGET=160_000;// bytes per country file
const fc=JSON.parse(readFileSync(src,'utf8'));
const by=new Map();
for(const f of fc.features){
 const p=f.properties||{};const iso=(p.iso_a2&&p.iso_a2!=='-99'?p.iso_a2:(p.iso_3166_2||'').split('-')[0]||'').toUpperCase();
 if(!/^[A-Z]{2}$/.test(iso)||!f.geometry)continue;
 const id=p.iso_3166_2&&!/-$/.test(p.iso_3166_2)?p.iso_3166_2:p.adm1_code;
 const alt=[p.name,p.name_local,p.gn_name,p.woe_name,...String(p.name_alt||'').split('|')].map(s=>String(s||'').trim()).filter((s,i,a)=>s&&s!==(p.name_en||p.name)&&a.indexOf(s)===i);
 const props={id,name:p.name_en||p.name,zh:p.name_zh||undefined,alt:alt.length?alt:undefined,wd:p.wikidataid||undefined,postal:p.postal||undefined};
 if(!by.has(iso))by.set(iso,{admin:p.admin,features:[]});
 by.get(iso).features.push({type:'Feature',id,properties:props,geometry:f.geometry});
}
const index={};let total=0;
for(const [iso,{admin,features}] of [...by].sort()){
 const t0=topology({a:{type:'FeatureCollection',features}},1e5);
 const pre=presimplify(t0);let text='';
 // Keep the largest share of points that fits the budget (quantile p = the fraction of points kept), then
 // quantize again: simplification returns full-precision coordinates.
 for(const p of [0.5,0.35,0.25,0.18,0.12,0.08,0.05,0.03,0.02,0.01]){text=JSON.stringify(quantize(simplify(pre,quantile(pre,p)),1e4));if(text.length<=BUDGET)break;}
 writeFileSync(new URL(iso+'.json',out),text);total+=text.length;
 index[iso]={name:admin,count:features.length};
}
writeFileSync(new URL('index.json',out),JSON.stringify(index));
console.log(Object.keys(index).length+' countries, '+fc.features.length+' subdivisions, '+(total/1e6).toFixed(1)+' MB');
