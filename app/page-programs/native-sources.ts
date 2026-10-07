import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import sources from './native-sources.json';
// Built-in apps are compiled into the site. Agents read their source here as a
// starting point and rebuild them as sandboxed page apps; the originals stay as they are.
const ALIASES:Record<string,string>={table:'studio',json:'studio',text:'studio',image:'studio',pdf:'studio',archive:'studio',hub:'studio','geo-viewer':'map',arcgis:'arcgis-publisher',hcc:'unl-hcc'};
export const nativeSourceApps=Object.keys(sources);
const PORTING='This is the source of a built-in app compiled into the site (React/TypeScript with full site privileges). A page app cannot import site modules, call /api routes or use cookies. Port it as a sandbox app: plain HTML/CSS/JS modules or a listed library (react, preact+htm, leaflet, maplibre-gl, jszip, ...) via the libraries field; replace each fetch(\'/api/...\') with window.pageTools.call(tool,args) — list_connectors returns connector IDs and tool schemas for ArcGIS Online, ADMA, UNL HCC, ADAPT and storage; browse_resources/copy_resources/storage_execute handle files; pageTools.upload(file,{folderPath}) saves a file the user picks into Page files; basemaps come from /api/app-tiles/<provider>/{z}/{x}/{y}. Keep the features the user still needs and change what they asked for.';
export async function nativeAppSource(app:string){
 const id=ALIASES[app]||app,files=(sources as Record<string,string[]>)[id];
 if(!files)throw Error('Unknown built-in app. Choose one of: '+nativeSourceApps.join(', ')+'.');
 const read=async(path:string)=>{for(const root of [join(process.cwd(),'native-sources'),process.cwd()])try{return await readFile(join(root,path),'utf8');}catch{}return null;};
 const out=await Promise.all(files.map(async path=>({path,content:(await read(path))?.slice(0,60000)??'(unavailable on this server)'})));
 return {app:id,porting:PORTING,files:out};
}
