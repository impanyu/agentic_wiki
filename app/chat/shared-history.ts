import {database} from '@/db/store';

// Only user/agent conversation turns are published, never operational agent memory.
export const legacyCommentsSql=`INSERT OR IGNORE INTO wiki_comments(page_id,session_id,author_name,message,reply,created_at,legacy_key)
 SELECT p.id,a.id,CASE WHEN a.owner_id=? THEN ? WHEN a.owner_id LIKE 'guest:%' THEN 'Guest' ELSE 'Member' END,
 t.message,t.reply,t.created_at,'turn:'||t.sequence
 FROM page_chat_turns t JOIN agent_instances a ON a.id=t.session_id JOIN pages p ON a.role='page:'||p.id
 WHERE p.id=? AND (p.visibility='public' OR p.owner_id=?) ORDER BY t.created_at,t.sequence`;
export const legacyMemorySql=`INSERT OR IGNORE INTO wiki_comments(page_id,session_id,author_name,message,reply,created_at,legacy_key)
 SELECT p.id,a.id,CASE WHEN a.owner_id=? THEN ? WHEN a.owner_id LIKE 'guest:%' THEN 'Guest' ELSE 'Member' END,
 substr(m.action,7),json_extract(m.result,'$.reply'),m.created_at,'memory:'||m.sequence
 FROM agent_memory m JOIN agent_instances a ON a.id=m.agent_id JOIN pages p ON a.role='page:'||p.id
 WHERE p.id=? AND (p.visibility='public' OR p.owner_id=?) AND m.action LIKE 'User: %'
 AND json_valid(m.result) AND json_type(m.result,'$.reply')='text'
 AND NOT EXISTS(SELECT 1 FROM page_chat_turns t WHERE t.session_id=a.id)
 ORDER BY m.created_at,m.sequence`;
export async function importLegacyComments(pageId:string,userId:string,userName:string){
 await database().batch([
  database().prepare(legacyCommentsSql).bind(userId,userName,pageId,userId),
  database().prepare(legacyMemorySql).bind(userId,userName,pageId,userId),
  database().prepare('UPDATE wiki_comments SET author_name=? WHERE page_id=? AND session_id IN (SELECT id FROM agent_instances WHERE owner_id=?) AND legacy_key IS NOT NULL').bind(userName,pageId,userId),
 ]);
}
