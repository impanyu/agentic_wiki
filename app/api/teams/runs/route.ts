import {entityDb} from '@/app/entity-db/client';
import {getTopic} from '@/app/entity-db/repo';
import {listTeamRuns,teamRunCalls} from '@/app/teams/config';
import {teamAuthorized} from '@/app/teams/auth';
// Operators: the latest team runs (?topic=<slug>) or one run's tool calls (?id=<run id>).
export const dynamic='force-dynamic';
export async function GET(request:Request){
 if(!teamAuthorized(request))return Response.json({error:'Not allowed.'},{status:403});
 const db=await entityDb(),u=new URL(request.url),id=u.searchParams.get('id');
 if(id)return Response.json({calls:await teamRunCalls(db,id)});
 const slug=u.searchParams.get('topic');const topic=slug?await getTopic(db,slug):null;
 return Response.json({runs:await listTeamRuns(db,topic?.id??null,100)});
}
