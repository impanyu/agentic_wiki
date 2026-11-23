import type {Queryable} from '@/app/entity-db/client';
import {createTopic,getTopic,setTopicParent} from '@/app/entity-db/repo';
import {enqueueTeam} from './manager';
// Loads a designed topic tree (docs/topic-tree.json): every node becomes a topic under its parent (existing
// topics keep their id and are moved into place), and every leaf is queued for its team with a brief drawn from
// the design (what is ranked, the full set, the criteria readers care about, likely sources). The scheduler
// starts the teams by priority within the concurrency and spending limits.
export type TreeNode={slug:string;name:string;kind?:'knowledge'|'commercial';description?:string;children?:TreeNode[];
 entity?:string;universe?:string;criteria?:string[];sources?:string[];priority?:number;scale?:string};

export function leafBrief(n:TreeNode):string{
 const lines=[n.description||n.name,
  n.entity&&`Entity: ${n.entity} (one page per ${n.entity}; this topic's main ranking ranks every ${n.entity}).`,
  n.universe&&`The full set: ${n.universe}.`,
  n.criteria?.length&&`Criteria readers care about (raw measures and at least one composite index): ${n.criteria.join('; ')}.`,
  n.sources?.length&&`Likely sources: ${n.sources.join('; ')}.`,
  n.scale&&Number(n.scale)>=1e5&&`The full source is large (about ${Number(n.scale).toLocaleString('en-US')} records): load it with bulk_import and an admission standard — store only those that can rank (top 1,000 of some ranking) or pass an objective notability threshold.`,
  n.kind==='commercial'&&'The full set is worldwide: the universe above is a starting point, not a limit — include the local brands and products of every major market (China, India, Japan, Korea, Southeast Asia, Latin America, Africa, the Middle East, Europe), found through local-language searches and local retailers and regulators.',
  n.kind==='commercial'&&'This is a commercial topic: readers come to decide what to buy. Every entity needs its official product photo and its official product or purchase page; rank on the criteria buyers compare, with a value-for-money index; add subsets by price band and use case.'];
 return lines.filter(Boolean).join('\n');
}

export async function loadTopicTree(db:Queryable,nodes:TreeNode[],{queue=true}:{queue?:boolean}={}):Promise<{topics:number;created:number;moved:number;queued:number;teams:number}>{
 let topics=0,created=0,moved=0,queued=0;
 // Teams: a leaf belongs to its parent branch's team (a leaf right under a subject is its own team); the team is
 // queued once with the briefs of the leaves it owns (it covers them one per cycle, most important first).
 const teams=new Map<string,{name:string;parentSlug:string|null;leaves:TreeNode[];priority:number}>();
 const visit=async(n:TreeNode,parentId:string|null,parentSlug:string|null,depth:number,parentName:string)=>{
  if(!n.slug||!n.name)return;
  let t=await getTopic(db,n.slug);
  if(!t){t=await createTopic(db,{slug:n.slug,name:n.name,description:n.description||'',parentId});created++;}
  else{
   await db.query('update topics set name=$2::text, description=case when $3::text <> \'\' then $3::text else description end where id=$1::uuid',[t.id,n.name,n.description||'']);
   if(t.parentId!==parentId){await setTopicParent(db,t.id,parentId);moved++;}
  }
  topics++;
  const kids=n.children||[];
  if(!kids.length){
   const team=depth>2&&parentSlug?parentSlug:t.slug;
   // A leaf spun off earlier (its own team) keeps it; otherwise it belongs to its branch.
   const current=await db.query<{team:string|null}>("select scope->>'team' team from topics where id=$1::uuid",[t.id]);
   const own=current.rows[0]?.team===t.slug&&team!==t.slug;
   const owner=own?t.slug:team;
   await db.query(`update topics set scope=coalesce(scope,'{}'::jsonb)||jsonb_build_object('team',$2::text,'priority',$3::int,'brief',$4::text) where id=$1::uuid`,[t.id,owner,n.priority||2,leafBrief(n)]);
   const g=teams.get(owner)??{name:owner===t.slug?n.name:parentName,parentSlug:owner===t.slug?parentSlug:null,leaves:[],priority:-9};
   g.leaves.push(n);g.priority=Math.max(g.priority,n.priority===1?1:n.priority===3?-1:0);teams.set(owner,g);
   return;
  }
  for(const c of kids)await visit(c,t.id,t.slug,depth+1,n.name);
 };
 for(const n of nodes)await visit(n,null,null,1,'');
 if(queue)for(const [slug,g] of teams){
  // A leaf that is its own team keeps its own brief; a branch team gets the list of what it covers.
  const brief=g.leaves.length===1&&g.leaves[0].slug===slug?leafBrief(g.leaves[0]):'This team covers the '+g.leaves.length+' subtopics of "'+g.name+'", one per cycle, most important first: '+g.leaves.slice(0,40).map(l=>l.name).join('; ')+'.';
  if(await enqueueTeamOnce(db,{slug,name:g.name,brief,parentSlug:g.parentSlug,priority:g.priority}))queued++;
 }
 return {topics,created,moved,queued,teams:teams.size};
}
async function enqueueTeamOnce(db:Queryable,team:{slug:string;name:string;brief:string;parentSlug:string|null;priority:number}):Promise<boolean>{
 const seen=await db.query('select 1 from team_queue where slug=$1::text union all select 1 from team_runs r join topics t on t.id=r.topic_id where t.slug=$1::text limit 1',[team.slug]);
 if(seen.rows.length)return false;
 return enqueueTeam(db,{...team,note:'topic tree'});
}
