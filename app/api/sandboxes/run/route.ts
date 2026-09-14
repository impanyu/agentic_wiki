import {sandboxMessage} from '@/app/sandboxes/errors';
import {z} from 'zod';
import {getActor} from '@/app/actor';
import {reply,sameOrigin} from '@/db/store';
import {executeCodeComponent,runProgram} from '@/app/sandboxes/service';
import {codeSchema} from '@/app/sandboxes/contracts';
export async function POST(request:Request){const actor=await getActor(request);if(!sameOrigin(request))return actor.finish(reply({error:'Invalid request origin.'},403));try{const data=z.object({program:codeSchema.optional(),component:z.object({id:z.string(),version:z.number().int().positive()}).optional(),input:z.unknown()}).parse(await request.json());return actor.finish(reply(data.component?await executeCodeComponent(data.component,data.input??{},{userId:actor.userId}):await runProgram(codeSchema.parse(data.program),data.input??{},{userId:actor.userId})));}catch(e){return actor.finish(reply({error:sandboxMessage(e)},e instanceof Error&&e.message.startsWith('OPENAI_SANDBOX_')?503:400));}}
