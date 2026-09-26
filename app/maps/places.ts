import {z} from 'zod';
// Built-in place search and reverse geocoding for every agent and app backend (public data,
// no user account). Uses Google (Places API New / Geocoding) when the platform has
// GOOGLE_MAPS_API_KEY, otherwise OpenStreetMap Nominatim (keyless, 1 request/second policy).
// Every result carries a Google Maps link that pages and apps can embed as a map.
export type Place={name:string;address:string;lat:number;lng:number;types?:string[];rating?:number;mapsUrl:string;source:'google'|'openstreetmap'};
const mapsUrl=(lat:number,lng:number,label:string)=>'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(label||`${lat},${lng}`);
const timeout=(signal?:AbortSignal)=>signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000);
const osmHeaders={'User-Agent':'AgenticWiKi/1.0 (https://wiki.aisoup.net)','Accept-Language':'en,zh;q=0.8'};
let lastOsm=0;
async function osm(path:string,params:Record<string,string>,signal?:AbortSignal){
 const wait=lastOsm+1100-Date.now();if(wait>0)await new Promise(r=>setTimeout(r,wait));lastOsm=Date.now();
 const r=await fetch('https://nominatim.openstreetmap.org/'+path+'?'+new URLSearchParams({format:'jsonv2',addressdetails:'0',...params}),{headers:osmHeaders,signal:timeout(signal)});
 if(!r.ok)throw Error('OpenStreetMap search failed (HTTP '+r.status+').');return r.json() as Promise<any>;
}
export const placeQuery=z.object({query:z.string().min(1).max(300),max:z.number().int().min(1).max(20).optional()});
export async function findPlaces(raw:unknown,signal?:AbortSignal):Promise<{places:Place[];source:string}>{
 const {query,max=8}=placeQuery.parse(raw),key=process.env.GOOGLE_MAPS_API_KEY;
 if(key){
  const r=await fetch('https://places.googleapis.com/v1/places:searchText',{method:'POST',headers:{'Content-Type':'application/json','X-Goog-Api-Key':key,'X-Goog-FieldMask':'places.displayName,places.formattedAddress,places.location,places.rating,places.types,places.googleMapsUri'},body:JSON.stringify({textQuery:query,pageSize:max}),signal:timeout(signal)});
  const d=await r.json().catch(()=>({})) as any;
  if(r.ok)return {source:'google',places:(d.places||[]).map((p:any)=>({name:p.displayName?.text||'',address:p.formattedAddress||'',lat:p.location?.latitude,lng:p.location?.longitude,types:p.types,rating:p.rating,mapsUrl:p.googleMapsUri||mapsUrl(p.location?.latitude,p.location?.longitude,(p.displayName?.text||'')+' '+(p.formattedAddress||'')),source:'google' as const}))};
 }
 const rows=await osm('search',{q:query,limit:String(max)},signal) as any[];
 return {source:'openstreetmap',places:rows.map(r=>{const lat=Number(r.lat),lng=Number(r.lon),name=r.name||String(r.display_name||'').split(',')[0];return {name,address:r.display_name||'',lat,lng,types:[r.category,r.type].filter(Boolean),mapsUrl:mapsUrl(lat,lng,r.display_name||name),source:'openstreetmap' as const};})};
}
export async function reverseGeocode(raw:unknown,signal?:AbortSignal):Promise<{address:string;lat:number;lng:number;mapsUrl:string;source:string}>{
 const {lat,lng}=z.object({lat:z.number().min(-90).max(90),lng:z.number().min(-180).max(180)}).parse(raw),key=process.env.GOOGLE_MAPS_API_KEY;
 if(key){const r=await fetch('https://maps.googleapis.com/maps/api/geocode/json?'+new URLSearchParams({latlng:`${lat},${lng}`,key}),{signal:timeout(signal)});const d=await r.json().catch(()=>({})) as any;const address=d.results?.[0]?.formatted_address;if(r.ok&&address)return {address,lat,lng,mapsUrl:mapsUrl(lat,lng,address),source:'google'};}
 const d=await osm('reverse',{lat:String(lat),lon:String(lng)},signal);
 return {address:d.display_name||`${lat}, ${lng}`,lat,lng,mapsUrl:'https://www.google.com/maps/@'+lat+','+lng+',14z',source:'openstreetmap'};
}
