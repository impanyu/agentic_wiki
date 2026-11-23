import {entityDb} from '@/app/entity-db/client';
import {poolAuthorized} from '../auth';
// A pool worker returns the answer to a request it claimed: the raw Chat Completions response, or an error.
export async function POST(request:Request){
 if(!poolAuthorized(request))return Response.json({error:'Forbidden.'},{status:403});
 const b=await request.json().catch(()=>({})) as {worker?:string;id?:string;ok?:boolean;response?:unknown;error?:string};
 if(!/^[0-9a-f-]{36}$/.test(String(b.id||'')))return Response.json({error:'id is required.'},{status:400});
 const db=await entityDb();
 const r=await db.query(`update llm_jobs set status=$3::text, result=$4::jsonb, error=$5::text, finished_at=now() where id=$1::uuid and claimed_by=$2::text and status='claimed' returning 1`,
  [b.id,String(b.worker||''),b.ok?'done':'failed',b.ok?JSON.stringify(b.response??null):null,b.ok?null:String(b.error||'failed').slice(0,2000)]);
 return Response.json({saved:r.rows.length>0});
}
