import {getActor} from '@/app/actor';
import {reply,sameOrigin} from '@/db/store';
import {executeApi} from '@/app/components-registry/api-executor';
import {ApiExecutionError,executionInputSchema} from '@/app/components-registry/http-contracts';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 const actor=await getActor(request),respond=(data:unknown,status=200)=>actor.finish(reply(data,status));
 if(!sameOrigin(request))return respond({error:'This request must come from the site.'},403);
 try{const input=executionInputSchema.parse(await request.json());const result=await executeApi({id:(await params).id,version:1},input,{userId:actor.userId},{allowWrite:request.headers.get('X-Confirm-Api-Write')==='yes',signal:request.signal});return respond({result});}
 catch(error){const code=error instanceof ApiExecutionError?error.code:'API_COMPONENT_UNAVAILABLE';return respond({error:code.replaceAll('_',' ').toLowerCase(),code},400);}
}
