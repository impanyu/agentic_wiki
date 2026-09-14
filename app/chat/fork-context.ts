import {database} from '@/db/store';
export async function removeFork(id:string,userId:string){
 const owned=await database().prepare('SELECT COALESCE(f.group_id,p.id) group_id FROM pages p LEFT JOIN page_forks f ON p.id=f.page_id WHERE p.id=? AND p.owner_id=?').bind(id,userId).first<{group_id:string}>();
 if(!owned)throw Error('Only the creator can remove this fork.');
 await database().batch([
  database().prepare('DELETE FROM internal_links WHERE source_id=? OR target_id=?').bind(id,id),
  database().prepare('DELETE FROM component_dependencies WHERE parent_id=?').bind(id),
  database().prepare('DELETE FROM pages WHERE id=? AND owner_id=?').bind(id,userId),
 ]);
 // Descendant forks keep the group ID even when their immediate parent is removed.
 const next=await database().prepare("SELECT p.id FROM page_forks f JOIN pages p ON p.id=f.page_id WHERE f.group_id=? AND (p.owner_id=? OR p.visibility='public') ORDER BY f.created_at,p.id LIMIT 1").bind(owned.group_id,userId).first<{id:string}>();
 return {removed:true,nextPageId:next?.id||null};
}
