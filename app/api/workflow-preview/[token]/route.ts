import {takePreview} from '@/app/workflows/preview-store';
// Snapshot for the verification browser only: a random, short-lived token, no session.
export async function GET(_:Request,{params}:{params:Promise<{token:string}>}){
 const token=(await params).token;
 if(!/^[a-f0-9]{64}$/.test(token))return Response.json({error:'Not found.'},{status:404});
 const s=takePreview(token);if(!s)return Response.json({error:'Not found.'},{status:404});
 return Response.json({workflow:s.workflow,state:s.state,values:s.values,title:s.title,pageId:s.pageId},{headers:{'Cache-Control':'no-store'}});
}
