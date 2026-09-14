// Wikimedia returns real file URLs and attribution; the model never invents image URLs.
export type Illustration={id:number;url:string;source:string;description:string;credit:string};
function plain(value:string){return value.replace(/<[^>]*>/g,'').replace(/&quot;/g,'"').replace(/&#0?39;/g,"'").replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/\s+/g,' ').trim();}
export async function findIllustrations(subject:string):Promise<Illustration[]>{
 try{
  const params=new URLSearchParams({action:'query',format:'json',generator:'search',gsrsearch:subject.slice(0,160),gsrnamespace:'6',gsrlimit:'6',prop:'imageinfo',iiprop:'url|extmetadata|size|mime',iiurlwidth:'960',iiextmetadatafilter:'Artist|LicenseShortName|ImageDescription',iiextmetadatalanguage:'en'});
  const response=await fetch('https://commons.wikimedia.org/w/api.php?'+params,{headers:{'User-Agent':'Samepage/1.0 (https://samepage-knowledge-cache.random-walk.chatgpt.site)'},signal:AbortSignal.timeout(12000)});
  if(!response.ok)return [];
  const data=await response.json() as {query?:{pages?:Record<string,{pageid:number;title:string;index:number;imageinfo?:{thumburl?:string;mime:string;descriptionurl:string;width:number;height:number;extmetadata?:Record<string,{value:string}>}[]}>}};
  return Object.values(data.query?.pages||{}).sort((a,b)=>a.index-b.index).flatMap(page=>{
   const info=page.imageinfo?.[0],meta=info?.extmetadata;
   if(!info?.thumburl||!/^image\/(jpeg|png|svg\+xml|webp)$/.test(info.mime)||!/^https:\/\/(?:upload|thumb)\.wikimedia\.org\//.test(info.thumburl)||!/^https:\/\/commons\.wikimedia\.org\//.test(info.descriptionurl)||info.width<300||info.height<180)return [];
   const license=plain(meta?.LicenseShortName?.value||''),artist=plain(meta?.Artist?.value||'');
   if(!license||!artist)return [];
   return [{id:page.pageid,url:info.thumburl,source:info.descriptionurl,description:plain(meta?.ImageDescription?.value||page.title).slice(0,1000),credit:artist+' · '+license+' · Wikimedia Commons'}];
  });
 }catch{return [];}
}
