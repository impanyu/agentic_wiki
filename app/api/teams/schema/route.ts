import {teamAuthorized} from '@/app/teams/auth';
import {entityDb} from '@/app/entity-db/client';
import {seedSchema,type SeedNode} from '@/app/teams/schema-seed';
// Loads the initial class schema of the topic tree (operators only: TEAM_ADMIN_TOKEN). Body: a JSON array of nodes.
export const dynamic='force-dynamic';
export async function POST(request:Request){
 if(!teamAuthorized(request))return Response.json({error:'Not allowed.'},{status:403});
 const nodes=await request.json().catch(()=>null) as SeedNode[]|null;
 if(!Array.isArray(nodes)||!nodes.length)return Response.json({error:'Send a JSON array of schema nodes.'},{status:400});
 try{return Response.json(await seedSchema(await entityDb(),nodes));}
 catch(e){return Response.json({error:(e as Error).message},{status:500});}
}
