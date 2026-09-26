import {getActor} from '@/app/actor';
import {database,getPage} from '@/db/store';
import {googleEmbedUrl,targetFromQuery} from '@/app/maps/url';
// An embedded Google map for a page or app: redirects the iframe to Google's embed URL, using
// the page owner's Google Maps connector key (Maps Embed API) when they have one, otherwise the
// classic keyless embed. Only map parameters are accepted, and only Google URLs are produced.
async function ownerKey(pageId:string|null,viewer:string){
 if(!pageId||!/^[0-9a-f-]{36}$/i.test(pageId))return undefined;
 if(!await getPage(pageId,viewer))return undefined;
 const owner=(await database().prepare('SELECT owner_id FROM pages WHERE id=?').bind(pageId).first<{owner_id:string}>())?.owner_id;if(!owner)return undefined;
 const {connections}=await import('@/app/connectors/service'),{vaultPath,vaultRead}=await import('@/app/storage/vault');
 const c=(await connections(owner)).find(c=>c.provider==='google-maps'&&c.enabled&&c.connected);if(!c)return undefined;
 return (await vaultRead(await vaultPath(owner,'connector-'+c.id)))?.token||undefined;
}
export async function GET(request:Request){
 const actor=await getActor(request),params=new URL(request.url).searchParams,target=targetFromQuery(params);
 if(!target)return actor.finish(new Response('Invalid map.',{status:400,headers:{'Cache-Control':'no-store'}}));
 let key:string|undefined;try{key=await ownerKey(params.get('page'),actor.userId);}catch{key=undefined;}
 return actor.finish(new Response(null,{status:302,headers:{Location:googleEmbedUrl(target,key),'Cache-Control':'private, max-age=300','Referrer-Policy':'strict-origin-when-cross-origin'}}));
}
