import {database} from '@/db/store';
// In the public edition a generated page is public from the start, so the components
// it was built from (except credentials) become public too, as publishing a page does.
export async function publishDependencies(pageId:string,ownerId:string){
 const deps=await database().prepare(`WITH RECURSIVE deps(id) AS (SELECT component_id FROM component_dependencies WHERE parent_id=? UNION SELECT d.component_id FROM component_dependencies d JOIN deps ON d.parent_id=deps.id) SELECT c.id FROM components c JOIN deps ON deps.id=c.id WHERE c.visibility='private' AND c.owner_id=? AND c.type<>'credential'`).bind(pageId,ownerId).all<{id:string}>();
 if(deps.results.length)await database().batch(deps.results.flatMap(d=>[
  database().prepare("UPDATE components SET visibility='public' WHERE id=? AND owner_id=?").bind(d.id,ownerId),
  database().prepare("UPDATE OR REPLACE component_questions SET scope='public' WHERE component_id=?").bind(d.id),
 ]));
}
