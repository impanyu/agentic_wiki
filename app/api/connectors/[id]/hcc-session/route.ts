import {z} from 'zod';
import {getActor} from '@/app/actor';
import {reply,sameOrigin} from '@/db/store';
import {hccSession} from '@/app/connectors/service';

export async function GET(r:Request,{params}:{params:Promise<{id:string}>}){const a=await getActor(r);try{return a.finish(reply(await hccSession(a.userId,(await params).id)));}catch(e){return a.finish(reply({error:e instanceof Error?e.message:'Could not inspect HCC session.'},400));}}
export async function POST(r:Request,{params}:{params:Promise<{id:string}>}){const a=await getActor(r);if(!sameOrigin(r))return a.finish(reply({error:'Invalid origin.'},403));try{const body=z.object({password:z.string().min(1).max(500),duoResponse:z.string().min(1).max(80).default('1')}).strict().parse(await r.json());return a.finish(reply(await hccSession(a.userId,(await params).id,body.password,body.duoResponse)));}catch(e){return a.finish(reply({error:e instanceof Error?e.message:'Could not connect to HCC.'},400));}}
