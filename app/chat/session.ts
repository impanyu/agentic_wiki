import {database} from '@/db/store';import type {Agent} from '@/app/components-registry/agents';
export async function ensurePageSession(pageId:string,userId:string):Promise<Agent>{
 const existing=await database().prepare('SELECT a.id,a.role,a.owner_id ownerId FROM session_routes r JOIN agent_instances a ON a.id=r.session_id WHERE r.page_id=? AND r.owner_id=? AND a.owner_id=? ORDER BY r.created_at LIMIT 1').bind(pageId,userId,userId).first<Agent>();
 if(existing)return existing;
 const role='page:'+pageId,digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([userId,role])));
 const id=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
 await database().prepare('INSERT OR IGNORE INTO agent_instances(id,role,owner_id,parent_id,created_at) VALUES(?,?,?,NULL,?)').bind(id,role,userId,new Date().toISOString()).run();return {id,role,ownerId:userId};
}
export async function rememberSessionRoutes(pageId:string,userId:string,sessionId:string){
 await database().prepare("INSERT OR IGNORE INTO session_routes(id,owner_id,question_id,session_id,page_id,created_at) SELECT a.id||':'||q.id,a.owner_id,q.id,a.id,p.id,? FROM questions q JOIN pages p ON p.id=q.page_id JOIN agent_instances a ON a.id=? AND a.owner_id=? AND a.role='page:'||p.id WHERE p.id=? AND q.routing_scope='session' AND (p.visibility='public' OR p.owner_id=?)").bind(new Date().toISOString(),sessionId,userId,pageId,userId).run();
}
export async function importSessionRoutes(userId:string){
 await database().prepare("INSERT OR IGNORE INTO session_routes(id,owner_id,question_id,session_id,page_id,created_at) SELECT a.id||':'||q.id,a.owner_id,q.id,a.id,p.id,a.created_at FROM questions q JOIN pages p ON p.id=q.page_id JOIN agent_instances a ON a.role='page:'||p.id AND a.owner_id=? WHERE q.routing_scope='session' AND (p.visibility='public' OR p.owner_id=?)").bind(userId,userId).run();
}
