import {entityDb} from '@/app/entity-db/client';
// A reader reports a wrong value or a problem on a page, or asks for something to be taken down. The report goes to
// the work queue (app/work/triggers.ts): a data error to the class's collectors, a page problem to its editors, a
// takedown request to the operators.
export const dynamic='force-dynamic';
const recent=new Map<string,number[]>();
export async function POST(request:Request){
 const ip=request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'local';
 const now=Date.now(),times=(recent.get(ip)||[]).filter(t=>now-t<3600_000);
 if(times.length>=10)return Response.json({error:'Too many reports; try again later.'},{status:429});
 recent.set(ip,[...times,now]);
 const b=await request.json().catch(()=>({})) as {path?:string;kind?:string;text?:string};
 const path=String(b.path||'').slice(0,500),text=String(b.text||'').trim().slice(0,4000),kind=['error','takedown','other'].includes(String(b.kind))?String(b.kind):'other';
 if(!path.startsWith('/')||text.length<5)return Response.json({error:'Give the page (path) and what is wrong (text).'},{status:400});
 const db=await entityDb();
 // What the page is: an entity page names its class; a ranking or topic page names its page.
 let cls:string|null=null,page:string|null=null;
 const num=/^\/e\/(\d+)\//.exec(path)?.[1];
 if(num)cls=(await db.query<{type:string}>('select type from entities where num=$1::bigint',[num])).rows[0]?.type??null;
 else{const {pathMaps}=await import('@/app/entity-db/pages');const n=(await pathMaps(db)).nodes.get(path.split('?')[0]);
  page=n?.kind==='ranking'?(await db.query<{slug:string}>('select t.slug from rankings r join topics t on t.id=r.topic_id where r.slug=$1::text',[n.slug])).rows[0]?.slug??null:n?.slug??null;}
 await db.query('insert into reader_reports(path,kind,text,class,page) values ($1,$2,$3,$4,$5)',[path,kind,text,cls,page]);
 return Response.json({ok:true});
}
