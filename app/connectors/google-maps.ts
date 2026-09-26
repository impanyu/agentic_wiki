import {z} from 'zod';
import type {RemoteTool} from './contracts';

// Google Maps Platform connector: geocoding and place search with the user's own API key
// (restricted to the Geocoding API, Places API (New) and Maps Embed API). Maps in pages and
// apps are embedded through /api/maps/embed, which adds the page owner's key server side.
const str={type:'string'},numProp={type:'number'};
const tool=(name:string,description:string,properties:Record<string,unknown>,required:string[]=[]):RemoteTool=>({name,description,inputSchema:{type:'object',properties,required,additionalProperties:false},annotations:{readOnlyHint:true}});
export const googleMapsTools:RemoteTool[]=[
 tool('geocode','Find coordinates for an address or place name. Returns formatted addresses, lat/lng, place IDs and a Google Maps link.',{address:str},['address']),
 tool('reverse_geocode','Find the address at a latitude/longitude.',{lat:numProp,lng:numProp},['lat','lng']),
 tool('search_places','Search places by text (for example "coffee near Lincoln, Nebraska"). Returns names, addresses, lat/lng, ratings, types and Google Maps links. max is 1-20.',{query:str,max:{type:'integer'}},['query']),
];
const mapsLink=(q:string)=>'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(q);
async function get(url:string,signal?:AbortSignal){const r=await fetch(url,{signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)});const d=await r.json().catch(()=>({})) as any;if(!r.ok||d.status==='REQUEST_DENIED'||d.error)throw Error('Google Maps: '+(d.error_message||d.error?.message||d.status||('HTTP '+r.status)));return d;}
export async function executeGoogleMaps(key:string,name:string,raw:unknown,signal?:AbortSignal){
 if(name==='geocode'||name==='reverse_geocode'){
  const s=new URLSearchParams({key});
  if(name==='geocode'){const a=z.object({address:z.string().min(1).max(300)}).strict().parse(raw);s.set('address',a.address);}
  else{const a=z.object({lat:z.number().min(-90).max(90),lng:z.number().min(-180).max(180)}).strict().parse(raw);s.set('latlng',a.lat+','+a.lng);}
  const d=await get('https://maps.googleapis.com/maps/api/geocode/json?'+s,signal);
  if(d.status!=='OK'&&d.status!=='ZERO_RESULTS')throw Error('Google Maps geocoding: '+d.status);
  return {results:(d.results||[]).slice(0,8).map((r:any)=>({address:r.formatted_address,lat:r.geometry?.location?.lat,lng:r.geometry?.location?.lng,placeId:r.place_id,types:r.types,mapsUrl:mapsLink(r.formatted_address)}))};
 }
 if(name==='search_places'){
  const a=z.object({query:z.string().min(1).max(300),max:z.number().int().min(1).max(20).optional()}).strict().parse(raw);
  const r=await fetch('https://places.googleapis.com/v1/places:searchText',{method:'POST',headers:{'Content-Type':'application/json','X-Goog-Api-Key':key,'X-Goog-FieldMask':'places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.types,places.googleMapsUri,places.id'},body:JSON.stringify({textQuery:a.query,pageSize:a.max||10}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)});
  const d=await r.json().catch(()=>({})) as any;if(!r.ok)throw Error('Google Maps places: '+(d.error?.message||'HTTP '+r.status));
  return {places:(d.places||[]).map((p:any)=>({name:p.displayName?.text,address:p.formattedAddress,lat:p.location?.latitude,lng:p.location?.longitude,rating:p.rating,ratings:p.userRatingCount,types:p.types,placeId:p.id,mapsUrl:p.googleMapsUri||mapsLink((p.displayName?.text||'')+' '+(p.formattedAddress||''))}))};
 }
 throw Error('Unknown Google Maps operation.');
}
export async function verifyGoogleMapsKey(key:string){await executeGoogleMaps(key,'geocode',{address:'Lincoln, Nebraska'});}
