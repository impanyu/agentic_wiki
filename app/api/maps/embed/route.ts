import {googleEmbedUrl,targetFromQuery} from '@/app/maps/url';
// An embedded Google map for a page or app: redirects the iframe to Google's embed URL. Maps are
// public data, so there is no per-user key: the platform's GOOGLE_MAPS_API_KEY enables the Maps
// Embed API, otherwise Google's classic keyless embed is used. Only Google URLs are produced.
export async function GET(request:Request){
 const target=targetFromQuery(new URL(request.url).searchParams);
 if(!target)return new Response('Invalid map.',{status:400,headers:{'Cache-Control':'no-store'}});
 return new Response(null,{status:302,headers:{Location:googleEmbedUrl(target,process.env.GOOGLE_MAPS_API_KEY||undefined),'Cache-Control':'public, max-age=3600','Referrer-Policy':'strict-origin-when-cross-origin'}});
}
