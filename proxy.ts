import {NextResponse,type NextRequest} from 'next/server';
import {PUBLIC_EDITION} from '@/app/edition';
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
 if(PUBLIC_EDITION&&closedInPublicEdition(request.nextUrl.pathname,request.method))return NextResponse.json({error:'Not available on this wiki.'},{status:404});
 return NextResponse.next();
}
export const config={matcher:['/api/:path*','/drive-picker/:path*']};
