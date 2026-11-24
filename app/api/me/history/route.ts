import {sameOrigin} from '@/db/store';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {entityDb} from '@/app/entity-db/client';
// A signed-in reader opened a page: it goes to their history (their profile lists it). Anonymous visits stay in the
// browser only.
export const dynamic='force-dynamic';
export async function POST(request:Request){
 if(!sameOrigin(request))return new Response(null,{status:403});
 const user=await getChatGPTUser().catch(()=>null);if(!user)return new Response(null,{status:204});
 const b=await request.json().catch(()=>({})) as {href?:unknown;title?:unknown;kind?:unknown};
 const href=String(b.href||''),title=String(b.title||'').slice(0,300),kind=String(b.kind||'');
 if(!href.startsWith('/')||href.length>600||!title||!['ranking','entity','topic'].includes(kind))return new Response(null,{status:400});
 const db=await entityDb();
 await db.query(`insert into reader_history(user_id,href,title,kind,at) values ($1::text,$2::text,$3::text,$4::text,now())
  on conflict (user_id,href) do update set title=excluded.title, kind=excluded.kind, at=now()`,[user.userId,href,title,kind]);
 return new Response(null,{status:204});
}
