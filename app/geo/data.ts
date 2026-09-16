import {parse} from 'csv-parse/browser/esm/sync';
export type GeoFeature={type:'Feature';geometry:{type:string;coordinates:unknown};properties:Record<string,unknown>};
export type GeoCollection={type:'FeatureCollection';features:GeoFeature[]};
const supported=new Set(['Point','MultiPoint','LineString','MultiLineString','Polygon','MultiPolygon']);
export function normalizeGeoJSON(raw:any):GeoCollection{
 if(raw?.crs&&!/4326|CRS84/i.test(JSON.stringify(raw.crs)))throw Error('Reproject this dataset to WGS84 (EPSG:4326) before opening it.');
 const input=raw?.type==='FeatureCollection'?raw.features:raw?.type==='Feature'?[raw]:supported.has(raw?.type)?[{type:'Feature',geometry:raw,properties:{}}]:null;
 if(!Array.isArray(input)||!input.length)throw Error('No GeoJSON features found. JSON must contain GeoJSON geometry.');if(input.length>10000)throw Error('Choose a dataset with at most 10,000 features.');
 let positions=0;
 const coords=(value:any,depth=0):void=>{if(depth>6||!Array.isArray(value)||!value.length)throw Error('Invalid geometry coordinates.');if(typeof value[0]==='number'){if(++positions>200000)throw Error('Dataset exceeds 200,000 coordinates.');if(value.length<2||!value.every((v:unknown)=>typeof v==='number'&&Number.isFinite(v))||Math.abs(value[0])>180||Math.abs(value[1])>90)throw Error('Coordinates must be WGS84 longitude, latitude.');}else value.forEach(v=>coords(v,depth+1));};
 const features:GeoFeature[]=input.filter(f=>f?.geometry!==null).map((f:any)=>{if(f?.type!=='Feature'||!supported.has(f.geometry?.type))throw Error('Unsupported GeoJSON geometry. Use points, lines or polygons.');coords(f.geometry.coordinates);return {type:'Feature',geometry:{type:f.geometry.type,coordinates:f.geometry.coordinates},properties:Object.fromEntries(Object.entries(f.properties||{}).slice(0,100).map(([k,v])=>[k.slice(0,100),typeof v==='number'||typeof v==='boolean'||v===null?v:String(typeof v==='object'?JSON.stringify(v):v).slice(0,4000)]))};});
 if(!features.length)throw Error('No features with geometry were found.');return {type:'FeatureCollection',features};
}
export function csvGeoJSON(text:string):GeoCollection{
 const rows=parse(text,{columns:true,bom:true,skip_empty_lines:true,relax_column_count:false,max_record_size:100000,delimiter:text.split(/\r?\n/)[0].includes('\t')?'\t':','}) as Record<string,string>[];
 if(!rows.length)throw Error('CSV has no data rows.');const names=Object.keys(rows[0]),lat=names.find(k=>/^(lat|latitude|y)$/i.test(k.trim())),lon=names.find(k=>/^(lon|lng|long|longitude|x)$/i.test(k.trim()));
 if(!lat||!lon)throw Error('CSV needs latitude and longitude columns (lat/lon or y/x).');
 return normalizeGeoJSON({type:'FeatureCollection',features:rows.map((r,i)=>{if(!r[lat]?.trim()||!r[lon]?.trim())throw Error('Missing coordinates in CSV row '+(i+2));return {type:'Feature',properties:r,geometry:{type:'Point',coordinates:[Number(r[lon]),Number(r[lat])]}};})});
}
export function xmlGeoJSON(text:string,kind:'kml'|'gpx'):GeoCollection{
 if(/<!DOCTYPE|<!ENTITY/i.test(text))throw Error('XML document types and entities are not supported.');
 const doc=new DOMParser().parseFromString(text,'application/xml');if(doc.getElementsByTagName('parsererror').length)throw Error('Invalid XML file.');const features:any[]=[];
 const descendants=(el:Document|Element,name:string)=>Array.from(el.getElementsByTagNameNS('*',name));
 const add=(type:string,coordinates:unknown,properties:Record<string,unknown>)=>features.push({type:'Feature',geometry:{type,coordinates},properties});
 if(kind==='gpx'){
  const point=(p:Element)=>{if(!p.hasAttribute('lon')||!p.hasAttribute('lat'))throw Error('GPX point has no coordinates.');return [Number(p.getAttribute('lon')),Number(p.getAttribute('lat'))];};
  descendants(doc,'wpt').forEach(p=>add('Point',point(p),{name:descendants(p,'name')[0]?.textContent||''}));
  for(const seg of [...descendants(doc,'trkseg'),...descendants(doc,'rte')]){const points=[...descendants(seg,'trkpt'),...descendants(seg,'rtept')].map(point);if(points.length>1)add('LineString',points,{name:descendants(seg.parentElement||seg,'name')[0]?.textContent||''});}
 }else{
  const coordinates=(el:Element)=>{const text=descendants(el,'coordinates')[0]?.textContent?.trim();if(!text)throw Error('KML geometry has no coordinates.');return text.split(/\s+/).map(s=>s.split(',').map(Number));};
  for(const mark of descendants(doc,'Placemark')){const props={name:descendants(mark,'name')[0]?.textContent||'',description:descendants(mark,'description')[0]?.textContent||''};for(const point of descendants(mark,'Point'))add('Point',coordinates(point)[0],props);for(const line of descendants(mark,'LineString'))add('LineString',coordinates(line),props);for(const polygon of descendants(mark,'Polygon'))add('Polygon',descendants(polygon,'LinearRing').map(coordinates),props);}
 }
 return normalizeGeoJSON({type:'FeatureCollection',features});
}
export function parseGeoFile(name:string,text:string){if(new TextEncoder().encode(text).length>10*1024*1024)throw Error('Choose a file up to 10 MB.');const ext=name.split('.').at(-1)?.toLowerCase();return ext==='csv'||ext==='tsv'?csvGeoJSON(text):ext==='kml'||ext==='gpx'?xmlGeoJSON(text,ext):normalizeGeoJSON(JSON.parse(text));}
export function publicLayerUrl(value:string){const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443'||!u.hostname.includes('.')||/^(localhost|127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname)||/\.(local|internal|localhost)$/.test(u.hostname)||u.hostname.includes(':')||[...u.searchParams.keys()].some(k=>/token|api.?key|secret|password/i.test(k)))throw Error('Use a public HTTPS data URL without credentials.');return u.href;}
