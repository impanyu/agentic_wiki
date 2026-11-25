// Quality gate: program checks every ranking of a topic must pass before it is published. They run in every review
// (their findings are binding issues for their owners, whatever the reviewer concludes) and are offered to the team
// as a tool (quality_check) so the collector and editor can see them before the review does.
import type {Queryable} from '@/app/entity-db/client';
import {listRankingDefs,type RankingDef} from './config';

export type QaIssue={severity:'blocker'|'major';owner:'collector'|'editor';target:string;problem:string;fix:string};

// The minimum a published ranking needs: enough entities to be a ranking, and each criterion measured for most of them.
export const QA={minEntities:1,minCriterionCoverage:0.6,maxCountryShare:0.6};

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
  // Rank what there is: a ranking leaves readers only when none of its entities has any of its criteria.
  if(!cov.some(c=>c.n>0))out.push({severity:'blocker',owner:'collector',target:t,problem:'None of this ranking\'s entities has a value for any of its criteria.',fix:'Collect its criteria.'});
  for(const k of keys){const have=cov.find(c=>c.metric===k)?.n||0;const share=have/n;
   // The criterion the ranking opens on, or one barely measured, leaves readers a list of "no data": a blocker.
   const main=k===String(def.config?.default||keys[0]).split('@')[0];
   // Only the criterion the ranking opens on can take the ranking away from readers (fewer than minEntities
   // ranked on it); any other criterion just ranks the members that have it, and gaps go to the collector.
   if(main&&have<3)out.push({severity:'major',owner:'collector',target:t+' → '+k,problem:`The ranking opens on ${k}, which only ${have} of its ${n} entities have.`,fix:'Collect it, or the editor opens the ranking on a criterion most entities have (config.default).'});
   else if(share<QA.minCriterionCoverage)out.push({severity:'major',owner:'collector',target:t+' → '+k,problem:`Criterion ${k} is measured for ${have} of ${n} entities (${Math.round(share*100)}%; at least ${Math.round(QA.minCriterionCoverage*100)}% needed).`,fix:'Collect it for the missing entities (other sources and markets), or the editor drops it from this ranking.'});}
 }
 // Indices among the criteria: a stated method naming every input, and every input measured for most entities (an
 // index computed from a few inputs, or from inputs most entities lack, is not what its name says).
 if(keys.length){
  const idx=(await db.query<{key:string;methodology:string;definition:Record<string,unknown>|null}>(`select distinct on (key) key, methodology, definition from metrics where kind='derived' and key=any($1::text[]) order by key, version desc`,[keys])).rows;
  for(const x of idx){
   const inputs=[...new Set((JSON.stringify(x.definition||{}).match(/"(?:metric|key|input)"\s*:\s*"([a-z0-9_]+)"/g)||[]).map(v=>v.replace(/.*"([a-z0-9_]+)"$/,'$1')).filter(k=>k!==x.key))];
   if(String(x.methodology||'').trim().length<120)out.push({severity:'major',owner:'editor',target:t+' → '+x.key,problem:`Index ${x.key} has no stated method (methodology under 120 characters).`,fix:'Define the method: what it measures, each input, weights, normalization, how missing inputs are handled.'});
   if(inputs.length){
    const cov=(await db.query<{metric:string;n:number}>(`select o.metric, count(distinct o.entity_id)::int n from observations o join entities e on e.id=o.entity_id where ${m.where} and o.metric = any($${m.args.length+1}::text[]) group by o.metric`,[...m.args,inputs])).rows;
    for(const k of inputs){const have=cov.find(c=>c.metric===k)?.n||0;
     if(have<QA.minCriterionCoverage*n)out.push({severity:'major',owner:'collector',target:t+' → '+x.key+' ← '+k,problem:`Input ${k} of index ${x.key} is measured for ${have} of ${n} entities.`,fix:'The collector collects the input for the missing entities, or the editor redefines the index with inputs that exist for most entities.'});}
   }
  }
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
 // A ranking not limited to a country must not be one country's data under a worldwide title. The country is read
 // from any of the usual attributes, so leaving out "country" does not skip the check.
 // Only for types whose schema (its own, inherited along the topic tree, or from an interface) declares a country:
 // a protein or a chemical element has none and is never asked for one.
 const {effectiveType}=await import('@/app/entity-db/inherit');
 const attrs=((await effectiveType(db,def.scope.type!)).schema.attributes as unknown[]||[]).map(a=>typeof a==='string'?a:String((a as {key?:string})?.key??''));
 const placeBound=attrs.some(k=>/^(country|country_code|iso2|iso3)$/i.test(k));
 if(placeBound&&(!def.scope.filters||!Object.keys(def.scope.filters).some(k=>/country|iso|market/i.test(k)))){
  const C="coalesce(nullif(e.attributes->>'country',''),nullif(e.attributes->>'country_code',''),nullif(e.attributes->>'iso2',''),nullif(e.attributes->>'iso3',''))";
  const rows=(await db.query<{c:string;n:number}>(`select ${C} c, count(*)::int n from entities e where ${m.where} and ${C} is not null group by 1 order by 2 desc limit 3`,m.args)).rows;
  const total=Number((await db.query<{n:number}>(`select count(*)::int n from entities e where ${m.where} and ${C} is not null`,m.args)).rows[0]?.n||0);
  const top=rows[0];
  if(top&&total>=0.8*n&&top.n/total>QA.maxCountryShare&&!named(def.title,top.c)){
   const share=Math.round(top.n/total*100);
   out.push({severity:'major',owner:'collector',target:t,problem:`${share}% of this ranking's entities are in ${top.c}, but its title ("${def.title}") presents it as covering everywhere.`,fix:`Collect the other countries' entities and data (each major market's own sources), so the ranking covers what its title says.`});
   out.push({severity:'major',owner:'editor',target:t,problem:`The ranking's title presents ${share}% ${top.c} data as a general ranking.`,fix:`Until the collector covers the other markets, limit the ranking to ${top.c} (scope.filters country, and the title names it), and keep the general ranking unpublished.`});
  }
  // Entities of a place-bound type with no country: the geography of the ranking cannot be checked or shown.
  if(total<0.8*n)out.push({severity:'major',owner:'collector',target:t+' → country',problem:`The country is known for ${total} of ${n} entities.`,fix:'Fill the country attribute for every entity (from the universe source or Wikidata P17).'});
 }
 return out;
}

// Every ranking of the topic, plus the topic itself: each entity type of the topic has a main ranking (its whole
// type, no filters) that passes, or the topic page has nothing to show; and no type duplicates another type's
// entities (data about airports belongs on the airports, as metrics, not on a second "airport profile" type).
export async function checkTopic(db:Queryable,topicId:string):Promise<{issues:QaIssue[];failing:string[]}>{
 const defs=await listRankingDefs(db,{topicId});const issues:QaIssue[]=[];const failing=new Set<string>();
 for(const d of defs){const x=await checkRanking(db,d).catch(e=>[{severity:'major' as const,owner:'collector' as const,target:d.slug,problem:'Quality check failed: '+(e as Error).message.slice(0,200),fix:'Check the ranking scope and data.'}]);
  if(x.some(i=>i.severity==='blocker'))failing.add(d.slug);issues.push(...x);}
 const types=(await db.query<{type:string;n:number}>(`select et.type, (select count(*)::int from entities e where e.type=et.type) n from entity_types et where et.topic_id=$1::uuid`,[topicId])).rows;
 for(const {type,n} of types){
  if(n<1)continue;
  const main=defs.filter(d=>d.scope?.type===type&&!Object.values(d.scope.filters||{}).some(v=>v!==null&&v!==''&&!(Array.isArray(v)&&!v.length)));
  if(defs.some(d=>d.scope?.type===type)&&!main.some(d=>!failing.has(d.slug)))
   issues.push({severity:'major',owner:'editor',target:type,problem:main.length?`The main ranking of ${type} (${main.map(d=>d.slug).join(', ')}) does not pass the quality gate, so the topic page has nothing to show.`:`${type} has sub-rankings but no main ranking over the whole type, so the topic page has nothing to show.`,fix:'Save (and get passing) a main ranking over the whole type before its sub-rankings.'});
  const dup=(await db.query<{other:string;k:number}>(`select o.type other, count(distinct e.id)::int k from entities e join entities o on o.type<>e.type and ent_norm(o.name)=ent_norm(e.name)
   where e.type=$1::text group by o.type order by 2 desc limit 1`,[type])).rows[0];
  if(dup&&dup.k>=Math.max(5,0.5*n))issues.push({severity:'major',owner:'collector',target:type,problem:`${dup.k} of the ${n} ${type} entities are also ${dup.other} entities (same names): this type duplicates ${dup.other}.`,fix:`Load its data as metrics and attributes of the ${dup.other} entities, retire the duplicate type, and point its rankings at ${dup.other}.`});
 }
 return {issues,failing:[...failing]};
}

// The whole site, on a schedule. Readers see published rankings and, while a topic is being built, its drafts; a
// ranking with any finding of the gate is "held" instead (readers never see it) and its team is queued for a
// review that fixes it. A held ranking that passes again returns to draft. Returns what it did.
export async function qaSweep(db:Queryable,log:(e:Record<string,unknown>)=>void=()=>{}):Promise<{checked:number;held:string[];released:string[];queued:string[]}>{
 const defs=(await listRankingDefs(db)).filter(d=>['published','draft','held'].includes(d.status));
 const held:string[]=[],released:string[]=[];const topics=new Map<string,string[]>();
 for(const d of defs){
  const issues=await checkRanking(db,d).catch(()=>null);if(!issues)continue;
  // Only a blocker (the ranking would mislead: too few entities, its main criterion barely measured, a one-country
  // set titled as worldwide) takes a ranking away from readers; other findings stay visible and go to the team to fix.
  // A held ranking returns to the status it had (published, or draft awaiting its review) once it passes.
  const blocked=issues.some(i=>i.severity==='blocker');
  if(issues.length&&d.topicId&&!(d.status==='held'&&blocked))topics.set(d.topicId,[...(topics.get(d.topicId)||[]),d.slug]);
  if(blocked&&d.status!=='held'){await db.query(`update rankings set status='held', config=config||jsonb_build_object('heldFrom',$2::text), updated_at=now() where slug=$1::text`,[d.slug,d.status]);held.push(d.slug);}
  else if(!blocked&&d.status==='held'){const back=String((d.config as {heldFrom?:string}).heldFrom||'published');
   await db.query(`update rankings set status=$2::text, config=config-'heldFrom', updated_at=now() where slug=$1::text`,[d.slug,back==='draft'?'draft':'published']);released.push(d.slug);}
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
