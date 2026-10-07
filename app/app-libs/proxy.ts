import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
// Generated apps load npm libraries only through this proxy. The browser frame
// talks to this site alone; the server fetches from jsDelivr, and only for
// listed packages or for files those packages themselves import, so app code
// cannot smuggle its data into a request to a third party.
export const LIBRARIES=['react','react-dom','preact','htm','vue','lit','alpinejs','solid-js','immer','zod','nanoid','uuid',
 'd3','chart.js','chartjs-adapter-date-fns','chartjs-plugin-zoom','echarts','plotly.js-dist-min','vega','vega-lite','vega-embed','uplot','apexcharts',
 'three','leaflet','leaflet.markercluster','leaflet-draw','@geoman-io/leaflet-geoman-free','maplibre-gl','ol','proj4','shpjs','shapefile','topojson-client','@tmcw/togeojson','geotiff','georaster','georaster-layer-for-leaflet','h3-js','wellknown','@mapbox/polyline','deck.gl',
 'jszip','papaparse','xlsx','exceljs','pdf-lib','pdfjs-dist','sql.js','apache-arrow','dayjs','date-fns','luxon','lodash-es','lodash','ramda',
 'marked','markdown-it','dompurify','katex','mathjs','mermaid','highlight.js','prismjs','tabulator-tables','gridjs','ag-grid-community','sortablejs',
 'fabric','konva','p5','pixi.js','matter-js','tone','howler','simple-statistics','regression','ml-matrix','cytoscape','vis-network','sigma','graphology','elkjs','dagre',
 'qrcode','jsbarcode','html2canvas','jspdf','file-saver','codemirror','@tensorflow/tfjs'];
const FAMILIES=[/^d3-[a-z-]+$/,/^@turf\/[a-z-]+$/,/^@codemirror\/[a-z-]+$/,/^@lezer\/[a-z-]+$/,/^@deck\.gl\/[a-z-]+$/,/^@observablehq\/[a-z-]+$/,/^@preact\/[a-z-]+$/,/^@tanstack\/[a-z-]+$/];
export const listedLibrary=(name:string)=>LIBRARIES.includes(name)||FAMILIES.some(f=>f.test(name));
const SPEC=/^((?:@[a-z0-9][a-z0-9._-]{0,60}\/)?[a-z0-9][a-z0-9._-]{0,80})@(\d{1,4}\.\d{1,4}\.\d{1,6}(?:-[a-z0-9.]{1,30})?)((?:\/(?!\.)[A-Za-z0-9._+@-]{1,120}){0,12})$/;
const CDN='https://cdn.jsdelivr.net/npm/',PREFIX='/api/app-libs/npm/',LIMIT=20*1024*1024;
const dataDir=()=>resolve(process.env.DATA_DIR||'./data','app-libs');
// Package versions that a served file imports; remembered so transitive
// dependencies (react-dom → scheduler) load without being listed themselves.
let approved:Set<string>|null=null;
async function approvedSet(){if(approved)return approved;try{approved=new Set(JSON.parse(await readFile(join(dataDir(),'approved.json'),'utf8')) as string[]);}catch{approved=new Set();}return approved;}
async function approve(specs:string[]){const set=await approvedSet(),before=set.size;for(const s of specs)set.add(s);if(set.size!==before){await mkdir(dataDir(),{recursive:true});await writeFile(join(dataDir(),'approved.json'),JSON.stringify([...set]));}}
export function parseLibraryPath(path:string){const m=SPEC.exec(path);if(!m)return null;const rest=m[3]||'';if(rest.includes('/.')||rest.length>600)return null;return {name:m[1],version:m[2],rest};}
// Absolute jsDelivr imports ("/npm/x@1.2.3/+esm") are pointed back at this proxy.
export function rewriteLibrary(code:string){
 const found:string[]=[];
 const text=code.replace(/(["'`])\/npm\/((?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*)@(\d+\.\d+\.\d+(?:-[a-z0-9.]+)?)(?=[/"'`])/g,(_m,q,name,version)=>{found.push(name+'@'+version);return q+PREFIX+name+'@'+version;}).replace(/^\/\/# sourceMappingURL=.*$/gm,'');
 return {text,found};
}
type Served={status:number;type:string;bytes:Uint8Array};
const memory=new Map<string,Served>();
export async function libraryFile(path:string):Promise<Served>{
 const spec=parseLibraryPath(path);if(!spec)return {status:400,type:'text/plain',bytes:new TextEncoder().encode('Use /api/app-libs/npm/<package>@<exact version>/<file or +esm>.')};
 const key=spec.name+'@'+spec.version;
 if(!listedLibrary(spec.name)&&!(await approvedSet()).has(key))return {status:403,type:'text/plain',bytes:new TextEncoder().encode(spec.name+' is not an available library. Ask for it to be added, or choose a listed one.')};
 const id=createHash('sha256').update(path).digest('hex'),file=join(dataDir(),'files',id);
 const hit=memory.get(id);if(hit)return hit;
 try{const meta=JSON.parse(await readFile(file+'.json','utf8')) as {type:string};const served={status:200,type:meta.type,bytes:new Uint8Array(await readFile(file))};remember(id,served);return served;}catch{}
 const response=await fetch(CDN+spec.name+'@'+spec.version+spec.rest,{signal:AbortSignal.timeout(30000),redirect:'follow'});
 if(!response.ok)return {status:response.status===404?404:502,type:'text/plain',bytes:new TextEncoder().encode('Library file unavailable ('+response.status+').')};
 const size=Number(response.headers.get('content-length')||0);if(size>LIMIT)return {status:413,type:'text/plain',bytes:new TextEncoder().encode('Library file is too large.')};
 let bytes=new Uint8Array(await response.arrayBuffer());if(bytes.byteLength>LIMIT)return {status:413,type:'text/plain',bytes:new TextEncoder().encode('Library file is too large.')};
 let type=(response.headers.get('content-type')||'application/octet-stream').split(';')[0].trim();
 if(/javascript|ecmascript/.test(type)||/\.m?js$|\/\+esm$/.test(spec.rest)){const r=rewriteLibrary(new TextDecoder().decode(bytes));bytes=new TextEncoder().encode(r.text);type='text/javascript';await approve(r.found);}
 else if(type==='text/css'){const r=rewriteLibrary(new TextDecoder().decode(bytes));bytes=new TextEncoder().encode(r.text);await approve(r.found);}
 const served={status:200,type,bytes};
 await mkdir(join(dataDir(),'files'),{recursive:true});await writeFile(file,bytes);await writeFile(file+'.json',JSON.stringify({type,path}));remember(id,served);
 return served;
}
function remember(id:string,served:Served){if(served.bytes.byteLength>2*1024*1024)return;memory.set(id,served);if(memory.size>300)memory.delete(memory.keys().next().value!);}
export const libraryHeaders=(type:string,ok:boolean)=>({'Content-Type':type+(/^text\//.test(type)?'; charset=utf-8':''),'Access-Control-Allow-Origin':'*','Cross-Origin-Resource-Policy':'cross-origin','X-Content-Type-Options':'nosniff','Cache-Control':ok?'public, max-age=31536000, immutable':'no-store'});
