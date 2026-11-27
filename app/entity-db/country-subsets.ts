import type {Queryable} from './client';
// Country, one standard for every entity: teams record an entity's country in many forms (attributes country,
// iso3, iso2, country_code, country_iso3 — a name, an ISO code, an alias). The platform resolves each against the
// country entities (their ISO codes, names and aliases) into one attribute, country_iso3 (ISO 3166-1 alpha-3), so a
// country subset finds every member however its team wrote the country.
export async function normalizeCountries(db:Queryable):Promise<number>{
 // One hash join: each entity's candidate keys (in order of trust) against the country keys; the first that resolves wins.
 const r=await db.query(`with keys as (
   select upper(ids->>'iso3') iso3, upper(ids->>'iso3') k from entities where type='country' and ids ? 'iso3'
   union select upper(ids->>'iso3'), upper(ids->>'iso2') from entities where type='country' and ids ? 'iso3' and ids ? 'iso2'
   union select upper(ids->>'iso3'), upper(ent_norm(name)) from entities where type='country' and ids ? 'iso3'
   union select upper(ids->>'iso3'), upper(ent_norm(a)) from entities, unnest(aliases) a where type='country' and ids ? 'iso3'),
  map as (select k, min(iso3) iso3 from keys where k <> '' group by k having count(distinct iso3) = 1),
  cand as (select e.id, c.ord, upper(c.v) k from entities e,
    lateral (values (1, e.attributes->>'country_iso3'), (2, e.attributes->>'iso3'), (3, e.attributes->>'country_code'), (4, e.attributes->>'iso2'),
     (5, e.attributes->>'country'), (6, ent_norm(e.attributes->>'country')), (7, e.attributes->>'countryLabel'), (8, ent_norm(e.attributes->>'countryLabel'))) c(ord, v)
    where e.type <> 'country' and (e.attributes ?| array['country','iso3','iso2','country_code','country_iso3','countryLabel']) and coalesce(c.v,'') <> ''),
  src as (select distinct on (cand.id) cand.id, map.iso3 from cand join map on map.k = cand.k order by cand.id, cand.ord)
  update entities e set attributes = e.attributes || jsonb_build_object('country_iso3', src.iso3)
  from src where src.id = e.id and (e.attributes->>'country_iso3') is distinct from src.iso3 returning e.id`);
 return r.rows.length;
}
// Every class present in several countries gets a ranking per country (each country with at least MIN members),
// under its main ranking, with the main ranking's criteria: "National Park Rankings in Canada" at
// /…/national-parks/canada. Created and kept by the platform (config.auto); an editor's own country subsets of the
// same class are folded into them.
const MIN=Number(process.env.COUNTRY_SUBSET_MIN||5);
const CONTINENT_LEVEL=Number(process.env.CONTINENT_LEVEL_OVER||12);
export async function countrySubsets(db:Queryable):Promise<{created:number}>{
 const mains=(await db.query<{slug:string;title:string;topic_id:string;type:string;criteria:string[];config:Record<string,unknown>}>(`select slug, title, topic_id, scope->>'type' type, criteria, config from rankings r
  where status = 'published' and topic_id is not null and coalesce(scope->'filters','{}'::jsonb) = '{}'::jsonb and scope->>'type' <> 'country'`)).rows;
 let created=0;
 for(const m of mains){
  const label=String(m.title).replace(/\s*Rankings?\s*$/i,'').replace(/\s+(of|in) the world$/i,'').replace(/^(the\s+)?world'?s?\s+/i,'').trim()||m.type;
  // A country whose members form a national subclass (US states under first-level divisions: the Census, BEA, BLS
  // fields) gets that class's own ranking: its members, its readers' criteria first, its name ("US States Rankings").
  const nat=new Map((await db.query<{type:string;plural:string;iso3:string;crit:unknown}>(`select type, plural, schema->'value'->>0 iso3, schema->'rankingCriteria' crit from entity_types
    where schema->>'kind'='class' and schema->>'extends'=$1::text and jsonb_typeof(schema->'value')='array' and schema->'value'->>0 ~ '^[A-Z]{3}$'`,[m.type])).rows.map(r=>[r.iso3,r]));
  const per=(await db.query<{iso3:string;iso2:string;name:string;continent:string;n:number}>(`select e.attributes->>'country_iso3' iso3, coalesce(upper(c.ids->>'iso2'),'') iso2, c.name, coalesce(c.attributes->>'continent','') continent, count(*)::int n from entities e
    join entities c on c.type = 'country' and upper(c.ids->>'iso3') = e.attributes->>'country_iso3'
    where (e.type = $1::text or e.type = any($3::text[])) and e.attributes ? 'country_iso3' group by 1, 2, 3, 4 having count(*) >= $2::int order by 5 desc limit 120`,[m.type,MIN,[...nat.values()].map(n=>n.type)])).rows;
  if(per.length<2)continue;// one country: the main ranking is that country's
  // Many countries: a level by continent first ("Cities in Asia"), the countries under it, so a reader narrows down
  // step by step instead of facing a hundred links. An editor's own continent ranking of the class is that level.
  const under=new Map<string,string>();
  if(per.length>CONTINENT_LEVEL){
   const byCont=new Map<string,typeof per>();for(const c of per)if(c.continent){const l=byCont.get(c.continent)??[];l.push(c);byCont.set(c.continent,l);}
   for(const [cont,list] of byCont){
    if(list.length<2)continue;
    const own=(await db.query<{slug:string}>(`select slug from rankings where status='published' and slug is not null and scope->>'type'=$1::text and coalesce(config->>'auto','')=''
      and jsonb_typeof(scope->'filters')='object' and scope->'filters'->>'continent'=$2::text and (select count(*) from jsonb_object_keys(scope->'filters'))=1 limit 1`,[m.type,cont])).rows[0]?.slug;
    let cslug=own||'';
    if(!cslug){
     cslug=(m.slug+'-in-'+cont.toLowerCase().replace(/[^a-z0-9]+/g,'-')).slice(0,120);
     const ccfg={...m.config,auto:'continent',segment:cont,about:[`${label} in ${cont}.`]} as Record<string,unknown>;delete ccfg.main;
     await db.query(`insert into rankings(slug,title,topic_id,scope,criteria,config,status) values ($1::text,$2::text,$3::uuid,$4::jsonb,$5::text[],$6::jsonb,'published')
       on conflict (slug) where slug is not null do update set criteria=excluded.criteria, config=excluded.config, topic_id=excluded.topic_id, title=excluded.title, scope=excluded.scope,
        status=case when rankings.status='archived' then 'published' else rankings.status end, updated_at=now()`,
      [cslug,`${label} Rankings in ${cont}`,m.topic_id,JSON.stringify({type:m.type,filters:{country_iso3:list.map(c=>c.iso3).sort()}}),m.criteria,JSON.stringify(ccfg)]);
    }
    for(const c of list)under.set(c.iso3,cslug);
   }
  }
  for(const c of per){
   const slug=(m.slug+'-in-'+c.iso3.toLowerCase()).slice(0,120);
   const n=nat.get(c.iso3);
   const title=n?n.plural.split(' ').map((w,i)=>i&&/^(or|and|of|in|the|for|by|to)$/.test(w)?w:w.charAt(0).toUpperCase()+w.slice(1)).join(' ')+' Rankings':`${label} Rankings in ${c.name}`;
   const crit=n?[...new Set([...(Array.isArray(n.crit)?n.crit.map(String):[]),...m.criteria])].slice(0,40):m.criteria;
   const scope=n?{type:n.type,filters:{}}:{type:m.type,filters:{country_iso3:c.iso3}};
   const cfg={...m.config,main:undefined,auto:'country',segment:c.name,...(c.continent?{navGroup:c.continent}:{}),...(under.has(c.iso3)?{under:under.get(c.iso3)}:{}),about:[`${label} in ${c.name}.`]};delete (cfg as Record<string,unknown>).main;
   if(!under.has(c.iso3))delete (cfg as Record<string,unknown>).under;
   const r=await db.query(`insert into rankings(slug,title,topic_id,scope,criteria,config,status) values ($1::text,$2::text,$3::uuid,$4::jsonb,$5::text[],$6::jsonb,'published')
     on conflict (slug) where slug is not null do update set criteria=excluded.criteria, config=excluded.config, topic_id=excluded.topic_id, title=excluded.title, scope=excluded.scope,
      status=case when rankings.status='archived' then 'published' else rankings.status end, updated_at=now()
      where rankings.criteria is distinct from excluded.criteria or rankings.config is distinct from excluded.config or rankings.title is distinct from excluded.title
       or rankings.scope is distinct from excluded.scope or rankings.status='archived' returning (xmax = 0) inserted`,
    [slug,title,m.topic_id,JSON.stringify(scope),crit,JSON.stringify(cfg)]);
   if(r.rows[0]?.inserted)created++;
  }
  // An editor's own one-country subsets of this class (filtered by another form of the country) are the same sets.
  await db.query(`update rankings set status='archived', config=config||'{"mergedInto":"country subset"}'::jsonb, updated_at=now()
   where scope->>'type' = $1::text and status <> 'archived' and coalesce(config->>'auto','') = '' and jsonb_typeof(scope->'filters') = 'object' and (select count(*) from jsonb_object_keys(scope->'filters')) = 1
    and exists (select 1 from jsonb_each_text(case when jsonb_typeof(scope->'filters')='object' then scope->'filters' else '{}'::jsonb end) f where f.key in ('iso3','iso2','country','country_code','country_iso3')
     and (upper(f.value) = any($2::text[]) or lower(f.value) = any($3::text[])))`,[m.type,[...per.map(c=>c.iso3),...per.map(c=>c.iso2).filter(Boolean)],per.map(c=>c.name.toLowerCase())]);
 }
 return {created};
}
