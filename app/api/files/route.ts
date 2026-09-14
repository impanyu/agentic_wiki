import {getActor} from '@/app/actor';import {reply} from '@/db/store';import {listDataFiles} from '@/app/templates/files';
export async function GET(request:Request){const a=await getActor(request);try{return a.finish(reply(await listDataFiles(a.userId,new URL(request.url).searchParams.get('after')||'')));}catch{return a.finish(reply({error:'Could not load files.'},503));}}
