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
export async function countrySubsets(db:Queryable):Promise<{created:number}>{
 const mains=(await db.query<{slug:string;title:string;topic_id:string;type:string;criteria:string[];config:Record<string,unknown>}>(`select slug, title, topic_id, scope->>'type' type, criteria, config from rankings r
  where status = 'published' and topic_id is not null and coalesce(scope->'filters','{}'::jsonb) = '{}'::jsonb and scope->>'type' <> 'country'`)).rows;
 let created=0;
 for(const m of mains){
  const label=String(m.title).replace(/\s*Rankings?\s*$/i,'').trim()||m.type;
  const per=(await db.query<{iso3:string;iso2:string;name:string;continent:string;n:number}>(`select e.attributes->>'country_iso3' iso3, coalesce(upper(c.ids->>'iso2'),'') iso2, c.name, coalesce(c.attributes->>'continent','') continent, count(*)::int n from entities e
    join entities c on c.type = 'country' and upper(c.ids->>'iso3') = e.attributes->>'country_iso3'
    where e.type = $1::text and e.attributes ? 'country_iso3' group by 1, 2, 3, 4 having count(*) >= $2::int order by 5 desc limit 120`,[m.type,MIN])).rows;
  if(per.length<2)continue;// one country: the main ranking is that country's
  for(const c of per){
   const slug=(m.slug+'-in-'+c.iso3.toLowerCase()).slice(0,120);
   const cfg={...m.config,main:undefined,auto:'country',segment:c.name,...(c.continent?{navGroup:c.continent}:{}),about:[`${label} in ${c.name}.`]};delete (cfg as Record<string,unknown>).main;
   const r=await db.query(`insert into rankings(slug,title,topic_id,scope,criteria,config,status) values ($1::text,$2::text,$3::uuid,$4::jsonb,$5::text[],$6::jsonb,'published')
     on conflict (slug) where slug is not null do update set criteria=excluded.criteria, config=excluded.config, topic_id=excluded.topic_id,
      status=case when rankings.status='archived' then 'published' else rankings.status end, updated_at=now()
      where rankings.criteria is distinct from excluded.criteria or rankings.config is distinct from excluded.config or rankings.status='archived' returning (xmax = 0) inserted`,
    [slug,`${label} Rankings in ${c.name}`,m.topic_id,JSON.stringify({type:m.type,filters:{country_iso3:c.iso3}}),m.criteria,JSON.stringify(cfg)]);
   if(r.rows[0]?.inserted)created++;
  }
  // An editor's own one-country subsets of this class (filtered by another form of the country) are the same sets.
  await db.query(`update rankings set status='archived', config=config||'{"mergedInto":"country subset"}'::jsonb, updated_at=now()
   where scope->>'type' = $1::text and status <> 'archived' and coalesce(config->>'auto','') = '' and (select count(*) from jsonb_object_keys(coalesce(scope->'filters','{}'::jsonb))) = 1
    and exists (select 1 from jsonb_each_text(scope->'filters') f where f.key in ('iso3','iso2','country','country_code','country_iso3')
     and (upper(f.value) = any($2::text[]) or lower(f.value) = any($3::text[])))`,[m.type,[...per.map(c=>c.iso3),...per.map(c=>c.iso2).filter(Boolean)],per.map(c=>c.name.toLowerCase())]);
 }
 return {created};
}
