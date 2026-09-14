// Each routing agent owns a separate logical table in the question pool.
// Wiki questions and session questions never compete; root_routes is independent.
export type RoutingScope='wiki'|'session'|'app';
export const routingScopeRepairSql=`UPDATE questions SET routing_scope=CASE WHEN p.kind='static' THEN 'wiki' ELSE COALESCE(json_extract(p.dynamic_config,'$.contextDomain'),CASE WHEN json_extract(p.dynamic_config,'$.template')='agent-chat-v1' THEN 'session' ELSE 'app' END) END FROM pages p WHERE p.id=questions.page_id AND (p.visibility='public' OR p.owner_id=?) AND routing_scope<>CASE WHEN p.kind='static' THEN 'wiki' ELSE COALESCE(json_extract(p.dynamic_config,'$.contextDomain'),CASE WHEN json_extract(p.dynamic_config,'$.template')='agent-chat-v1' THEN 'session' ELSE 'app' END) END`;
export async function ensureRoutingScopes(db:D1Database,userId:string){await db.prepare(routingScopeRepairSql).bind(userId).run();}

export const importWikiRoutesSql="INSERT INTO wiki_routes(question_id,page_id) SELECT q.id,p.id FROM questions q JOIN pages p ON p.id=q.page_id WHERE q.routing_scope='wiki' AND p.kind='static' AND (p.owner_id=? OR p.visibility='public') ON CONFLICT(question_id) DO UPDATE SET page_id=excluded.page_id";
export async function importWikiRoutes(db:D1Database,userId:string){await db.prepare(importWikiRoutesSql).bind(userId).run();}
