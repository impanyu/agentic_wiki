import type {Queryable} from '@/app/entity-db/client';
// Dividing a field and staffing it are two decisions. Every topic records the team that owns it (topics.scope.team,
// a topic slug): a team node owns itself; a subtopic belongs to its parent's team until the manager spins it off with
// a team of its own (when its demand or its branch's backlog calls for it). A team works through the subtopics it owns,
// one focus subtopic per cycle, most important first, and queues itself again while some are not covered yet.
export async function teamOf(db:Queryable,slug:string):Promise<string>{
 const r=await db.query<{team:string|null}>("select scope->>'team' team from topics where slug=$1::text",[slug]);
 return r.rows[0]?.team||slug;
}
export async function setTeam(db:Queryable,slug:string,team:string){
 await db.query(`update topics set scope=jsonb_set(coalesce(scope,'{}'::jsonb),'{team}',to_jsonb($2::text)), updated_at=now() where slug=$1::text`,[slug,team]);
}
// The leaves a team owns that have no main ranking yet (draft or published), most important first.
export async function uncovered(db:Queryable,team:string):Promise<{slug:string;name:string;description:string;priority:number}[]>{
 const r=await db.query<{slug:string;name:string;description:string;priority:number}>(`select t.slug, t.name, t.description, coalesce((t.scope->>'priority')::int, 2) priority
  from topics t where t.status <> 'archived' and t.scope->>'team' = $1::text
   and not exists (select 1 from topics c where c.parent_id = t.id and c.status <> 'archived')
   and not exists (select 1 from rankings r where r.topic_id = t.id)
  order by coalesce((t.scope->>'priority')::int, 2), t.created_at`,[team]);
 return r.rows;
}
export async function ownedCount(db:Queryable,team:string):Promise<number>{
 return Number((await db.query<{n:number}>("select count(*)::int n from topics where status <> 'archived' and scope->>'team' = $1::text",[team])).rows[0]?.n||0);
}
