import {getActor} from '@/app/actor';
import {reply,sameOrigin} from '@/db/store';
import {listNotes,addNote,changeNote,removeNote} from '@/app/papers/notes';
// The visiting reader's own highlights and notes on this page's paper PDFs.
type Ctx={params:Promise<{id:string}>};
const failure=(e:unknown)=>{const m=e instanceof Error?e.message:'';return m==='NOT_FOUND'?reply({error:'This page or note does not exist.'},404):m==='LIMIT'?reply({error:'This page already has the maximum of 2,000 notes.'},400):reply({error:'The note request is invalid.'},400);};
export async function GET(request:Request,{params}:Ctx){const a=await getActor(request);try{return a.finish(reply({notes:await listNotes((await params).id,a.userId,new URL(request.url).searchParams.get('document')||'')}));}catch(e){return a.finish(failure(e));}}
async function write(request:Request,{params}:Ctx,run:(pageId:string,userId:string,body:any)=>Promise<unknown>){const a=await getActor(request);if(!sameOrigin(request))return a.finish(reply({error:'This request must come from the site.'},403));try{return a.finish(reply({result:await run((await params).id,a.userId,await request.json())}));}catch(e){return a.finish(failure(e));}}
export const POST=(r:Request,c:Ctx)=>write(r,c,(p,u,b)=>addNote(p,u,b));
export const PATCH=(r:Request,c:Ctx)=>write(r,c,(p,u,b)=>changeNote(p,u,b));
export const DELETE=(r:Request,c:Ctx)=>write(r,c,(p,u,b)=>removeNote(p,u,String(b?.id||'')));
