import {NextResponse,type NextRequest} from 'next/server';
import {PUBLIC_EDITION} from '@/app/edition';
import {isLocale,DEFAULT_LOCALE} from '@/app/i18n/locales';
// The public edition (rankwiki) serves public data only. These routes manage user
// connectors, drives, uploads, Page files, page editing, chat, forks and visibility;
// here they do not exist. Reading pages and their generated files stays open.
const CLOSED:[RegExp,string[]?][]=[
 [/^\/api\/(connectors|storage|connections|arcgis|sandboxes|links|live-agents)(\/|$)/],
 [/^\/api\/components\/(upload|[^/]+\/(configure-api|execute))(\/|$)/],
 [/^\/drive-picker(\/|$)/],
 [/^\/api\/pages\/[^/]+\/(drive|arcgis|code-tools|fork|content|chat|live-agent|versions|resources|workflow|run|preview-run|paper-notes)(\/|$)/],
 [/^\/api\/pages\/[^/]+\/files(\/|$)/,['POST','PUT','PATCH','DELETE']],
 [/^\/api\/pages\/[^/]+\/?$/,['POST','PUT','PATCH','DELETE']],
];
export function closedInPublicEdition(path:string,method:string){
 return CLOSED.some(([pattern,methods])=>pattern.test(path)&&(!methods||methods.includes(method.toUpperCase())));
}
export function proxy(request:NextRequest){
 const path=request.nextUrl.pathname;
 if(path.startsWith('/api/')||path.startsWith('/drive-picker')){
  if(PUBLIC_EDITION&&closedInPublicEdition(path,request.method))return NextResponse.json({error:'Not available on this wiki.'},{status:404});
  return NextResponse.next();
 }
 // Language editions: /<code>/… is the page at /… rendered in that language; /en/… is the bare address.
 const m=/^\/([a-z]{2})(\/.*)?$/.exec(path);
 if(m&&isLocale(m[1])){
  const url=request.nextUrl.clone();url.pathname=m[2]||'/';
  if(m[1]===DEFAULT_LOCALE)return NextResponse.redirect(url,308);
  const headers=new Headers(request.headers);headers.set('x-rw-locale',m[1]);
  return NextResponse.rewrite(url,{request:{headers}});
 }
 // A bare address never inherits a language from the request.
 if(request.headers.has('x-rw-locale')){const headers=new Headers(request.headers);headers.delete('x-rw-locale');return NextResponse.next({request:{headers}});}
 return NextResponse.next();
}
export const config={matcher:['/((?!_next/|geo/|favicon|robots\\.txt|sitemap|sitemaps/|data/).*)']};
