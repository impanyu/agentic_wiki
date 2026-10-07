// Basemap tiles for generated apps, fetched by the server from fixed providers.
const PROVIDERS:Record<string,{url:string;max:number;type:string;attribution:string}>={
 osm:{url:'https://tile.openstreetmap.org/{z}/{x}/{y}.png',max:19,type:'image/png',attribution:'© OpenStreetMap contributors'},
 'esri-imagery':{url:'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',max:19,type:'image/jpeg',attribution:'Esri, Maxar, Earthstar Geographics'},
 'esri-topo':{url:'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',max:19,type:'image/jpeg',attribution:'Esri'},
 'esri-streets':{url:'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',max:19,type:'image/jpeg',attribution:'Esri'},
 'carto-light':{url:'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',max:20,type:'image/png',attribution:'© OpenStreetMap contributors © CARTO'},
 'carto-dark':{url:'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',max:20,type:'image/png',attribution:'© OpenStreetMap contributors © CARTO'},
 opentopo:{url:'https://a.tile.opentopomap.org/{z}/{x}/{y}.png',max:17,type:'image/png',attribution:'© OpenStreetMap contributors, SRTM | © OpenTopoMap'},
};
export const tileProviders=Object.fromEntries(Object.entries(PROVIDERS).map(([id,p])=>[id,{template:'/api/app-tiles/'+id+'/{z}/{x}/{y}',maxZoom:p.max,attribution:p.attribution}]));
const memory=new Map<string,{type:string;bytes:Uint8Array}>();
export async function tileFile(path:string[]){
 const [provider,zs,xs,ys]=path,p=PROVIDERS[provider||''];const y=(ys||'').replace(/\.(png|jpe?g)$/,'');
 if(!p||path.length!==4||![zs,xs,y].every(v=>/^\d{1,7}$/.test(v||'')))return null;
 const z=Number(zs),x=Number(xs),row=Number(y),n=2**z;if(z>p.max||x>=n||row>=n)return null;
 const key=provider+'/'+z+'/'+x+'/'+row,hit=memory.get(key);if(hit)return {status:200,...hit};
 const response=await fetch(p.url.replace('{z}',String(z)).replace('{x}',String(x)).replace('{y}',String(row)),{headers:{'User-Agent':'AgenticWiKi/1.0 (+https://wiki.aisoup.net)'},signal:AbortSignal.timeout(15000)});
 if(!response.ok)return {status:response.status===404?404:502,type:'text/plain',bytes:new Uint8Array()};
 const bytes=new Uint8Array(await response.arrayBuffer()),type=response.headers.get('content-type')?.split(';')[0]||p.type;
 if(!type.startsWith('image/')||bytes.byteLength>2*1024*1024)return {status:502,type:'text/plain',bytes:new Uint8Array()};
 memory.set(key,{type,bytes});if(memory.size>2000)memory.delete(memory.keys().next().value!);
 return {status:200,type,bytes};
}
