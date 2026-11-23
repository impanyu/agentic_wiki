import {teamAuthorized} from '@/app/teams/auth';
import {entityDb} from '@/app/entity-db/client';
import {loadTopicTree,type TreeNode} from '@/app/teams/tree';
// Loads a designed topic tree (operators only: TEAM_ADMIN_TOKEN): topics into place, every leaf queued for its
// team. Body: the tree (docs/topic-tree.json). ?queue=0 places the topics without queueing teams.
export const dynamic='force-dynamic';
export async function POST(request:Request){
 if(!teamAuthorized(request))return Response.json({error:'Not allowed.'},{status:403});
 const nodes=await request.json().catch(()=>null) as TreeNode[]|null;
 if(!Array.isArray(nodes)||!nodes.length)return Response.json({error:'Send the tree as a JSON array of top-level nodes.'},{status:400});
 const queue=new URL(request.url).searchParams.get('queue')!=='0';
 try{return Response.json(await loadTopicTree(await entityDb(),nodes,{queue}));}
 catch(e){return Response.json({error:(e as Error).message},{status:500});}
}
