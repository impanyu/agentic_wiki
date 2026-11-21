import {countryKey} from './world-codes';
import {fixAntimeridian} from './ranking-data';
// Geography for ranking maps, shared by the browser and the server (SVG): which map a ranking's
// entities belong to (world countries or U.S. states), the key of each entity on that map, and the
// boundaries as GeoJSON registered with ECharts. U.S. states use us-atlas's Albers USA projection
// (Alaska and Hawaii moved next to the lower 48), already projected to plane coordinates.
export type GeoKind='world'|'us';
// FIPS, postal code, name — the 50 states and the District of Columbia.
const US='01 AL Alabama|02 AK Alaska|04 AZ Arizona|05 AR Arkansas|06 CA California|08 CO Colorado|09 CT Connecticut|10 DE Delaware|11 DC District of Columbia|12 FL Florida|13 GA Georgia|15 HI Hawaii|16 ID Idaho|17 IL Illinois|18 IN Indiana|19 IA Iowa|20 KS Kansas|21 KY Kentucky|22 LA Louisiana|23 ME Maine|24 MD Maryland|25 MA Massachusetts|26 MI Michigan|27 MN Minnesota|28 MS Mississippi|29 MO Missouri|30 MT Montana|31 NE Nebraska|32 NV Nevada|33 NH New Hampshire|34 NJ New Jersey|35 NM New Mexico|36 NY New York|37 NC North Carolina|38 ND North Dakota|39 OH Ohio|40 OK Oklahoma|41 OR Oregon|42 PA Pennsylvania|44 RI Rhode Island|45 SC South Carolina|46 SD South Dakota|47 TN Tennessee|48 TX Texas|49 UT Utah|50 VT Vermont|51 VA Virginia|53 WA Washington|54 WV West Virginia|55 WI Wisconsin|56 WY Wyoming';
let usIndex:Map<string,string>|null=null;
const norm=(s:string)=>s.normalize('NFKD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/\(.*?\)/g,'').replace(/\b(state of|u\.?s\.? state)\b/g,'').replace(/[^a-z]/g,'');
export function usStateKey(code:unknown,name?:unknown):string|null{
 if(!usIndex){usIndex=new Map();for(const e of US.split('|')){const [fips,postal,...n]=e.split(' ');usIndex.set(fips,fips);usIndex.set(postal,fips);usIndex.set('US-'+postal,fips);usIndex.set(norm(n.join(' ')),fips);}
  usIndex.set('washingtondc',  '11');usIndex.set('districtofcolumbia','11');}
 for(const v of [code,name]){if(typeof v!=='string'&&typeof v!=='number')continue;const s=String(v).trim();if(!s)continue;
  const k=usIndex.get(s.toUpperCase())??usIndex.get(s.padStart(2,'0'))??usIndex.get(norm(s));if(k)return k;}
 return null;
}
type Keyed={code:string|null;name:string};
export function geoKeyOf(kind:GeoKind):(e:Keyed)=>string|null{
 return kind==='world'?e=>countryKey(e.code):e=>usStateKey(e.code,e.name);
}
// The map most of the entities sit on (≥60% matched, at least 3), or null.
export function geoKind(entries:Keyed[]):GeoKind|null{
 if(entries.length<3)return null;
 for(const kind of ['world','us'] as GeoKind[]){const key=geoKeyOf(kind);const n=entries.filter(e=>key(e)).length;if(n>=3&&n/entries.length>=.6)return kind;}
 return null;
}
export const GEO_MAP:Record<GeoKind,string>={world:'wiki-rank-world',us:'wiki-rank-us'};
export const GEO_ASPECT:Record<GeoKind,number>={world:2.28,us:1.6};
export type GeoData={kind:GeoKind;name:string;fc:{type:string;features:unknown[]};names:Map<string,string>};
const cache=new Map<GeoKind,Promise<GeoData>>();
export function loadGeo(kind:GeoKind):Promise<GeoData>{
 let p=cache.get(kind);
 if(!p){p=build(kind);cache.set(kind,p);p.catch(()=>cache.delete(kind));}
 return p;
}
async function build(kind:GeoKind):Promise<GeoData>{
 // @ts-ignore topojson-client ships no types
 const topo:any=await import('topojson-client');
 const feature=(topo.default??topo).feature;
 const names=new Map<string,string>();
 if(kind==='world'){
  const m:any=await import('world-atlas/countries-110m.json');const atlas=m.default??m;
  const fc=feature(atlas,atlas.objects.countries);
  fc.features=fc.features.filter((f:any)=>f.id!=='010').map((f:any)=>{
   const label=String(f.properties?.name??'');const key=f.id?String(f.id):label==='Kosovo'?'XKX':'x-'+label;names.set(key,label);
   return {...f,geometry:f.geometry&&fixAntimeridian(f.geometry),properties:{name:key}};});
  return {kind,name:GEO_MAP.world,fc,names};
 }
 // @ts-ignore json module
 const m:any=await import('us-atlas/states-albers-10m.json');const atlas=m.default??m;
 const fc=feature(atlas,atlas.objects.states);
 // Plane coordinates with y down → flip y so ECharts (which treats y as latitude) draws them upright.
 const flip=(c:any):any=>typeof c[0]==='number'?[c[0],-c[1]]:c.map(flip);
 fc.features=fc.features.map((f:any)=>{const key=String(f.id);names.set(key,String(f.properties?.name??key));
  return {...f,geometry:f.geometry&&{...f.geometry,coordinates:flip(f.geometry.coordinates)},properties:{name:key}};});
 return {kind,name:GEO_MAP.us,fc,names};
}
// Registers the map with an ECharts module once.
const registered=new WeakMap<object,Set<string>>();
export async function registerGeo(echarts:{registerMap:(name:string,geo:any)=>void},kind:GeoKind):Promise<GeoData>{
 const g=await loadGeo(kind);let set=registered.get(echarts);if(!set){set=new Set();registered.set(echarts,set);}
 if(!set.has(g.name)){echarts.registerMap(g.name,g.fc as any);set.add(g.name);}
 return g;
}
