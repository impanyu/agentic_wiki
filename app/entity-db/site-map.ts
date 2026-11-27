import type {EntityDb} from './client';
// The site map's initialisation (scratchpad sitemap/out/*.json, merged): every page readers browse, what it shows
// ({class, filters} or a hub), its main ranking (criteria, default, composite index) and its views, the pages
// retired into others (their addresses redirect), and attributes the views need (added to the classes and handed to
// the collectors). Existing pages are updated in place (addresses kept); new pages are created; a ranking whose set
// has no members yet waits as a draft until the reviewer publishes it.
type Row=Record<string,unknown>;
export type PageSpec={slug:string;keep?:boolean;name:string;parent:string;shows:{class?:string;filters?:Row;hub?:boolean};purpose?:string;
 main?:{title:string;criteria:string[];default?:string;composite?:{key:string;label:string;inputs:{metric:string;weight:number}[];why?:string}|null}|null;
 views?:{slug:string;title:string;filters:Row;criteria?:string[];why?:string}[];related?:string[]};
export type SiteMapSpec={pages:PageSpec[];retire:{slug:string;into:string;why?:string}[];attributes_needed:{class:string;attribute:string;type?:string;values?:unknown[];why?:string;source?:string}[]};

const SLUG=/^[a-z0-9][a-z0-9-]{0,118}$/;
export async function importSiteMap(db:EntityDb,spec:SiteMapSpec,{dryRun=true,log=(_e:Row)=>{}}:{dryRun?:boolean;log?:(e:Row)=>void}={}){
 const out={pagesCreated:0,pagesUpdated:0,rankingsCreated:0,rankingsUpdated:0,drafts:0,composites:0,retired:0,attributes:0,problems:[] as string[]};
 const classes=new Set((await db.query<{type:string}>(`select type from entity_types where schema->>'kind'='class'`)).rows.map(r=>r.type));
 const metrics=new Set((await db.query<{key:string}>('select distinct key from metrics')).rows.map(r=>r.key));
 const existing=new Map((await db.query<{slug:string;id:string}>('select slug, id from topics')).rows.map(r=>[r.slug,r.id]));
 const specSlugs=new Set(spec.pages.map(p=>p.slug));
 // Problems that stop a page (reported, the page skipped).
 const okPages=spec.pages.filter(p=>{
  const why=!SLUG.test(p.slug)?'bad slug':!p.name?'no name':p.shows?.hub?'':!p.shows?.class?'no class':!classes.has(p.shows.class)?'unknown class '+p.shows.class:'';
  if(why)out.problems.push(p.slug+': '+why);return !why;});
 const parentOk=(s:string)=>!s||specSlugs.has(s)||existing.has(s);
 for(const p of okPages)if(!parentOk(p.parent))out.problems.push(p.slug+': unknown parent '+p.parent);
 if(dryRun){
  const created=okPages.filter(p=>!existing.has(p.slug)).length;
  return {...out,pagesCreated:created,pagesUpdated:okPages.length-created,retired:spec.retire.length,attributes:spec.attributes_needed.length,
   views:okPages.reduce((n,p)=>n+(p.views?.length||0),0),missingMetrics:[...new Set(okPages.flatMap(p=>[...(p.main?.criteria||[]),...(p.views||[]).flatMap(v=>v.criteria||[])]).filter(k=>!metrics.has(k)))].slice(0,200)};
 }
 // 1. Pages (two passes: create or update without parents, then parents).
 for(const p of okPages){
  const scope={shows:p.shows.hub?{hub:true,why:p.purpose||''}:{class:p.shows.class,filters:p.shows.filters||{}},purpose:p.purpose||'',related:(p.related||[]).slice(0,20)};
  if(existing.has(p.slug)){
   await db.query(`update topics set name=$2::text, scope=(scope - 'convertedTo') || $3::jsonb, status='active', updated_at=now() where slug=$1::text`,[p.slug,p.name.slice(0,160),JSON.stringify(scope)]);out.pagesUpdated++;
  }else{
   const r=await db.query<{id:string}>(`insert into topics(slug,name,description,scope,status) values ($1::text,$2::text,$3::text,$4::jsonb,'active') on conflict (slug) do update set name=excluded.name, scope=excluded.scope, status='active' returning id`,[p.slug,p.name.slice(0,160),p.purpose||'',JSON.stringify(scope)]);
   existing.set(p.slug,r.rows[0].id);out.pagesCreated++;
  }
 }
 for(const p of okPages)if(p.parent&&existing.has(p.parent)&&p.parent!==p.slug)await db.query('update topics set parent_id=$2::uuid where slug=$1::text and parent_id is distinct from $2::uuid',[p.slug,existing.get(p.parent)]);
 // A class's own page: the page that shows it without filters.
 for(const p of okPages)if(p.shows.class&&!Object.keys(p.shows.filters||{}).length)await db.query('update entity_types set topic_id=$2::uuid where type=$1::text',[p.shows.class,existing.get(p.slug)]);
 // 2. Rankings: the main ranking (the page's existing main one keeps its address) and the views.
 const memberCount=async(cls:string,filters:Row)=>{const {entitySearchIds}=await import('./repo');return (await entitySearchIds(db,{type:cls,filters} as never,4).catch(()=>[])).length;};
 const upsertRanking=async(slug:string,title:string,topicId:string,cls:string,filters:Row,criteria:string[],def:string|undefined,extra:Row)=>{
  const crit=criteria.filter(k=>metrics.has(k.split('@')[0])).slice(0,24);if(!crit.length){out.problems.push(slug+': no known criteria');return;}
  const n=await memberCount(cls,filters);const status=n>=3?'published':'draft';if(status==='draft')out.drafts++;
  const cfg={...(def&&crit.includes(def)?{default:def}:{}),...extra};
  const r=await db.query<{ins:boolean}>(`insert into rankings(slug,title,topic_id,scope,criteria,config,status) values ($1::text,$2::text,$3::uuid,$4::jsonb,$5::text[],$6::jsonb,$7::text)
    on conflict (slug) where slug is not null do update set title=excluded.title, topic_id=excluded.topic_id, scope=excluded.scope, criteria=excluded.criteria,
     config=rankings.config||excluded.config, status=case when rankings.status in ('archived','held') or excluded.status='published' then excluded.status else rankings.status end, members_at=null, updated_at=now()
    returning (xmax=0) ins`,[slug,title.slice(0,200),topicId,JSON.stringify({type:cls,filters}),crit,JSON.stringify(cfg),status]);
  if(r.rows[0]?.ins)out.rankingsCreated++;else out.rankingsUpdated++;
 };
 for(const p of okPages){
  if(!p.shows.class||!p.main)continue;const topicId=existing.get(p.slug)!;const filters=p.shows.filters||{};
  // A composite index, defined over the class (and computed once the class has members).
  let def=p.main.default;
  if(p.main.composite&&p.main.composite.inputs?.length>=3){
   const c=p.main.composite;const inputs=c.inputs.filter(i=>metrics.has(i.metric));
   if(inputs.length>=3&&/^[a-z][a-z0-9_]{1,63}$/.test(c.key)){
    const {defineDerivedMetric}=await import('./repo');
    try{await defineDerivedMetric(db,{key:c.key,label:c.label,unit:'score (0-100)',order:'desc',format:'decimal:1',description:c.why||c.label,createdBy:'site-map',
      definition:{inputs:inputs.map(i=>({metric:i.metric,period:'latest',transform:'none'})),weights:inputs.map(i=>Number(i.weight)||0),normalize:'rank_pct',combine:'weighted_sum',missing:'reweight',min_inputs:Math.min(3,inputs.length),scope:{type:p.shows.class,filter:filters}}} as never);
     metrics.add(c.key);out.composites++;if(!def||def===c.key)def=c.key;
    }catch(e){out.problems.push(p.slug+': composite '+c.key+': '+(e as Error).message.slice(0,120));}
   }
  }
  const criteria=[...(def&&p.main.composite&&def===p.main.composite.key?[def]:[]),...p.main.criteria.filter(k=>k!==def||!p.main?.composite)];
  const main=(await db.query<{slug:string}>(`select slug from rankings where topic_id=$1::uuid and status<>'archived' and scope->>'type'=$2::text and coalesce(scope->'filters','{}'::jsonb)=$3::jsonb order by (config ? 'main') desc, updated_at desc limit 1`,[topicId,p.shows.class,JSON.stringify(filters)])).rows[0]?.slug||p.slug.replace(/-rankings?$/,'')+'-rankings';
  await upsertRanking(main,p.main.title,topicId,p.shows.class,filters,criteria,def,{main:true});
  for(const v of p.views||[]){if(!SLUG.test(v.slug)){out.problems.push(v.slug+': bad view slug');continue;}
   await upsertRanking(v.slug,v.title,topicId,p.shows.class,{...filters,...(v.filters||{})},v.criteria?.length?v.criteria:criteria,def,{view:v.why||''});}
  log({event:'page',slug:p.slug});
 }
 // 3. Retired pages: archived, their address and rankings lead to the page they went into.
 for(const r of spec.retire){
  if(!existing.has(r.slug)||specSlugs.has(r.slug))continue;
  const into=existing.has(r.into)?r.into:'';
  await db.query(`update topics set status='archived', scope=scope||jsonb_build_object('convertedTo',$2::text,'retiredWhy',$3::text), updated_at=now() where slug=$1::text`,[r.slug,into,r.why||'']);
  // A one-country page leads to the platform's own country ranking of the same set (found by its query), not the
  // world page: no mergedInto, so the retired ranking resolves to the published ranking with the same class and filters.
  const oneCountry=(await db.query<{k:string[]}>(`select array(select jsonb_object_keys(coalesce(scope->'shows'->'filters','{}'::jsonb))) k from topics where slug=$1::text`,[r.slug])).rows[0]?.k;
  const countryOnly=!!oneCountry&&oneCountry.length===1&&oneCountry[0]==='country_iso3';
  const intoMain=into&&!countryOnly?(await db.query<{slug:string}>(`select r.slug from rankings r join topics t on t.id=r.topic_id where t.slug=$1::text and r.status<>'archived' order by (r.config ? 'main') desc limit 1`,[into])).rows[0]?.slug:undefined;
  await db.query(`update rankings set status='archived', config=config||jsonb_build_object('mergedInto',$2::text), updated_at=now() where topic_id=$1::uuid and status<>'archived'`,[existing.get(r.slug),intoMain||'']);
  out.retired++;
 }
 // 4. Attributes views need: declared on the class, and a collector task to load them.
 const {enqueue}=await import('@/app/work/queue');
 for(const a of spec.attributes_needed){
  if(!classes.has(a.class)||!/^[a-z][a-z0-9_]{0,63}$/.test(a.attribute))continue;
  await db.query(`update entity_types set schema=jsonb_set(schema,'{attributes}',coalesce(schema->'attributes','[]'::jsonb)||jsonb_build_array($2::jsonb))
    where type=$1::text and not exists (select 1 from jsonb_array_elements(coalesce(schema->'attributes','[]'::jsonb)) x where x->>'key'=$3::text)`,
   [a.class,JSON.stringify({key:a.attribute,type:a.type||'string',...(a.values?{values:a.values}:{}),description:a.why||'',source:a.source||''}),a.attribute]);
  await enqueue(db,{kind:'class_attribute',pool:'collector',target:a.class,priority:55,requestedBy:'site-map',payload:{attribute:a.attribute,requests:[{attribute:a.attribute,why:a.why||'',source:a.source||''}]}}).catch(()=>{});
  out.attributes++;
 }
 return out;
}
