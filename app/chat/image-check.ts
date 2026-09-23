import {imageLinePattern} from '@/app/internal-links';
// Confirms that every standalone image in a Markdown body actually serves an
// image, so an agent proposing a revision learns about a dead link before the
// reader does. Site-served files (/api/...) are trusted; only remote URLs are probed.
export function imageUrls(body:string){return body.split('\n').flatMap(line=>{const match=line.match(imageLinePattern);return match?[match[2]]:[];});}
export async function unreachableImages(body:string,signal?:AbortSignal){
 const remote=[...new Set(imageUrls(body).filter(url=>url.startsWith('https://')))].slice(0,12);
 const results=await Promise.all(remote.map(async url=>{
  const probe=async(method:'HEAD'|'GET')=>{const response=await fetch(url,{method,redirect:'follow',headers:{'User-Agent':'Mozilla/5.0 (compatible; AgenticWiKi image check)','Accept':'image/*,*/*;q=0.5'},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(8000)]):AbortSignal.timeout(8000)});const type=response.headers.get('content-type')||'';if(method==='GET')await response.body?.cancel();return {ok:response.ok,type,status:response.status};};
  try{let result=await probe('HEAD');if(!result.ok||!(result.type.startsWith('image/')||!result.type))result=await probe('GET');
   if(!result.ok)return url+' (HTTP '+result.status+')';if(result.type&&!result.type.startsWith('image/'))return url+' (not an image: '+result.type.split(';')[0]+')';return null;}
  catch{return url+' (unreachable)';}
 }));
 return results.filter((value):value is string=>!!value);
}
