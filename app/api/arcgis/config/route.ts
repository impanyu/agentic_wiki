import {createHash} from 'node:crypto';
import {getActor} from '@/app/actor';
export async function GET(request:Request){const actor=await getActor(request);return actor.finish(Response.json({clientId:process.env.ARCGIS_CLIENT_ID||'',portal:process.env.ARCGIS_PORTAL_URL||'https://www.arcgis.com',authNamespace:'agenticwiki-'+createHash('sha256').update(actor.userId).digest('hex')},{headers:{'Cache-Control':'private, no-store','Vary':'Cookie'}}));}
