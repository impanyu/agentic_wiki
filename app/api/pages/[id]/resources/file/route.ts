import {getActor} from '@/app/actor';
import {reply} from '@/db/store';
import {resourceSchema} from '@/app/resources/contracts';
import {readFile} from '@/app/resources/service';
const INLINE:Record<string,string>={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',avif:'image/avif',bmp:'image/bmp',pdf:'application/pdf',mp4:'video/mp4',webm:'video/webm',mov:'video/quicktime',m4v:'video/mp4',mp3:'audio/mpeg',wav:'audio/wav',ogg:'audio/ogg',m4a:'audio/mp4'};
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 const actor=await getActor(request);try{
 const resource=resourceSchema.parse(JSON.parse(new URL(request.url).searchParams.get('resource')||'null'));
 if(resource.kind!=='file')throw Error('Choose a file.');
 const file=await readFile((await params).id,actor.userId,resource);
 // Apps may show images, PDFs, audio and video inline; anything else (including SVG and HTML) stays a download.
 const inline=new URL(request.url).searchParams.get('inline')==='1'?INLINE[resource.name.split('.').pop()?.toLowerCase()||'']:undefined;
 return actor.finish(new Response(new Blob([file.bytes as BlobPart]),{headers:{'Content-Type':inline||'application/octet-stream',...(inline?{'Content-Disposition':"inline; filename*=UTF-8''"+encodeURIComponent(resource.name)}:{}),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}}));
 }catch(e){return actor.finish(reply({error:e instanceof Error?e.message:'File unavailable.'},400));}
}
