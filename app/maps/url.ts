// Google Maps links written in pages and apps, and the embeddable map they turn into.
// Shared by the article renderer (browser) and the embed route (server); no secrets here.
export type MapTarget={mode:'place'|'search'|'view'|'directions';q?:string;lat?:number;lng?:number;zoom?:number;origin?:string;destination?:string;travel?:'driving'|'walking'|'bicycling'|'transit'};
const num=(v:string|null|undefined)=>{const n=Number(v);return v!==null&&v!==undefined&&v!==''&&Number.isFinite(n)?n:undefined;};
const clean=(s:string|null|undefined)=>(s||'').replace(/\+/g,' ').trim().slice(0,300);

// Recognizes https://www.google.com/maps/search/?api=1&query=…, /maps/place/NAME/@lat,lng,zz,
// /maps/@lat,lng,zz, /maps/dir/?api=1&origin=…&destination=…, and maps.google.com/?q=….
export function parseGoogleMapsUrl(value:string):MapTarget|null{
 let u:URL;try{u=new URL(value.trim());}catch{return null;}
 if(u.protocol!=='https:'&&u.protocol!=='http:')return null;
 const host=u.hostname.replace(/^www\./,'');
 const google=host==='google.com'||/^google\.[a-z.]{2,6}$/.test(host);
 if(!(google&&u.pathname.startsWith('/maps'))&&host!=='maps.google.com'&&host!=='maps.app.goo.gl')return null;
 const p=u.searchParams,at=u.pathname.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,(\d+(?:\.\d+)?)z)?/);
 const zoom=num(at?.[3])??num(p.get('zoom'));
 if(u.pathname.startsWith('/maps/dir')){
  const parts=u.pathname.split('/').slice(3).filter(s=>s&&!s.startsWith('@')&&!s.startsWith('data=')).map(s=>decodeURIComponent(s));
  const origin=clean(p.get('origin')||parts[0]),destination=clean(p.get('destination')||parts[parts.length-1]);
  const travel=p.get('travelmode');
  return destination?{mode:'directions',origin:origin||undefined,destination,travel:travel==='walking'||travel==='bicycling'||travel==='transit'?travel:'driving'}:null;
 }
 const place=u.pathname.match(/^\/maps\/place\/([^/@]+)/)?.[1];
 const q=clean(p.get('query')||p.get('q')||(place?decodeURIComponent(place):''));
 if(q)return {mode:u.pathname.startsWith('/maps/search')&&!place?'search':'place',q,lat:num(at?.[1]),lng:num(at?.[2]),zoom};
 const center=p.get('center')?.split(',');
 const lat=num(at?.[1]??center?.[0]),lng=num(at?.[2]??center?.[1]);
 return lat!==undefined&&lng!==undefined&&Math.abs(lat)<=90&&Math.abs(lng)<=180?{mode:'view',lat,lng,zoom}:null;
}
// Query string for /api/maps/embed (the route adds the page owner's key when they have one).
export function embedPath(t:MapTarget,pageId?:string){
 const s=new URLSearchParams({mode:t.mode});
 for(const [k,v] of Object.entries({q:t.q,lat:t.lat,lng:t.lng,zoom:t.zoom,origin:t.origin,destination:t.destination,travel:t.travel,page:pageId}))if(v!==undefined&&v!=='')s.set(k,String(v));
 return '/api/maps/embed?'+s.toString();
}
// Google's embed URLs: the Maps Embed API with a key, or the classic keyless embed without one.
export function googleEmbedUrl(t:MapTarget,key?:string){
 const z=t.zoom!==undefined?Math.round(Math.min(21,Math.max(1,t.zoom))):undefined;
 if(key){
  const s=new URLSearchParams({key});
  if(t.mode==='directions'){s.set('destination',t.destination||'');if(t.origin)s.set('origin',t.origin);s.set('mode',t.travel||'driving');return 'https://www.google.com/maps/embed/v1/directions?'+s;}
  if(t.mode==='view'){s.set('center',`${t.lat},${t.lng}`);s.set('zoom',String(z??12));return 'https://www.google.com/maps/embed/v1/view?'+s;}
  s.set('q',t.q||`${t.lat},${t.lng}`);if(z!==undefined)s.set('zoom',String(z));
  if(t.lat!==undefined&&t.lng!==undefined&&t.mode==='search')s.set('center',`${t.lat},${t.lng}`);
  return 'https://www.google.com/maps/embed/v1/'+(t.mode==='search'?'search':'place')+'?'+s;
 }
 const s=new URLSearchParams({output:'embed'});
 if(t.mode==='directions'){s.set('saddr',t.origin||'');s.set('daddr',t.destination||'');return 'https://maps.google.com/maps?'+s;}
 s.set('q',t.q||`${t.lat},${t.lng}`);if(z!==undefined)s.set('z',String(z));
 return 'https://maps.google.com/maps?'+s;
}
export function targetFromQuery(p:URLSearchParams):MapTarget|null{
 const mode=p.get('mode');if(mode!=='place'&&mode!=='search'&&mode!=='view'&&mode!=='directions')return null;
 const lat=num(p.get('lat')),lng=num(p.get('lng')),travel=p.get('travel');
 const t:MapTarget={mode,q:clean(p.get('q'))||undefined,lat,lng,zoom:num(p.get('zoom')),origin:clean(p.get('origin'))||undefined,destination:clean(p.get('destination'))||undefined,travel:travel==='walking'||travel==='bicycling'||travel==='transit'||travel==='driving'?travel:undefined};
 if(mode==='directions')return t.destination?t:null;
 if(mode==='view')return lat!==undefined&&lng!==undefined?t:null;
 return t.q||(lat!==undefined&&lng!==undefined)?t:null;
}
