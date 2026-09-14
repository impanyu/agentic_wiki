// Bounded data repair for a production mapping confirmed wrong in routing logs
// 457/469/472/475. This does not alter the semantic matching policy.
export async function repairKnownMappings(db:D1Database,userId:string){
 const owner='guest:c74e6ba9-d433-4d9b-a3ed-193a1d95b680';
 if(userId!==owner)return;
 const repairs=[
  {pageId:'dbe32256-5dcf-4cf3-a9b9-3bcfe921f024',question:'中国人民银行行长历任名单',title:'中国人民银行现任行长',original:'中国人民银行行长'},
  // Review log 506 incorrectly accepted a visit article as a country overview.
  {pageId:'4560e6ed-b943-45a0-8350-a6cb93530a00',question:'印度',title:'习近平访印事实',original:'习近平访问印度'},
 ];
 // Never touch an edited page, another owner, or an unrelated question/link.
 const guard="SELECT id FROM pages WHERE id=? AND owner_id=? AND title=? AND question=? AND updated_at IS NULL";
 await db.batch(repairs.flatMap(({pageId,question,title,original})=>[
  db.prepare(`DELETE FROM questions WHERE page_id IN (${guard}) AND normalized=? AND question=?`).bind(pageId,owner,title,original,question,question),
  db.prepare(`DELETE FROM internal_links WHERE target_id IN (${guard}) AND trim(quote)=? AND source_id IN (SELECT id FROM pages WHERE owner_id=?)`).bind(pageId,owner,title,original,question,owner),
 ]));
}
