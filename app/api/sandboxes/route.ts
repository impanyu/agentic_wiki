import {getActor} from '@/app/actor';
import {database,reply,sameOrigin} from '@/db/store';
import {createDesktop,sandboxStatus} from '@/app/sandboxes/service';
export async function GET(request:Request){const actor=await getActor(request);const rows=await database().prepare("SELECT id,kind,state,expires_at expiresAt FROM sandbox_sessions WHERE owner_id=? AND kind='desktop' AND state='active' AND expires_at>? ORDER BY created_at DESC").bind(actor.userId,Date.now()).all();return actor.finish(reply({...sandboxStatus(actor.userId),sessions:rows.results}));}
export async function POST(request:Request){const actor=await getActor(request);if(!sameOrigin(request))return actor.finish(reply({error:'Invalid request origin.'},403));try{return actor.finish(reply(await createDesktop({userId:actor.userId})));}catch(e){return actor.finish(reply({error:e instanceof Error?e.message:'SANDBOX_FAILED'},503));}}
