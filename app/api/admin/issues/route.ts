import {getChatGPTUser} from '@/app/chatgpt-auth';
import {sameOrigin} from '@/db/store';
import {isAdmin} from '@/app/ops/admin';
import {resolveIssue} from '@/app/ops/issues';
import {entityDb} from '@/app/entity-db/client';
// Administrators resolve, ignore or reopen an issue; who did it and the note stay on the record.
export const dynamic='force-dynamic';
export async function POST(request:Request){
 if(!sameOrigin(request))return Response.json({error:'Invalid origin.'},{status:403});
 const user=await getChatGPTUser();if(!isAdmin(user))return Response.json({error:'Not allowed.'},{status:403});
 const b=await request.json().catch(()=>({})) as {id?:unknown;status?:unknown;resolution?:unknown};
 const id=Number(b.id),status=String(b.status);
 if(!Number.isInteger(id)||!['resolved','ignored','open'].includes(status))return Response.json({error:'Give an issue id and a status.'},{status:400});
 await resolveIssue(await entityDb(),id,{status:status as 'resolved'|'ignored'|'open',resolution:String(b.resolution||''),by:user!.email});
 return Response.json({ok:true});
}
