import type {Queryable} from '@/app/entity-db/client';
import type {Pool,Task} from './queue';
// The kinds of work. Each kind says who does it (pool), what it is for (instructions), what it may use (tools), how much
// it may spend (budget), the program's acceptance check (gate: a task is done only when it passes), and what follows
// when it is done (next). Inside a task the agent decides how to work; the edges are fixed.
type Row=Record<string,unknown>;
export type Next={kind:string;target:string;priority?:number;payload?:Row};
export type Kind={pool:Pool;title:string;target:'class'|'page'|'none';instructions:string;tools?:string[];budget:{rounds:number;calls:number};
 gate?:(db:Queryable,t:Task)=>Promise<string|undefined>;next?:(db:Queryable,t:Task,result:Row)=>Promise<Next[]>};

// ───────────── context ─────────────
export async function classInfo(db:Queryable,key:string){
 const {effectiveType,withSubtypes}=await import('@/app/entity-db/inherit');
 const et=(await db.query<{type:string;label:string;plural:string;description:string;topic_id:string|null;schema:Row}>('select type, label, plural, description, topic_id, schema from entity_types where type=$1::text',[key])).rows[0];
 if(!et)return null;
 const subtypes=await withSubtypes(db,key);
 const members=Number((await db.query<{n:number}>('select count(*)::int n from entities where type = any($1::text[])',[subtypes])).rows[0]?.n||0);
 // The page that shows the class: its own, else the nearest ancestor's (the tools of a task work on a page).
 let topicId=et.topic_id;
 for(let t:string|undefined=String(et.schema?.extends||''),n=0;!topicId&&t&&n<12;n++){const r:{topic_id:string|null;ext:string|null}|undefined=(await db.query<{topic_id:string|null;ext:string|null}>(`select topic_id, schema->>'extends' ext from entity_types where type=$1::text`,[t])).rows[0];topicId=r?.topic_id??null;t=r?.ext||undefined;}
 const eff=await effectiveType(db,key).catch(()=>null);
 return {key,label:et.label,plural:et.plural,definition:et.description,topicId,members,subclasses:subtypes.length-1,
  splitBy:et.schema?.splitBy??null,value:et.schema?.value??null,universe:et.schema?.universe??{},extends:eff?.extends??[],schema:eff?.schema??et.schema};
}
export async function pageInfo(db:Queryable,slug:string){
 const t=(await db.query<{id:string;slug:string;name:string;description:string;scope:Row;parent:string|null}>(`select t.id, t.slug, t.name, t.description, t.scope, p.slug parent from topics t left join topics p on p.id=t.parent_id where t.slug=$1::text`,[slug])).rows[0];
 if(!t)return null;
 const rankings=(await db.query(`select slug, title, status, scope, criteria from rankings where topic_id=$1::uuid and status <> 'archived' order by slug`,[t.id])).rows;
 const children=(await db.query(`select slug, name from topics where parent_id=$1::uuid and status <> 'archived' order by name limit 200`,[t.id])).rows;
 return {topicId:t.id,slug:t.slug,name:t.name,description:t.description,parent:t.parent,shows:t.scope?.shows??null,rankings,children};
}
async function pagePath(db:Queryable,slug:string){const {pathMaps}=await import('@/app/entity-db/pages');return (await pathMaps(db)).topics.get(slug)||'/rankings/'+slug;}
async function opens(db:Queryable,slug:string){
 const {siteUrl}=await import('@/app/site');const base=process.env.LINK_CHECK_ORIGIN||siteUrl();if(!base)return true;
 const r=await fetch(base+await pagePath(db,slug),{signal:AbortSignal.timeout(60_000)}).catch(()=>null);return r?.status===200;
}

// ───────────── gates ─────────────
async function dataGate(db:Queryable,key:string,{minShare=0.5}:{minShare?:number}={}):Promise<string|undefined>{
 const c=await classInfo(db,key);if(!c)return 'No such class '+key+'.';
 if(!c.members)return `The class ${key} has no members yet: load its universe (entity_upsert or bulk_import) and save it as a recipe.`;
 const expected=Number((c.universe as Row)?.expectedCount||0);
 if(expected>0&&c.members<expected*minShare)return `The class has ${c.members} members of about ${expected} expected: add the missing members (more sources, per-country lists) or explain in your summary why the expected count is wrong.`;
 const {coverage}=await import('@/app/teams/tools');const cov=await coverage(key,'',expected);
 const problems=[...cov.recipeProblems,...cov.dataProblems];
 return problems.length?'Not yet: '+problems.slice(0,8).join(' '):undefined;
}
async function pageGate(db:Queryable,slug:string):Promise<string|undefined>{
 const p=await pageInfo(db,slug);if(!p)return 'No page '+slug+': create it with create_page.';
 if(!p.rankings.length)return 'The page has no ranking yet: save its ranking (save_ranking with scope {type, filters}).';
 const {checkTopic}=await import('@/app/teams/qa');const qa=await checkTopic(db,p.topicId);
 // Blockers, and a ranking that compares on too few measures (a task is not done while readers get a thin ranking).
 const blockers=qa.issues.filter(i=>i.severity==='blocker'||/measure\(s\) readers compare have data|opens on .*, a date or year/.test(i.problem));
 if(blockers.length)return 'The quality check finds: '+blockers.slice(0,6).map(i=>i.target+': '+i.problem).join(' | ');
 if(!await opens(db,slug))return 'The page does not open (not 200): fix it.';
 return undefined;
}

// ───────────── kinds ─────────────
const DIMENSIONS=' A ranking compares on many dimensions: at least 5 measures with data, covering different aspects (size, quality, performance, cost, popularity, reliability…). For anything sold, think as a buyer: price, user rating and number of ratings, the performance specs buyers compare, durability or reliability and warranty, support, and a value-for-money index. Years and dates describe; they never rank.';
const FIELDS_NOTE=' The class\'s field template is decided first, by what experts and readers want to know, never by what a convenient source happens to have; collect every declared field, and for one no source has yet, keep searching (other registries, national statistics, the entities\' own published data) rather than dropping it. Collect as much as exists: every attribute and measure a reader, buyer or expert could use about these entities, from every source that has it. A source with hundreds of fields (a government file, a registry, an API) is mapped broadly — all meaningful columns, not the five convenient ones. When the best source lacks a field, look further (national and regional registries, statistics offices, industry bodies, Wikidata, the entities\' own published data) before calling it unavailable; record what you tried.';
const CLASS_NOTE='Your target is one class of the class tree (task.class: its definition, split, inherited and own attributes, metrics and sources, universe). Work on that class only. Entities you load are of this class or one of its subclasses (the most specific one each fits; one that fits no subclass stays in this class); every entity carries the split attributes of its line.';
const PAGE_NOTE='Your target is one page of the site map (task.page: what it shows, its rankings, its children).'+DIMENSIONS+' A ranking is a stored query: scope {type: <class>, filters: {attribute conditions}} over the class tree. Membership is decided by attributes only — never a hand-made list. When a filter needs an attribute the data lacks, request it from the collectors (requests: kind "class_attribute", target the class, why and the attribute\'s definition and likely source).';
export const KINDS:Record<string,Kind>={
 // collectors
 class_members:{pool:'collector',title:'collect the class\'s members',target:'class',budget:{rounds:60,calls:140},
  instructions:CLASS_NOTE+' Task: make the collection of this class\'s members automatic and complete — every entity that belongs to the class, not the convenient part. Use the class\'s sources (start with the ones the class and its ancestors name), add sources where they miss members (per country, local languages, smaller and older members), write the collection as recipes (save_recipe) and run them (run_recipe) until they load cleanly, apply the admission standard, match members to existing entities (no duplicates). Then prove completeness against independent lists: compare the class with at least two other authoritative lists (an official registry or directory, a federation or industry database, Wikidata), load what they have and you lack, and record each comparison (record_universe_check: listed, matched, a sample of what is still missing and why). Check well-known members are present and a sample is correct.',
  gate:async(db,t)=>{const d=await dataGate(db,t.target);if(d)return d;const {universeVerdict}=await import('./completeness');const u=await universeVerdict(db,t.target);return u.complete?undefined:u.problem;},next:async(_db,t)=>[{kind:'class_fields',target:t.target,priority:t.priority}]},
 class_fields:{pool:'collector',title:'load the class\'s fields',target:'class',budget:{rounds:60,calls:140},
  instructions:CLASS_NOTE+DIMENSIONS+FIELDS_NOTE+' Task: load every attribute and metric this class declares (its own; the inherited ones too where its members lack them), with history where the source has it, each by a recipe that runs by itself; the split attribute of this class and of its ancestors on every member first. List what no public source has (with the sources you tried).',
  gate:async(db,t)=>{const d=await dataGate(db,t.target);if(d)return d;
   const {classGapsOf,wantCovered}=await import('./checks');const g=await classGapsOf(db,t.target);
   return g&&g.metricsCovered<wantCovered(g.metrics)?`Only ${g.metricsCovered} of the ${g.metrics} declared measures are collected for most members (at least ${wantCovered(g.metrics)} needed). Still missing: ${g.missingMetrics.slice(0,25).join(', ')}. Load them from the class's sources or others; for a measure no public source has, remove it from the class only if it truly does not exist publicly.`:undefined;},
  next:async(db,t)=>{const c=await classInfo(db,t.target);
   const hasPage=c?.topicId&&(await db.query('select 1 from rankings r join entity_types et on et.topic_id=r.topic_id where et.type=$1::text and r.status<>\'archived\' limit 1',[t.target])).rows.length;
   return hasPage?[]:[{kind:'page_build',target:'class:'+t.target,priority:t.priority}];}},
 class_spec:{pool:'collector',title:'widen the class\'s specification',target:'class',budget:{rounds:40,calls:90},
  instructions:CLASS_NOTE+DIMENSIONS+FIELDS_NOTE+' Task: research the class\'s full specification (task.payload says what is short), in two separate steps. Step 1, the template, WITHOUT looking at what data is available: as the best expert writing the definitive reference on these entities (a statistical yearbook for places, a buyer\'s guide and spec sheet for products, the field\'s standard databases for people, organisations and works), list everything such a reference shows about one member — a rich class has 60–150 fields with the inherited ones. Step 2, sources field by field; a field without a source stays declared (source_needed) and is never dropped because data is hard to get. As that expert, list everything readers, buyers and specialists look up and compare about them — identity and classification, size, quality, performance, cost, popularity, reliability, history, people and places, the standard indices of the field — and every field the class\'s sources (and other public sources) publish. Read the data dictionaries of the class\'s sources and of other sources that cover these entities, and record the survey (record_sources). Declare everything in the class schema (set_entity_schema: attributes with their definitions, metrics with unit, direction and source), only adding. Then the collectors load them.',
  gate:async(db,t)=>{const {specVerdict}=await import('./completeness');const v=await specVerdict(db,t.target);return v.complete?undefined:v.problem;},
  next:async(_db,t)=>[{kind:'class_fields',target:t.target,priority:t.priority}]},
 class_attribute:{pool:'collector',title:'add an attribute readers need',target:'class',budget:{rounds:40,calls:100},
  instructions:CLASS_NOTE+' Task: an editor needs an attribute on this class (task.requests: which, its definition, why, suggested sources). Define it in the class schema (set_entity_schema, only adding), find an authoritative public source, load it for every member by a recipe that runs by itself, or derive it from existing data or relations when it follows from them (a rule, not a list). If it has no objective, checkable definition or no public source, say so in your summary (the editor will change the ranking).',
  gate:async(db,t)=>{const key=String(((t.payload.requests as Row[]|undefined)?.[0]?.attribute)||t.payload.attribute||'');if(!key)return dataGate(db,t.target);
   const {withSubtypes}=await import('@/app/entity-db/inherit');const types=await withSubtypes(db,t.target);
   const r=(await db.query<{n:number;w:number}>(`select count(*)::int n, count(*) filter (where attributes ? $2::text)::int w from entities where type = any($1::text[])`,[types,key])).rows[0];
   return r&&r.n&&r.w/r.n<0.6?`Only ${r.w} of ${r.n} members have ${key} yet.`:undefined;},
  next:async(_db,t)=>(t.payload.requests as Row[]|undefined)?.filter(r=>typeof r.page==='string').map(r=>({kind:'page_view',target:String(r.page),priority:t.priority}))||[]},
 source_repair:{pool:'collector',title:'repair a failed collection',target:'class',budget:{rounds:40,calls:100},
  instructions:CLASS_NOTE+' Task: a collection rule of this class failed or drifted (task.payload: the recipe and error). Inspect the source again, fix the recipe or move it to the best alternative source, run it until it succeeds, retract data from a source you abandon.',
  gate:(db,t)=>dataGate(db,t.target,{minShare:0})},
 source_review:{pool:'collector',title:'review the class\'s sources',target:'class',budget:{rounds:40,calls:90},
  instructions:CLASS_NOTE+' Task: the periodic source review. Open every source of the class again (reachable, current, same format), replace dead or superseded ones, look for better or missing sources (markets not covered), and record each check (record_sources).',
  // Accepted when this class's own data has no open problems (not the whole topic's).
  gate:(db,t)=>dataGate(db,t.target,{minShare:0})},
 data_verify:{pool:'collector',title:'verify questioned data',target:'class',budget:{rounds:30,calls:70},
  instructions:CLASS_NOTE+' Task: data of this class is questioned (task.payload: a reader report, a value that jumped or is out of range, two sources that disagree, a reviewer finding). Check it against the sources, correct the values or the recipe, retract wrong data, and say what you found.',
  // Accepted when this class's own data has no open problems (not the whole topic's).
  gate:(db,t)=>dataGate(db,t.target,{minShare:0})},
 class_evolution:{pool:'collector',title:'propose how the class should change',target:'class',budget:{rounds:30,calls:60},
  instructions:CLASS_NOTE+' Task: the class has grown (task.payload: why). Judge whether it should split (one attribute, complete, non-overlapping subclasses that each help collection — their own registries or fields) or merge into its parent, and return the proposal in your summary with requests of kind "arbitrate" to the manager; never restructure the tree yourself.'},
 class_patrol:{pool:'collector',title:'patrol the class (scheduled full check)',target:'class',budget:{rounds:30,calls:60},
  instructions:CLASS_NOTE+DIMENSIONS+' Task: the scheduled patrol — every class is checked in turn, nothing waits for a symptom. Go through the whole class as its owner: (1) definition and admission standard clear, the universe and expectedCount right; (2) its split: one attribute, the subclasses complete and non-overlapping, members carry the split value; (3) attributes and metrics: what experts and buyers compare is declared (at least 5 measures that rank), nothing missing, nothing useless; (4) sources: still the best and authoritative ones, reachable, current, nothing better or missing (markets, languages); (5) the data: member count against the universe, well-known members present, a sample of values against the source, freshness, duplicates. Fix small things yourself (schema additions, a recipe, a value). For larger work return requests (class_members, class_fields, source_repair, data_verify, class_evolution on this class; page_refresh on its page). In your summary list what you checked and what you found, even when all is well.'},
 // editors
 page_build:{pool:'editor',title:'build a page',target:'page',budget:{rounds:50,calls:110},
  instructions:PAGE_NOTE+' Task: build the page (task.target: "class:<key>" for a class that has members and no page yet — create its page under the page of its nearest ancestor class with create_page; or a page slug; or "inbox:<page>" for readers\' queries in task.payload). Save its main ranking (the class, no filters) with the criteria readers compare (measures with data; composite indices as derived metrics scored 0–100 with their formula), the entity template if the class has none, and the views readers need (class + filters). Preview the page and fix what is wrong.',
  gate:async(db,t)=>{const slug=t.target.startsWith('class:')?(await db.query<{slug:string}>('select t.slug from entity_types et join topics t on t.id=et.topic_id where et.type=$1::text',[t.target.slice(6)])).rows[0]?.slug:t.target.startsWith('inbox:')?undefined:t.target;return slug?pageGate(db,slug):undefined;},
  next:async(db,t)=>{const slug=t.target.startsWith('class:')?(await db.query<{slug:string}>('select t.slug from entity_types et join topics t on t.id=et.topic_id where et.type=$1::text',[t.target.slice(6)])).rows[0]?.slug:t.target.startsWith('inbox:')?t.target.slice(6):t.target;return slug?[{kind:'page_review',target:slug,priority:t.priority}]:[];}},
 page_view:{pool:'editor',title:'add a ranking view',target:'page',budget:{rounds:40,calls:90},
  instructions:PAGE_NOTE+' Task: add the ranking view described in task.payload (or finish one whose attribute the collectors have now loaded): write its query (class + filters), preview the members, save it, preview the page.',
  gate:(db,t)=>pageGate(db,t.target),next:async(_db,t)=>[{kind:'page_review',target:t.target,priority:t.priority}]},
 page_refresh:{pool:'editor',title:'refresh a page after a data change',target:'page',budget:{rounds:30,calls:60},
  instructions:PAGE_NOTE+' Task: the data behind this page changed a lot (task.payload). Check the rankings still make sense (criteria with data, defaults, indices recomputed, texts still true), adjust them, preview.',
  gate:(db,t)=>pageGate(db,t.target)},
 page_fix:{pool:'editor',title:'fix what is wrong on a page',target:'page',budget:{rounds:40,calls:90},
  instructions:PAGE_NOTE+' Task: fix the problems listed in task.payload (a reviewer\'s issues, broken links, a reader report). Fix what is yours (rankings, criteria, templates, texts); send what is data to the collectors as requests (data_verify or class_attribute on the class).',
  gate:(db,t)=>pageGate(db,t.target),next:async(_db,t)=>[{kind:'page_review',target:t.target,priority:t.priority}]},
 page_retire:{pool:'editor',title:'retire or merge a page',target:'page',budget:{rounds:20,calls:40},
  instructions:PAGE_NOTE+' Task: this page is outdated, empty or a duplicate (task.payload). Merge its content into the right page or archive it; its address must keep working (the platform redirects a retired ranking to where its content went — record mergedInto in the ranking config).'},
 calendar_event:{pool:'editor',title:'prepare for a dated event',target:'page',budget:{rounds:40,calls:90},
  instructions:PAGE_NOTE+' Task: a dated event is coming (task.payload: a season start, an election, an award ceremony, an annual list, a product launch season). Prepare the pages it needs (new views, criteria for the new period) and request the data from the collectors ahead of the date.'},
 page_patrol:{pool:'editor',title:'patrol the page (scheduled full check)',target:'page',budget:{rounds:30,calls:60},
  instructions:PAGE_NOTE+' Task: the scheduled patrol — every page is checked in turn, nothing waits for a symptom. Go through the page as its owner and as a reader: (1) its place in the site map (right parent, the sub-pages and views readers look for exist, no duplicate page elsewhere); (2) each ranking: the default is the one readers want (a composite where it fits), criteria are measures with data, the podium and values look right, the order makes sense; (3) the views readers need (popular filters by country, era, type, price band) exist and are not empty; (4) texts still true, links working, the entity template useful. Fix what is yours; send data problems to the collectors as requests; ask for page_retire when the page should go. In your summary list what you checked and what you found, even when all is well.',
  gate:(db,t)=>pageGate(db,t.target)},
 // reviewers
 page_review:{pool:'reviewer',title:'review a page as a reader',target:'page',budget:{rounds:40,calls:60},
  instructions:'You review one page of the site map (task.page) as the people who use it would. First write down who comes to this page and what they want to compare before choosing (a student choosing a college: admission chances and test scores, cost and net price, graduation and retention, earnings and debt after, size, setting, resources; a buyer: price, ratings, the specs that matter, reliability, value) — the 8–12 measures an expert guide for them would show. Then open the page (view_page), its rankings (other criteria, an older year) and 3–5 entity pages, and check against that list: are those measures there with data, is the default ranking what such a reader wants (a composite where experts use one), are the members right (none that do not belong, none missing that readers expect), are values plausible and in one unit (a rate of 0.97 next to 98 is a defect), are texts and links right. In your result give verdict.approved and verdict.issues, each with owner "editor" (pages, rankings, texts) or "collector" (wrong or missing data; target = the class key) and a concrete fix — name the missing measures and their likely source. Approve only a page that serves those readers well; a page that ranks on a few convenient numbers is not done.'},
 check_trial:{pool:'reviewer',title:'confirm a new check',target:'none',budget:{rounds:25,calls:40},
  instructions:'An agent added a check (task.payload.check: what it looks for, the query, the task it creates) and it ran on trial: task.payload.flagged objects, a sample in task.payload.sample. Look at 5 or more of the flagged classes or pages yourself (team_state, coverage, view_page, entity_search) and judge: is each a real problem of that kind, and would the task it creates fix it? Approve (verdict.approved true) only if the findings are real and the check is not too broad; otherwise return the problems in verdict.issues (owner "editor" or "collector", what is wrong with the check). An approved check runs across the whole site from now on.'},
 // manager
 arbitrate:{pool:'manager',title:'rule on a dispute or a stuck piece of work',target:'none',budget:{rounds:30,calls:50},
  instructions:'You are the manager. task.payload holds the dispute or the stuck work (the tasks, their results, the reviewer\'s issues, a class change proposal). Look at the evidence (team_state, coverage, preview_page), rule, and record it (record_decision). Return requests for the work your ruling needs (any pool) — or none when the work is acceptable as it is.'},
};
// Which kinds each pool may ask of others (an agent's requests are checked against this).
export const MAY_REQUEST:Record<Pool,string[]>={
 editor:['class_attribute','class_members','class_fields','data_verify','arbitrate','page_fix','page_view','page_retire','page_review'],
 collector:['page_refresh','arbitrate','data_verify','class_members','class_fields','class_spec','source_repair','class_evolution'],
 reviewer:['page_fix','data_verify','class_attribute','arbitrate'],
 manager:Object.keys(KINDS),
};
