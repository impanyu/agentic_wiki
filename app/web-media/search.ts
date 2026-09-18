import {z} from 'zod';

export const publicMediaKind=z.enum(['all','image','video','audio','document','dataset']);
export type PublicMediaKind=z.infer<typeof publicMediaKind>;
export type PublicMediaResult={kind:Exclude<PublicMediaKind,'all'>;title:string;source:string;url:string;preview?:string;creator?:string;license?:string;description?:string;provider:string};
const clean=(value:unknown,max=800)=>String(value||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
async function json(url:string,signal?:AbortSignal){const response=await fetch(url,{headers:{'User-Agent':'AgenticWiKi/1.0 (https://wiki.aisoup.net)'},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(12000)]):AbortSignal.timeout(12000)});if(!response.ok)throw Error('SEARCH_UNAVAILABLE');return response.json() as Promise<any>;}

async function openverse(query:string,kind:PublicMediaKind,signal?:AbortSignal):Promise<PublicMediaResult[]>{
 const types=kind==='all'?['images','audio']:kind==='image'?['images']:kind==='audio'?['audio']:[];
 const settled=await Promise.allSettled(types.map(async type=>{
  const url='https://api.openverse.org/v1/'+type+'/?'+new URLSearchParams({q:query,page_size:'12',mature:'false'}),data=await json(url,signal);
  return (data.results||[]).flatMap((item:any)=>item.foreign_landing_url&&item.url?[{kind:(type==='images'?'image':'audio') as 'image'|'audio',title:clean(item.title)||query,source:String(item.foreign_landing_url),url:String(item.url),preview:item.thumbnail?String(item.thumbnail):undefined,creator:clean(item.creator,200)||undefined,license:[item.license,item.license_version].filter(Boolean).join(' ')||undefined,description:clean(item.description),provider:'Openverse'}]:[]);
 }));return settled.flatMap(result=>result.status==='fulfilled'?result.value:[]);
}
async function commons(query:string,kind:PublicMediaKind,signal?:AbortSignal):Promise<PublicMediaResult[]>{
 if(!['all','image','video','audio'].includes(kind))return [];
 const params=new URLSearchParams({action:'query',format:'json',generator:'search',gsrsearch:query,gsrnamespace:'6',gsrlimit:'16',prop:'imageinfo',iiprop:'url|extmetadata|mime',iiextmetadatafilter:'Artist|LicenseShortName|ImageDescription'}),data=await json('https://commons.wikimedia.org/w/api.php?'+params,signal);
 return Object.values(data.query?.pages||{}).flatMap((page:any)=>{const info=page.imageinfo?.[0],mime=String(info?.mime||''),mediaKind=mime.startsWith('image/')?'image':mime.startsWith('video/')?'video':mime.startsWith('audio/')?'audio':null;if(!mediaKind||kind!=='all'&&kind!==mediaKind||!info?.url||!info?.descriptionurl)return [];const meta=info.extmetadata||{};return [{kind:mediaKind,title:clean(page.title).replace(/^File:/,''),source:String(info.descriptionurl),url:String(info.url),creator:clean(meta.Artist?.value,200)||undefined,license:clean(meta.LicenseShortName?.value,100)||undefined,description:clean(meta.ImageDescription?.value),provider:'Wikimedia Commons'} as PublicMediaResult];});
}
async function archive(query:string,kind:PublicMediaKind,signal?:AbortSignal):Promise<PublicMediaResult[]>{
 const media:Record<PublicMediaKind,string[]>={all:['movies','audio','texts','software','data'],image:[],video:['movies'],audio:['audio'],document:['texts'],dataset:['data']};if(!media[kind].length)return [];
 const escaped=query.replace(/["\\]/g,' ').slice(0,200),q='('+media[kind].map(type=>'mediatype:'+type).join(' OR ')+') AND (title:"'+escaped+'" OR description:"'+escaped+'")';
 const params=new URLSearchParams({q,fl:'identifier,title,description,mediatype,creator,date',rows:'15',page:'1',output:'json'}),data=await json('https://archive.org/advancedsearch.php?'+params,signal);
 return (data.response?.docs||[]).flatMap((item:any)=>item.identifier?[{kind:item.mediatype==='movies'?'video':item.mediatype==='audio'?'audio':item.mediatype==='data'?'dataset':'document',title:clean(item.title)||String(item.identifier),source:'https://archive.org/details/'+encodeURIComponent(item.identifier),url:'https://archive.org/details/'+encodeURIComponent(item.identifier),creator:clean(Array.isArray(item.creator)?item.creator.join(', '):item.creator,200)||undefined,description:clean(item.description),provider:'Internet Archive'} as PublicMediaResult]:[]);
}
export async function searchPublicMedia(query:string,kind:PublicMediaKind='all',signal?:AbortSignal){
 query=z.string().trim().min(1).max(300).parse(query);kind=publicMediaKind.parse(kind);
 const results=await Promise.allSettled([openverse(query,kind,signal),commons(query,kind,signal),archive(query,kind,signal)]);
 const seen=new Set<string>(),items=results.flatMap(result=>result.status==='fulfilled'?result.value:[]).filter(item=>{const key=item.source.toLowerCase();if(seen.has(key))return false;seen.add(key);return true;}).slice(0,30);
 return {query,kind,items,providers:['Openverse','Wikimedia Commons','Internet Archive'],coverage:'Free public and openly licensed catalogs; not a complete index of the whole web.'};
}
