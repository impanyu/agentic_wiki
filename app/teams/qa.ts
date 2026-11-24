// Quality gate: program checks every ranking of a topic must pass before it is published. They run in every review
// (their findings are binding issues for their owners, whatever the reviewer concludes) and are offered to the team
// as a tool (quality_check) so the collector and editor can see them before the review does.
import type {Queryable} from '@/app/entity-db/client';
import {listRankingDefs,type RankingDef} from './config';

export type QaIssue={severity:'blocker'|'major';owner:'collector'|'editor';target:string;problem:string;fix:string};

// The minimum a published ranking needs: enough entities to be a ranking, and each criterion measured for most of them.
export const QA={minEntities:10,minCriterionCoverage:0.6,maxCountryShare:0.6};

// Names a title may use for a country (a ranking limited to one country must say so in its title).
const ALIASES:Record<string,string[]>={'United States':['US','U.S.','USA','American','America'],'United Kingdom':['UK','U.K.','British','Britain','England','Scotland','Wales'],
 'China':['Chinese','PRC'],'Japan':['Japanese'],'Germany':['German'],'France':['French'],'India':['Indian'],'Canada':['Canadian'],'Australia':['Australian'],
 'South Korea':['Korea','Korean'],'Russia':['Russian'],'Brazil':['Brazilian'],'Mexico':['Mexican'],'Italy':['Italian'],'Spain':['Spanish']};
const named=(title:string,country:string)=>[country,...(ALIASES[country]||[])].some(n=>new RegExp('(^|[^A-Za-z])'+n.replace(/[.]/g,'\\.')+'([^A-Za-z]|$)','i').test(title));

type Filter={where:string;args:unknown[]};
// The ranking's membership: its type, narrowed by attribute filters ({"country":"United Kingdom"}, or a list of values).
function membership(def:RankingDef):Filter|null{
 const type=def.scope?.type;if(!type)return null;
 const args:unknown[]=[type];const parts=['e.type=$1::text'];
 for(const [k,v] of Object.entries(def.scope.filters||{})){
  if(v===null||v===undefined||v==='')continue;
  const values=(Array.isArray(v)?v:[v]).map(String);if(!values.length)continue;
  args.push(k,values);parts.push(`e.attributes->>$${args.length-1}::text = any($${args.length}::text[])`);
 }
 return {where:parts.join(' and '),args};
}

export async function checkRanking(db:Queryable,def:RankingDef):Promise<QaIssue[]>{
 const m=membership(def);const t=def.slug;const out:QaIssue[]=[];
 if(!m)return [{severity:'blocker',owner:'editor',target:t,problem:'The ranking has no entity type in its scope.',fix:'save_ranking with scope.type.'}];
 const n=Number((await db.query<{n:number}>(`select count(*)::int n from entities e where ${m.where}`,m.args)).rows[0]?.n||0);
 if(n<QA.minEntities)out.push({severity:'blocker',owner:'collector',target:t,problem:`Only ${n} entities are in this ranking's set (at least ${QA.minEntities} needed).`,fix:'Load the full universe of this type (every market and source), or the editor drops or merges this ranking.'});
 if(!n)return out;
 // Each criterion measured for most of the ranked entities.
 const keys=[...new Set(def.criteria.map(k=>String(k).split('@')[0]).filter(Boolean))];
 if(keys.length){
  const cov=(await db.query<{metric:string;n:number}>(`select o.metric, count(distinct o.entity_id)::int n from observations o join entities e on e.id=o.entity_id where ${m.where} and o.metric = any($${m.args.length+1}::text[]) group by o.metric`,[...m.args,keys])).rows;
  for(const k of keys){const have=cov.find(c=>c.metric===k)?.n||0;const share=have/n;
   // The criterion the ranking opens on, or one barely measured, leaves readers a list of "no data": a blocker.
   const main=k===String(def.config?.default||keys[0]).split('@')[0];
   if(share<QA.minCriterionCoverage)out.push({severity:main||share<0.2?'blocker':'major',owner:'collector',target:t+' → '+k,problem:`Criterion ${k} is measured for ${have} of ${n} entities (${Math.round(share*100)}%; at least ${Math.round(QA.minCriterionCoverage*100)}% needed).`,fix:'Collect it for the missing entities (other sources and markets), or the editor drops it from this ranking.'});}
 }
 // The grouping attribute (config.group: country, region, category…) known for nearly every entity, or the groups mislead.
 const group=typeof def.config?.group==='string'?def.config.group:'';
 if(group){const g=Number((await db.query<{n:number}>(`select count(*)::int n from entities e where ${m.where} and coalesce(e.attributes->>$${m.args.length+1}::text,'')<>''`,[...m.args,group])).rows[0]?.n||0);
  if(g<0.8*n)out.push({severity:'major',owner:'collector',target:t+' → '+group,problem:`The grouping attribute ${group} is known for ${g} of ${n} entities (${Math.round(g/n*100)}%; at least 80% needed).`,fix:'Fill the attribute for every entity (from the universe source or another), or the editor removes the grouping.'});}
 // Each criterion carries its history: a measured metric with one or two periods although its source (or another)
 // offers earlier years, and nobody declared that no history exists (declare_no_history).
 if(keys.length){const {coverage}=await import('./tools');
  const gaps=(await coverage(def.scope.type!,keys.join(','),0)).historyGaps;
  for(const g of gaps)out.push({severity:'major',owner:'collector',target:t,problem:g,fix:'Load the earlier years in the metric\'s recipe, or declare_no_history naming the sources checked.'});}
 // A ranking not limited to a country must not be one country's data under a worldwide title.
 if(!def.scope.filters||!Object.keys(def.scope.filters).some(k=>/country|iso/i.test(k))){
  const rows=(await db.query<{c:string;n:number}>(`select e.attributes->>'country' c, count(*)::int n from entities e where ${m.where} and e.attributes ? 'country' group by 1 order by 2 desc limit 3`,m.args)).rows;
  const withCountry=rows.reduce((a,r)=>a+r.n,0),total=Number((await db.query<{n:number}>(`select count(*)::int n from entities e where ${m.where} and e.attributes ? 'country'`,m.args)).rows[0]?.n||0);
  const top=rows[0];
  if(top&&total>=0.8*n&&top.n/total>QA.maxCountryShare&&!named(def.title,top.c)){
   const share=Math.round(top.n/total*100);void withCountry;
   out.push({severity:'blocker',owner:'collector',target:t,problem:`${share}% of this ranking's entities are in ${top.c}, but its title ("${def.title}") presents it as covering everywhere.`,fix:`Collect the other countries' entities and data (each major market's own sources), so the ranking covers what its title says.`});
   out.push({severity:'blocker',owner:'editor',target:t,problem:`The ranking's title presents ${share}% ${top.c} data as a general ranking.`,fix:`Until the collector covers the other markets, limit the ranking to ${top.c} (scope.filters country, and the title names it), and keep the general ranking unpublished.`});
  }
 }
 return out;
}

// Every ranking of the topic, plus the topic's own page: a topic whose rankings exist must have a main ranking ready.
export async function checkTopic(db:Queryable,topicId:string):Promise<{issues:QaIssue[];failing:string[]}>{
 const defs=await listRankingDefs(db,{topicId});const issues:QaIssue[]=[];const failing=new Set<string>();
 for(const d of defs){const x=await checkRanking(db,d).catch(e=>[{severity:'major' as const,owner:'collector' as const,target:d.slug,problem:'Quality check failed: '+(e as Error).message.slice(0,200),fix:'Check the ranking scope and data.'}]);
  if(x.length)failing.add(d.slug);issues.push(...x);}
 return {issues,failing:[...failing]};
}

// The whole site, on a schedule. Readers see published rankings and, while a topic is being built, its drafts; a
// ranking that fails a blocker of the gate is "held" instead (readers never see it) and its team is queued for a
// review that fixes it. A held ranking that passes again returns to draft. Returns what it did.
export async function qaSweep(db:Queryable,log:(e:Record<string,unknown>)=>void=()=>{}):Promise<{checked:number;held:string[];released:string[];queued:string[]}>{
 const defs=(await listRankingDefs(db)).filter(d=>['published','draft','held'].includes(d.status));
 const held:string[]=[],released:string[]=[];const topics=new Map<string,string[]>();
 for(const d of defs){
  const issues=await checkRanking(db,d).catch(()=>null);if(!issues)continue;
  const blocked=issues.some(x=>x.severity==='blocker');
  if(blocked&&d.status!=='held'){await db.query(`update rankings set status='held', updated_at=now() where slug=$1::text`,[d.slug]);held.push(d.slug);
   if(d.topicId)topics.set(d.topicId,[...(topics.get(d.topicId)||[]),d.slug]);}
  else if(!blocked&&d.status==='held'){await db.query(`update rankings set status='draft', updated_at=now() where slug=$1::text`,[d.slug]);released.push(d.slug);}
 }
 const queued:string[]=[];
 const {teamOf}=await import('./ownership');const {enqueueTeam}=await import('./manager');
 for(const [topicId,slugs] of topics){
  const t=(await db.query<{slug:string;name:string;description:string}>('select slug, name, description from topics where id=$1::uuid',[topicId])).rows[0];if(!t)continue;
  const owner=await teamOf(db,t.slug);
  const name=owner===t.slug?t.name:String((await db.query<{name:string}>('select name from topics where slug=$1::text',[owner])).rows[0]?.name||t.name);
  if(await enqueueTeam(db,{slug:owner,name,brief:t.description,priority:2,note:'review: quality gate failed for '+slugs.slice(0,5).join(', ')+' ['+t.slug+']'}))queued.push(owner);
 }
 if(held.length||released.length)log({event:'qa_sweep',checked:defs.length,held,released,queued});
 return {checked:defs.length,held,released,queued};
}
