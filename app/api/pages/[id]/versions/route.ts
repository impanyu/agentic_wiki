import {z} from 'zod';
import {getActor} from '@/app/actor';
import {reply,sameOrigin} from '@/db/store';
import {listVersions,readVersion,restoreVersion} from '@/app/versions/service';
// A page's version history (editors only): list, preview one version, or restore it.
type Ctx={params:Promise<{id:string}>};
export async function GET(request:Request,{params}:Ctx){
 const actor=await getActor(request),version=new URL(request.url).searchParams.get('version');
 try{const id=(await params).id;return actor.finish(reply(version?{version:await readVersion(id,actor.userId,z.string().uuid().parse(version))}:await listVersions(id,actor.userId)));}
 catch(e){return actor.finish(reply({error:e instanceof Error?e.message:'Versions are unavailable.'},403));}
}
export async function POST(request:Request,{params}:Ctx){
 const actor=await getActor(request);if(!sameOrigin(request))return actor.finish(reply({error:'This request must come from the site.'},403));
 try{const body=z.object({action:z.literal('restore'),versionId:z.string().uuid()}).strict().parse(await request.json());return actor.finish(reply(await restoreVersion((await params).id,actor.userId,body.versionId)));}
 catch(e){return actor.finish(reply({error:e instanceof Error?e.message:'The version could not be restored.'},400));}
}
