import {libraryFile,libraryHeaders} from '@/app/app-libs/proxy';
// npm libraries for generated apps; see app/app-libs/proxy.ts.
export async function GET(_:Request,{params}:{params:Promise<{path:string[]}>}){
 const parts=(await params).path;
 if(parts[0]!=='npm')return new Response('Not found.',{status:404,headers:libraryHeaders('text/plain',false)});
 try{const f=await libraryFile(parts.slice(1).map(decodeURIComponent).join('/'));return new Response(new Uint8Array(f.bytes),{status:f.status,headers:libraryHeaders(f.type,f.status===200)});}
 catch{return new Response('Library unavailable.',{status:502,headers:libraryHeaders('text/plain',false)});}
}
export async function OPTIONS(){return new Response(null,{status:204,headers:{...libraryHeaders('text/plain',false),'Access-Control-Allow-Methods':'GET'}});}
