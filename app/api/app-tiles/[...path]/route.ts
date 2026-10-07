import {tileFile} from '@/app/app-libs/tiles';
// Basemap tiles for generated apps; see app/app-libs/tiles.ts.
const headers=(type:string,ok:boolean)=>({'Content-Type':type,'Access-Control-Allow-Origin':'*','Cross-Origin-Resource-Policy':'cross-origin','Cache-Control':ok?'public, max-age=604800':'no-store'});
export async function GET(_:Request,{params}:{params:Promise<{path:string[]}>}){
 try{const t=await tileFile((await params).path);if(!t)return new Response('Not found.',{status:404,headers:headers('text/plain',false)});return new Response(new Uint8Array(t.bytes),{status:t.status,headers:headers(t.type,t.status===200)});}
 catch{return new Response('Tile unavailable.',{status:502,headers:headers('text/plain',false)});}
}
