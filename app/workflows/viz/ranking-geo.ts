import {countryKey} from './world-codes';
import {fixAntimeridian} from './ranking-data';
// Geography for maps, shared by the browser and the server (SVG). Two kinds of mappable entities:
// - regions, matched by code or name to boundaries: 'world' (countries, ISO 3166-1 codes),
//   'us' (U.S. states: name, postal code or FIPS), 'us-counties' (5-digit county FIPS);
// - 'points': anything with coordinates (cities, buildings, companies, universities, stores…), drawn
//   on the world map. Rows give lat/lon (lat|latitude, lon|lng|longitude) or "coordinates": "lat, lon".
//   'admin1:<ISO2>' — the first-level subdivisions (states, provinces, regions, prefectures…) of any
//   country, from Natural Earth (public/geo/admin1/<ISO2>.json, built by scripts/geo/build-admin1.mjs),
//   matched by ISO 3166-2 code ("CN-GD", "DE-BY", "JP-13"), or, once loaded, by English, Chinese or
//   other names and Wikidata QIDs;
// Boundaries are GeoJSON registered with ECharts. U.S. maps use us-atlas's Albers USA projection
// (Alaska and Hawaii moved next to the lower 48), already projected to plane coordinates.
export type RegionKind='world'|'us'|'us-counties'|`admin1:${string}`;
export type GeoKind=RegionKind|'points';
// Where geometry files are read from: fetch in the browser; the server reads public/ from disk.
let fetchJson:(path:string)=>Promise<any>=path=>fetch(path).then(r=>{if(!r.ok)throw Error('Map data unavailable ('+r.status+').');return r.json();});
export function setGeoFetcher(f:(path:string)=>Promise<any>){fetchJson=f;}
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
type Keyed={code:string|null;name:string;row?:Record<string,unknown>};
// Names compared loosely across scripts: accents, case, punctuation and generic words ignored.
const SUFFIX=/\b(province|prefecture|state|region|oblast|krai|governorate|department|county|district|autonomous|municipality|metropolitan|city|of)\b|(省|市|自治区|特别行政区|壮族|回族|维吾尔|県|府|都|道)/gu;
export const looseName=(s:string)=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(SUFFIX,'').replace(/[^\p{L}\p{N}]/gu,'');
const ISO2_SUB=/^([A-Z]{2})-[A-Z0-9]{1,3}$/;
const isKind=(k:unknown):k is GeoKind=>k==='world'||k==='us'||k==='us-counties'||k==='points'||typeof k==='string'&&/^admin1:[A-Z]{2}$/.test(k);
const countyKey=(code:unknown)=>{const s=typeof code==='number'?String(code).padStart(5,'0'):typeof code==='string'?code.trim():'';const m=/^(?:US-?)?(\d{5})$/.exec(s);return m?m[1]:null;};
const num=(v:unknown)=>{const n=typeof v==='number'?v:typeof v==='string'&&v.trim()?Number(v):NaN;return Number.isFinite(n)?n:null;};
// [lon, lat] of a row, or null.
export function pointOf(row:Record<string,unknown>|undefined):[number,number]|null{
 if(!row)return null;
 let lat=num(row.lat??row.latitude),lon=num(row.lon??row.lng??row.longitude);
 if((lat==null||lon==null)&&typeof row.coordinates==='string'){const m=/^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(row.coordinates);if(m){lat=Number(m[1]);lon=Number(m[2]);}}
 return lat!=null&&lon!=null&&Math.abs(lat)<=90&&Math.abs(lon)<=180?[lon,lat]:null;
}
// The key of an entity on a map. For admin1 maps, data (once loaded) adds name and Wikidata matches.
export function geoKeyOf(kind:GeoKind,data?:GeoData|null):(e:Keyed)=>string|null{
 if(kind.startsWith('admin1:')){
  const cc=kind.slice(7),lookup=data?.kind===kind?data.lookup:undefined;
  return e=>{const code=typeof e.code==='string'?e.code.trim().toUpperCase():'';
   if(ISO2_SUB.test(code)&&code.startsWith(cc+'-'))return lookup?.get(code)??code;
   if(!lookup)return null;
   const wd=e.row?.wikidata??e.row?.qid;if(typeof wd==='string'&&lookup.has(wd.toUpperCase()))return lookup.get(wd.toUpperCase())!;
   return lookup.get(looseName(e.name))??null;};
 }
 if(kind==='world')return e=>countryKey(e.code);
 if(kind==='us')return e=>usStateKey(e.code,e.name);
 if(kind==='us-counties')return e=>countyKey(e.code);
 return e=>pointOf(e.row)?e.name:null;
}
// The map most of the entities sit on (≥60% matched, at least 3), or null. Regions win over points.
// hint: a map named by the template ("admin1:JP", "points"…) — needed for subdivisions given by name only.
export function geoKind(entries:Keyed[],hint?:unknown):GeoKind|null{
 if(isKind(hint))return hint==='admin1:US'?'us':hint;
 if(entries.length<3)return null;
 const share=(n:number)=>n>=3&&n/entries.length>=.6;
 for(const kind of ['world','us','us-counties'] as GeoKind[]){const key=geoKeyOf(kind);if(share(entries.filter(e=>key(e)).length))return kind;}
 // ISO 3166-2 codes of one country → that country's subdivisions.
 const by=new Map<string,number>();for(const e of entries){const m=ISO2_SUB.exec(String(e.code??'').trim().toUpperCase());if(m)by.set(m[1],(by.get(m[1])??0)+1);}
 const top=[...by].sort((a,b)=>b[1]-a[1])[0];if(top&&share(top[1]))return top[0]==='US'?'us':`admin1:${top[0]}`;
 if(share(entries.filter(e=>pointOf(e.row)).length))return 'points';
 return null;
}
// The boundaries a kind draws on (points sit on the world map).
export const baseRegion=(kind:GeoKind):RegionKind=>kind==='points'?'world':kind;
export const GEO_MAP:Record<'world'|'us'|'us-counties',string>={world:'wiki-rank-world',us:'wiki-rank-us','us-counties':'wiki-rank-us-counties'};
export const geoMapName=(kind:RegionKind)=>kind.startsWith('admin1:')?'wiki-rank-'+kind.replace(':','-'):GEO_MAP[kind as keyof typeof GEO_MAP];
export const GEO_ASPECT:Record<'world'|'us'|'us-counties'|'points',number>={world:2.28,us:1.6,'us-counties':1.6,points:2.28};
// Width ÷ height of a map's drawing.
export const geoAspect=(kind:GeoKind,data?:GeoData|null)=>kind.startsWith('admin1:')?(data?.kind===kind?data.aspect:1.4):GEO_ASPECT[kind as keyof typeof GEO_ASPECT];
// aspectScale: for unprojected lon/lat maps (subdivisions), cos(latitude) so shapes are not stretched.
// lookup: code, Wikidata QID and loose names → feature key (admin1).
export type GeoData={kind:RegionKind;name:string;fc:{type:string;features:unknown[]};names:Map<string,string>;aspect:number;aspectScale?:number;lookup?:Map<string,string>};
const cache=new Map<RegionKind,Promise<GeoData>>();
export function loadGeo(kind:RegionKind):Promise<GeoData>{
 let p=cache.get(kind);
 if(!p){p=build(kind);cache.set(kind,p);p.catch(()=>cache.delete(kind));}
 return p;
}
async function build(kind:RegionKind):Promise<GeoData>{
 // @ts-ignore topojson-client ships no types
 const topo:any=await import('topojson-client');
 const feature=(topo.default??topo).feature;
 const names=new Map<string,string>();
 if(kind.startsWith('admin1:')){
  const cc=kind.slice(7);if(!/^[A-Z]{2}$/.test(cc))throw Error('Unknown country '+cc+'.');
  const t=await fetchJson('/geo/admin1/'+cc+'.json');const fc=feature(t,t.objects.a);
  const lookup=new Map<string,string>();let x0=180,x1=-180,y0=90,y1=-90;
  const walk=(c:any)=>{if(typeof c[0]==='number'){x0=Math.min(x0,c[0]);x1=Math.max(x1,c[0]);y0=Math.min(y0,c[1]);y1=Math.max(y1,c[1]);}else c.forEach(walk);};
  fc.features=fc.features.map((f:any)=>{const p=f.properties||{};const key=String(p.id||f.id);names.set(key,String(p.name||key));
   lookup.set(key.toUpperCase(),key);if(p.wd)lookup.set(String(p.wd).toUpperCase(),key);
   for(const n of [p.name,p.zh,...(p.alt||[])])if(n){const k=looseName(n);if(k&&!lookup.has(k))lookup.set(k,key);}
   const geometry=f.geometry&&fixAntimeridian(f.geometry);if(geometry)walk(geometry.coordinates);
   return {...f,geometry,properties:{name:key}};});
  const scale=Math.cos(((y0+y1)/2)*Math.PI/180)||1;
  const aspect=Math.max(.6,Math.min(3,((x1-x0)*scale)/Math.max(1e-6,y1-y0)));
  return {kind,name:geoMapName(kind),fc,names,aspect,aspectScale:scale,lookup};
 }
 if(kind==='world'){
  const m:any=await import('world-atlas/countries-110m.json');const atlas=m.default??m;
  const fc=feature(atlas,atlas.objects.countries);
  fc.features=fc.features.filter((f:any)=>f.id!=='010').map((f:any)=>{
   const label=String(f.properties?.name??'');const key=f.id?String(f.id):label==='Kosovo'?'XKX':'x-'+label;names.set(key,label);
   return {...f,geometry:f.geometry&&fixAntimeridian(f.geometry),properties:{name:key}};});
  return {kind,name:GEO_MAP.world,fc,names,aspect:GEO_ASPECT.world};
 }
 // @ts-ignore json module
 const m:any=kind==='us'?await import('us-atlas/states-albers-10m.json'):await import('us-atlas/counties-albers-10m.json');const atlas=m.default??m;
 const fc=feature(atlas,kind==='us'?atlas.objects.states:atlas.objects.counties);
 // Plane coordinates with y down → flip y so ECharts (which treats y as latitude) draws them upright.
 const flip=(c:any):any=>typeof c[0]==='number'?[c[0],-c[1]]:c.map(flip);
 fc.features=fc.features.map((f:any)=>{const key=String(f.id);names.set(key,String(f.properties?.name??key));
  return {...f,geometry:f.geometry&&{...f.geometry,coordinates:flip(f.geometry.coordinates)},properties:{name:key}};});
 return {kind,name:geoMapName(kind),fc,names,aspect:GEO_ASPECT[kind as 'us']};
}
// Registers the map with an ECharts module once.
const registered=new WeakMap<object,Set<string>>();
export async function registerGeo(echarts:{registerMap:(name:string,geo:any)=>void},kind:GeoKind):Promise<GeoData>{
 const g=await loadGeo(baseRegion(kind));let set=registered.get(echarts);if(!set){set=new Set();registered.set(echarts,set);}
 if(!set.has(g.name)){echarts.registerMap(g.name,g.fc as any);set.add(g.name);}
 return g;
}
