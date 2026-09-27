import {thumbnailFile} from '@/app/earth-engine/service';
// A kept Earth Engine thumbnail: an unguessable, immutable image that wiki pages and apps embed.
export async function GET(_:Request,{params}:{params:Promise<{id:string}>}){
 const file=await thumbnailFile((await params).id);
 if(!file)return new Response('Not found.',{status:404,headers:{'Cache-Control':'no-store'}});
 return new Response(new Uint8Array(file.bytes),{headers:{'Content-Type':file.type,'Cache-Control':'public, max-age=31536000, immutable','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'cross-origin'}});
}
