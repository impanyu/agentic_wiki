import {getActor} from '@/app/actor';
import {getPage} from '@/db/store';
import {sourcePaperPdf} from '@/app/papers/source';
// The page's original paper PDF, fetched by the server so the in-page reader can render it
// (publishers rarely allow cross-origin reads). Only the page's own source PDF is served.
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 const a=await getActor(request),page=await getPage((await params).id,a.userId).catch(()=>null);
 const url=page?sourcePaperPdf(page.sources):'';
 if(!url)return a.finish(new Response('No paper PDF for this page.',{status:404,headers:{'Cache-Control':'no-store'}}));
 const host=new URL(url).hostname;if(/^(localhost|\d+\.\d+\.\d+\.\d+|\[.*\])$/i.test(host)||host.endsWith('.internal')||host.endsWith('.local'))return a.finish(new Response('Unsupported PDF address.',{status:400}));
 try{
  const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0 (compatible; AgenticWiKi paper reader)',Accept:'application/pdf,*/*;q=0.5'},redirect:'follow',signal:AbortSignal.timeout(60000)});
  const size=Number(r.headers.get('content-length')||0);
  if(!r.ok||!r.body)return a.finish(new Response('The paper PDF could not be downloaded (HTTP '+r.status+').',{status:502,headers:{'Cache-Control':'no-store'}}));
  if(size>80_000_000)return a.finish(new Response('The paper PDF is larger than 80 MB.',{status:413}));
  const bytes=new Uint8Array(await r.arrayBuffer());if(bytes.byteLength>80_000_000)return a.finish(new Response('The paper PDF is larger than 80 MB.',{status:413}));
  if(String.fromCharCode(...bytes.subarray(0,5))!=='%PDF-')return a.finish(new Response('The source did not return a PDF.',{status:502,headers:{'Cache-Control':'no-store'}}));
  return a.finish(new Response(bytes,{headers:{'Content-Type':'application/pdf','Cache-Control':'private, max-age=3600','X-Content-Type-Options':'nosniff'}}));
 }catch{return a.finish(new Response('The paper PDF could not be downloaded.',{status:502,headers:{'Cache-Control':'no-store'}}));}
}
