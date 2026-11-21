import {env} from '@/server/runtime';
import {contextFiles} from '@/app/context-files/server';
import {loadPublicPage} from '@/app/seo/server';
// /data/<page id>/<file name>: the data files of a public page (the CSV behind its ranking or charts),
// readable by anyone — readers, search engines and agents. Read-only; private pages and other files 404.
export const dynamic='force-dynamic';
const READER='seo-reader';
const TYPES:Record<string,string>={csv:'text/csv; charset=utf-8',tsv:'text/tab-separated-values; charset=utf-8',json:'application/json; charset=utf-8',geojson:'application/geo+json; charset=utf-8',txt:'text/plain; charset=utf-8'};
export async function GET(_request:Request,{params}:{params:Promise<{id:string;name:string}>}){
 const {id,name}=await params;const file=decodeURIComponent(name);
 const ext=file.split('.').pop()?.toLowerCase()||'';if(!TYPES[ext])return new Response('Not found',{status:404});
 const page=await loadPublicPage(decodeURIComponent(id)).catch(()=>null);if(!page)return new Response('Not found',{status:404});
 const f=(await contextFiles(page.id,READER)).find(x=>(x.row.display_name||x.data.fileName)===file&&x.row.scope==='');
 const location=String(f?.data.location||'');if(!f||!location.startsWith('r2://FILES/uploads/'))return new Response('Not found',{status:404});
 const object=await env.FILES.get(location.slice('r2://FILES/'.length));if(!object)return new Response('Not found',{status:404});
 return new Response(object.body,{headers:{'Content-Type':TYPES[ext],'Content-Disposition':"inline; filename*=UTF-8''"+encodeURIComponent(file),'Cache-Control':'public, max-age=3600','X-Content-Type-Options':'nosniff','Access-Control-Allow-Origin':'*'}});
}
