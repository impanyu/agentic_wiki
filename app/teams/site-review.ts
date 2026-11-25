import {entityDb} from '@/app/entity-db/client';
import {spawnAgent} from '@/app/agents/runtime';
import {ask,OWNER,type Log} from './agent-call';
import {raiseIssue} from '@/app/ops/issues';
// The site reviewer: one independent reader of the whole site, apart from the topic teams (each team reviews only its
// own pages). It walks the topic tree one topic at a time, oldest-reviewed first, opens the pages as a reader does
// (view_page: screenshots and text) and judges what a team cannot see from inside: whether the topic is divided
// right (one criterion, no overlap, nothing missing), whether the set is complete (every member that could reach the
// top 1,000), whether members' attributes are complete, and whether every page works (no empty or duplicate rankings,
// names link to their pages). Findings become issues (admin, the operators) and, for what a team can fix, a review
// of that team.
const SITE_REVIEW=`You are RankWiki's site-wide reviewer. RankWiki ranks everything (countries, cities, national parks, products, people…) for readers worldwide. You review ONE topic as a demanding reader and as the editor-in-chief of a large reference site, using your tools: open the topic page with view_page (its path is given), its "Narrow down" subsets, 2–3 other criteria (?rank=) and 3–5 entity pages (a leader, a small one, one with gaps); team_state, coverage and quality_check show the data behind them.
Judge, with evidence from what you opened:
1. Division (the tree). The topic's subtopics divide its entities by ONE criterion, an attribute of the entities themselves (countries by continent; laptops by form factor). Together they cover the topic and do not overlap. A subtopic chosen by another criterion (smart cities, capital cities, budget phones, award winners) should be an interface (tag), not a subtopic; a theme of measures (economy, education) is never a subset, it is criteria in "Rank by"; a subtopic of a different kind or level of thing belongs elsewhere. Say exactly what to change.
2. Completeness of the set. Does the topic include every member a reader expects — at least every one that could reach the top 1,000 (all of them when fewer)? Compare with what you know (e.g. ~195 sovereign countries; the US has 63 national parks) and with the leaders readers expect to see. Name missing well-known members.
3. Completeness of the narrow-down. Are the subsets readers expect there (every continent; the countries where most members are)? Name missing ones.
4. Completeness of each member. On entity pages: are the basic attributes there (for a country: continent, capital, flag; for a park: country, area, year established) and are the main criteria measured?
5. Pages. Empty rankings, duplicate rankings, a ranking opening on a criterion with no data, names that do not link, wrong or implausible leaders (check the top 3 against common knowledge), mixed classifications (two standards for one attribute), untranslated or garbled text.
Report only real problems a reader would notice or that make the site wrong, each with the exact page or slug, what is wrong, and the fix. area: "tree" (division, subtopics, interfaces), "set" (missing members), "data" (values, attributes, sources), "page" (layout, links, empty or duplicate pages). blocker: the page is wrong or empty; major: clearly incomplete or misleading; minor: polish.`;
const SCHEMA={type:'object',additionalProperties:false,required:['issues','summary'],properties:{
 issues:{type:'array',items:{type:'object',additionalProperties:false,required:['severity','area','target','problem','fix'],properties:{
  severity:{type:'string',enum:['blocker','major','minor']},area:{type:'string',enum:['tree','set','data','page']},
  target:{type:'string'},problem:{type:'string'},fix:{type:'string'}}}},
 summary:{type:'string'}}};

let running=false;
// The topic reviewed longest ago (never first) among those readers can see (a published ranking), and reviews it.
export async function siteReviewOnce(log:Log=()=>{}):Promise<{topic:string;issues:number}|null>{
 if(running)return null;running=true;
 try{
  const db=await entityDb();
  const t=(await db.query<{id:string;slug:string;name:string;description:string;division:string|null}>(`select t.id, t.slug, t.name, t.description, t.scope->>'division' division from topics t
   where t.status <> 'archived' and exists (select 1 from rankings r where r.topic_id = t.id and r.status = 'published')
   order by (t.scope->>'siteReviewedAt') nulls first, t.scope->>'siteReviewedAt' limit 1`)).rows[0];
  if(!t)return null;
  await db.query(`update topics set scope = coalesce(scope,'{}'::jsonb) || jsonb_build_object('siteReviewedAt', now()::text) where id = $1::uuid`,[t.id]);
  const {pathMaps,nodeChildren}=await import('@/app/entity-db/pages');
  const maps=await pathMaps(db);const path=maps.topics.get(t.slug)||'/rankings/'+t.slug;
  const subtopics=(await db.query(`select c.slug, c.name, (select count(*)::int from entity_types et join entities e on e.type = et.type where et.topic_id = c.id) entities
   from topics c where c.parent_id = $1::uuid and c.status <> 'archived' order by c.slug`,[t.id])).rows;
  const interfaces=(await db.query(`select type, label, schema->>'appliesTo' applies_to from entity_types where topic_id = $1::uuid and schema->>'kind' = 'interface'`,[t.id])).rows;
  const rankings=(await db.query(`select slug, title, status, scope from rankings where topic_id = $1::uuid and status <> 'archived' order by slug limit 80`,[t.id])).rows;
  const agent=await spawnAgent('site-reviewer',OWNER);
  const verdict=await ask('reviewer',agent,t.id,SITE_REVIEW,{topic:t.slug,name:t.name,path,division:t.division||'',subtopics,interfaces,rankings,
   narrowDown:nodeChildren(maps,path).map(n=>({name:n.name,href:n.href}))},SCHEMA,log,{rounds:40,calls:60},undefined,
   ['view_page','preview_page','team_state','coverage','quality_check']) as {issues:{severity:'blocker'|'major'|'minor';area:string;target:string;problem:string;fix:string}[];summary:string};
  const issues=(verdict?.issues||[]).slice(0,30);
  for(const i of issues)await raiseIssue(db,{source:'site-review',topic:t.slug,severity:i.severity,title:`[${i.area}] ${i.target}: ${i.problem}`.slice(0,300),detail:'Fix: '+i.fix});
  // What the topic's team can fix (members, data, pages) goes to it as a review; the tree is the manager's.
  const team=issues.filter(i=>i.area!=='tree'&&i.severity!=='minor');
  if(team.length){const {teamOf}=await import('./ownership');const {enqueueTeam}=await import('./manager');const owner=await teamOf(db,t.slug);
   await enqueueTeam(db,{slug:owner,name:t.name,brief:t.description||t.name,priority:2,note:'review: site reviewer found '+team.map(i=>`${i.target}: ${i.problem} → ${i.fix}`).join(' | ').slice(0,1500)});}
  log({event:'site_review',topic:t.slug,issues:issues.length,summary:String(verdict?.summary||'').slice(0,300)});
  return {topic:t.slug,issues:issues.length};
 }finally{running=false;}
}
