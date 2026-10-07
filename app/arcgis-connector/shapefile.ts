import JSZip from 'jszip';
import {browseResources,readFile} from '@/app/resources/service';
import {listContextFiles} from '@/app/context-files/server';
import type {Resource} from '@/app/resources/contracts';

// A shapefile is several files that share one name (.shp geometry, .shx index, .dbf attributes,
// .prj projection, .cpg encoding…). ArcGIS takes them as one ZIP. When a .shp or a folder is
// chosen, its companion files are collected from the same folder and zipped here, so nobody has
// to package them by hand.
const PART=/\.(shp|shx|dbf|prj|cpg|sbn|sbx|qix|fix|aih|ain|atx|shp\.xml|xml)$/i,REQUIRED=['shp','shx','dbf'],LIMIT=10*1024*1024;
const base=(name:string)=>name.replace(PART,'').toLowerCase();
const ext=(name:string)=>(name.match(PART)?.[1]||'').toLowerCase();
async function listFolder(pageId:string,userId:string,folder:Resource){
 const items:Resource[]=[];let cursor='';
 for(let i=0;i<10;i++){const page=await browseResources(pageId,userId,folder,cursor);items.push(...page.items);if(!page.next)break;cursor=page.next;}
 return items;
}
async function siblings(pageId:string,userId:string,file:Resource):Promise<Resource[]>{
 if(file.space==='page'){const files=await listContextFiles(pageId,userId),me=files.find(f=>f.id===file.id);if(!me)throw Error('That Page file is no longer available.');return files.filter(f=>f.folderPath===me.folderPath).map(f=>({space:'page',id:f.id,name:f.name,kind:'file'}));}
 if(['hcc','adapt','dropbox'].includes(file.space)){const cut=file.id.lastIndexOf('/'),parent=cut>0?file.id.slice(0,cut):file.space==='dropbox'?'':'/';return (await listFolder(pageId,userId,{...file,id:parent,kind:'folder',name:'folder'})).filter(r=>r.kind==='file');}
 throw Error('For a shapefile in Google Drive, OneDrive or ADMA, choose the folder that contains it instead of the .shp file; its companion files are then packaged automatically.');
}
export function needsPackaging(r:Resource){return r.kind==='folder'||/\.shp$/i.test(r.name);}
export async function packageShapefile(pageId:string,userId:string,chosen:Resource):Promise<{name:string;bytes:Uint8Array}>{
 let files:Resource[],want:string;
 if(chosen.kind==='folder'){
  files=(await listFolder(pageId,userId,chosen)).filter(r=>r.kind==='file');
  const shapes=[...new Set(files.filter(f=>/\.shp$/i.test(f.name)).map(f=>base(f.name)))];
  if(!shapes.length)throw Error('This folder has no shapefile (.shp).');
  if(shapes.length>1)throw Error('This folder has several shapefiles ('+files.filter(f=>/\.shp$/i.test(f.name)).map(f=>f.name).slice(0,8).join(', ')+'). Choose the .shp you want to publish.');
  want=shapes[0];
 }else{files=await siblings(pageId,userId,chosen);want=base(chosen.name);}
 const parts=files.filter(f=>PART.test(f.name)&&base(f.name)===want);
 const missing=REQUIRED.filter(x=>!parts.some(p=>ext(p.name)===x));
 if(missing.length)throw Error('The shapefile is incomplete: '+missing.map(x=>'.'+x).join(', ')+' is missing next to '+want+'.shp in the same folder.');
 const zip=new JSZip();let total=0;
 for(const part of parts){const file=await readFile(pageId,userId,part);total+=file.bytes.byteLength;if(total>LIMIT)throw Error('The shapefile and its companion files exceed 10 MB.');zip.file(part.name,file.bytes);}
 const bytes=await zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
 return {name:want+'.zip',bytes};
}
