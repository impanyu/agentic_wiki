import {getActor} from '@/app/actor';
import {reply} from '@/db/store';
export async function GET(request:Request){const actor=await getActor(request);return actor.finish(reply({ready:true}));}
