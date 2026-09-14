import {getActor} from '@/app/actor';
import {database,reply} from '@/db/store';
import {componentTypes} from '@/app/components-registry/contracts';
export async function GET(request:Request){
 const actor=await getActor(request);
 try{const rows=await database().prepare("SELECT DISTINCT type FROM components WHERE visibility='public' OR owner_id=? ORDER BY type").bind(actor.userId).all<{type:string}>();return actor.finish(reply({types:[...new Set([...componentTypes,...rows.results.map(r=>r.type)])]}));}
 catch{return actor.finish(reply({types:componentTypes}));}
}
