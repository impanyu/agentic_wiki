import type {Queryable} from '@/app/entity-db/client';
// Counts calls to external services (search providers, public data APIs) per day, never blocking the call itself.
// Models are counted separately (llm_usage, with tokens and cost).
export async function recordServiceCall(service:string,ok:boolean,db?:Queryable){
 try{
  const q=db??await (await import('@/app/entity-db/client')).entityDb();
  await q.query(`insert into service_usage(day,service,calls,errors) values (current_date,$1::text,1,$2::int)
   on conflict (day,service) do update set calls=service_usage.calls+1, errors=service_usage.errors+excluded.errors`,[service.slice(0,80),ok?0:1]);
 }catch{/* counting never breaks a call */}
}
export async function callsToday(service:string):Promise<number>{
 try{const db=await (await import('@/app/entity-db/client')).entityDb();
  return Number((await db.query<{n:number}>('select calls n from service_usage where day=current_date and service=$1::text',[service])).rows[0]?.n||0);}
 catch{return 0;}
}
