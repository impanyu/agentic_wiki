import {env} from '@/server/runtime';
import {database} from '@/db/store';
import {createComponent,rememberComponent} from '@/app/components-registry/registry';
import {attachContextFile} from './server';
import {folderPath} from './tree';
// Stores text an agent authored (an SVG diagram, CSV, Markdown, JSON) as a page
// file, exactly like a browser upload, and returns the URL that renders it inline.
const textTypes:Record<string,string>={svg:'image/svg+xml',csv:'text/csv',md:'text/markdown',txt:'text/plain',json:'application/json',html:'text/html'};
export async function storePageTextFile(pageId:string,userId:string,rawName:string,content:string,language:string,folder=''){
 const files=(env as unknown as {FILES?:R2Bucket}).FILES;if(!files)throw Error('File storage is unavailable.');
 const name=rawName.replace(/[\u0000-\u001f/\\]/g,'_').trim().slice(0,250);if(!name)throw Error('The file needs a name.');
 const extension=name.includes('.')?name.split('.').pop()!.toLowerCase():'';const mimeType=textTypes[extension];if(!mimeType)throw Error('Supported file types: '+Object.keys(textTypes).map(e=>'.'+e).join(', '));
 if(content.length>2*1024*1024)throw Error('Write files up to 2 MB.');
 // SVG never carries scripts or event handlers: it is served as an image.
 if(extension==='svg'){if(!/<svg[\s>]/i.test(content))throw Error('An .svg file must contain an <svg> element.');content=content.replace(/<script[\s\S]*?<\/script>/gi,'').replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi,'').replace(/(href|xlink:href)\s*=\s*("|')\s*javascript:[^"']*\2/gi,'');}
 const bytes=new TextEncoder().encode(content),key='uploads/'+crypto.randomUUID();
 await files.put(key,bytes,{httpMetadata:{contentType:mimeType}});
 const context={userId,ownerId:userId,language,visibility:'private' as const};
 const component=await createComponent(name+' — '+key.split('/')[1],'data',{kind:'data-reference',location:'r2://FILES/'+key,fileName:name,mimeType,size:bytes.byteLength,format:extension,description:'Agent-authored file: '+name},context);
 await rememberComponent(name,component,context);
 await database().prepare('UPDATE components SET title=?,description=? WHERE id=? AND owner_id=?').bind(name,'Agent-authored file: '+name,component.id,userId).run();
 const fileId=await attachContextFile(pageId,component.id,userId,folderPath(folder));
 return {fileId,name,mimeType,size:bytes.byteLength,url:'/api/pages/'+pageId+'/files/'+fileId+'?inline=1'};
}
