import {tile} from '@/app/earth-engine/service';
// XYZ map tiles for an Earth Engine layer, fetched with the account that created the layer.
export async function GET(_:Request,{params}:{params:Promise<{id:string;z:string;x:string;y:string}>}){
 const p=await params;
 try{const t=await tile(p.id,Number(p.z),Number(p.x),Number(p.y.replace(/\.(png|jpg)$/,'')));
  if(!t)return new Response('Not found or expired.',{status:404,headers:{'Cache-Control':'no-store'}});
  if(t.status!==200)return new Response('Tile unavailable.',{status:t.status===404?404:502,headers:{'Cache-Control':'no-store'}});
  return new Response(new Uint8Array(t.bytes),{headers:{'Content-Type':t.type,'Cache-Control':'public, max-age=86400','Cross-Origin-Resource-Policy':'cross-origin'}});
 }catch{return new Response('Tile unavailable.',{status:502,headers:{'Cache-Control':'no-store'}});}
}
