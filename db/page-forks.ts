// Only explicitly created forks share a family. Question collisions are not forks.
export const pageForksSql=`SELECT p.id,p.title,p.visibility,p.created_at createdAt,
 (p.owner_id=?) removable,
 (f.parent_id IS NULL) isOriginal
 FROM page_forks origin JOIN page_forks f ON f.group_id=origin.group_id
 JOIN pages p ON p.id=f.page_id JOIN pages original ON original.id=origin.page_id
 WHERE origin.page_id=? AND (original.visibility='public' OR original.owner_id=?)
 AND (p.visibility='public' OR p.owner_id=?) ORDER BY f.created_at,p.id`;
