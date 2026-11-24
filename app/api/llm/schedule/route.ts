import {schedulerAuthorized,runScheduled} from '@/app/llm/remote';
// The one model scheduler of the site lives in the worker process (RANKWIKI_ROLE=worker): the web process sends every
// model request here (127.0.0.1 only, with the shared scheduler token), so all requests share one queue per class.
export async function POST(request:Request){
 if(process.env.RANKWIKI_ROLE==='web'||!schedulerAuthorized(request))return Response.json({error:'Forbidden.'},{status:403});
 const b=await request.json().catch(()=>null) as {op?:string;request?:unknown;texts?:string[]}|null;
 if(!b)return Response.json({error:'Bad request.'},{status:400});
 try{return Response.json({ok:true,value:await runScheduled(b,request.signal)});}
 catch(e){return Response.json({ok:false,error:(e as Error).message||'failed'},{status:200});}
}
