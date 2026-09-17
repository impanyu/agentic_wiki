import {getActor} from '@/app/actor';
import {reply} from '@/db/store';
import {resourceSchema} from '@/app/resources/contracts';
import {readFile} from '@/app/resources/service';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 const actor=await getActor(request);try{
 const resource=resourceSchema.parse(JSON.parse(new URL(request.url).searchParams.get('resource')||'null'));
 if(resource.kind!=='file')throw Error('Choose a file.');
 const file=await readFile((await params).id,actor.userId,resource);
 return actor.finish(new Response(new Blob([file.bytes as BlobPart]),{headers:{'Content-Type':'application/octet-stream','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}}));
 }catch(e){return actor.finish(reply({error:e instanceof Error?e.message:'File unavailable.'},400));}
}
