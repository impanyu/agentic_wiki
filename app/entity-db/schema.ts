import type {Queryable,EntityDb} from './client';
// Versioned, idempotent migrations for the entity database. Each migration is a list of single
// statements run in one transaction under an advisory lock, recorded in schema_version.
// Works on PostgreSQL 16 + pgvector and on PGlite. The embedding dimension is fixed when the
// schema is created (ENTITY_EMBED_DIM, default 768) and recorded in entity_meta.
const MIGRATION_LOCK=724_001;
// Standard identifier keys with a uniqueness guarantee. wikidata is global (a QID names one thing
// whatever its type); the others are unique within an entity type (iso3 "GEO" the country vs. a language code).
export const GLOBAL_ID_KEYS=['wikidata'] as const;
export const TYPED_ID_KEYS=['iso3','iso2','ticker','isin','lei','isbn','doi','imdb','osm','geonames','iata','icao','ror','orcid','fifa','un_m49'] as const;
export const STANDARD_ID_KEYS:readonly string[]=[...GLOBAL_ID_KEYS,...TYPED_ID_KEYS];

type Migration={version:number;name:string;statements:(dim:number)=>string[]};
const audit='created_at timestamptz not null default now(), updated_at timestamptz not null default now()';
export const MIGRATIONS:Migration[]=[
 {version:1,name:'entity database',statements:dim=>[
  'create extension if not exists vector',
  'create table if not exists entity_meta(key text primary key, value text not null)',
  `insert into entity_meta(key,value) values ('embed_dim','${dim}') on conflict (key) do nothing`,
  // Name normalisation used by identity resolution: lower case, single spaces, straight quotes.
  `create or replace function ent_norm(t text) returns text language sql immutable parallel safe as $$
    select lower(regexp_replace(btrim(translate(coalesce(t,''), '’‘“”', '''''""')), '\\s+', ' ', 'g')) $$`,
  `create or replace function ent_keys(n text, a text[]) returns text[] language sql immutable parallel safe as $$
    select coalesce(array(select distinct ent_norm(x) from unnest(array_prepend(n, coalesce(a,'{}'::text[]))) x where ent_norm(x) <> ''), '{}'::text[]) $$`,
  // Aliases: deduplicated by normalised form, never equal to the name, first spelling kept.
  `create or replace function ent_merge_aliases(n text, a text[]) returns text[] language sql immutable parallel safe as $$
    select coalesce(array(select x from (select distinct on (ent_norm(x)) x, o from unnest(coalesce(a,'{}'::text[])) with ordinality u(x,o)
      where ent_norm(x) <> '' and ent_norm(x) <> ent_norm(n) order by ent_norm(x), o) s order by o), '{}'::text[]) $$`,
  // 'simple' configuration: no stemming, works for any language.
  `create or replace function ent_tsv(n text, a text[], d text) returns tsvector language sql immutable parallel safe as $$
    select setweight(to_tsvector('simple', coalesce(n,'')), 'A') || setweight(to_tsvector('simple', array_to_string(coalesce(a,'{}'::text[]), ' ')), 'B') || setweight(to_tsvector('simple', coalesce(d,'')), 'C') $$`,
  `create or replace function ent_num(t text) returns double precision language sql immutable parallel safe as $$
    select case when t ~ '^\\s*[-+]?[0-9]*\\.?[0-9]+([eE][-+]?[0-9]+)?\\s*$' then t::double precision end $$`,

  `create table if not exists topics(id uuid primary key default gen_random_uuid(), parent_id uuid references topics(id) on delete set null,
    slug text not null unique, name text not null, description text not null default '', scope jsonb not null default '{}'::jsonb,
    embedding vector(${dim}), status text not null default 'active' check (status in ('active','splitting','archived')), ${audit})`,
  'create index if not exists topics_parent on topics(parent_id)',
  'create index if not exists topics_embedding on topics using hnsw (embedding vector_cosine_ops)',

  `create table if not exists editors(id uuid primary key default gen_random_uuid(), topic_id uuid not null references topics(id) on delete cascade,
    brief jsonb not null default '{}'::jsonb, memory jsonb not null default '[]'::jsonb,
    state text not null default 'idle' check (state in ('idle','running','paused','retired')),
    lease_id uuid, lease_until timestamptz, next_shift_at timestamptz not null default now(), stats jsonb not null default '{}'::jsonb, ${audit})`,
  'create index if not exists editors_topic on editors(topic_id)',
  "create index if not exists editors_due on editors(next_shift_at) where state in ('idle','running')",

  `create table if not exists roadmap_items(id uuid primary key default gen_random_uuid(), editor_id uuid not null references editors(id) on delete cascade,
    area text not null default '', kind text not null check (kind in ('source','ingest','entity_pages','ranking','refresh','review')),
    title text not null, spec jsonb not null default '{}'::jsonb, priority integer not null default 50, cadence text not null default '',
    status text not null default 'pending' check (status in ('pending','running','done','failed','cancelled')),
    due_at timestamptz not null default now(), origin text not null default 'plan' check (origin in ('plan','query','review')),
    attempts integer not null default 0, last_result jsonb, last_run_at timestamptz, ${audit})`,
  'create index if not exists roadmap_due on roadmap_items(editor_id, status, due_at)',

  `create table if not exists inbox(id uuid primary key default gen_random_uuid(), editor_id uuid not null references editors(id) on delete cascade,
    query text not null, language text not null default '', page_id text, served boolean not null default false,
    created_at timestamptz not null default now(), triaged_at timestamptz, note text)`,
  'create index if not exists inbox_open on inbox(editor_id, created_at) where triaged_at is null',

  `create table if not exists entities(id uuid primary key default gen_random_uuid(), topic_id uuid references topics(id) on delete set null,
    type text not null, name text not null, aliases text[] not null default '{}'::text[], description text not null default '',
    ids jsonb not null default '{}'::jsonb, attributes jsonb not null default '{}'::jsonb, image text, page_id text,
    embedding vector(${dim}),
    name_keys text[] generated always as (ent_keys(name, aliases)) stored,
    tsv tsvector generated always as (ent_tsv(name, aliases, description)) stored, ${audit})`,
  'create index if not exists entities_type on entities(type)',
  'create index if not exists entities_topic on entities(topic_id)',
  'create index if not exists entities_ids on entities using gin (ids)',
  'create index if not exists entities_attributes on entities using gin (attributes)',
  'create index if not exists entities_name_keys on entities using gin (name_keys)',
  'create index if not exists entities_tsv on entities using gin (tsv)',
  'create index if not exists entities_embedding on entities using hnsw (embedding vector_cosine_ops)',
  // Name uniqueness only binds entities that carry no standard id (those are told apart by their ids).
  "create unique index if not exists entities_type_name on entities(type, ent_norm(name)) where ids = '{}'::jsonb",
  ...GLOBAL_ID_KEYS.map(k=>`create unique index if not exists entities_id_${k} on entities((ids->>'${k}')) where ids ? '${k}'`),
  ...TYPED_ID_KEYS.map(k=>`create unique index if not exists entities_id_${k} on entities(type, (ids->>'${k}')) where ids ? '${k}'`),

  // Metric definitions are public. (key, version) is immutable in meaning once used or published:
  // a change to unit, order, kind or definition creates the next version.
  `create table if not exists metrics(key text not null, version integer not null default 1, label text not null, unit text not null default '',
    description text not null default '', methodology text not null default '',
    sort_order text not null default 'desc' check (sort_order in ('desc','asc')), format text not null default '',
    kind text not null default 'observed' check (kind in ('observed','derived')), definition jsonb,
    created_by text not null default 'system', status text not null default 'published' check (status in ('draft','published','retired')),
    used boolean not null default false, ${audit}, primary key (key, version))`,

  // Facts and time series. metric_version is 0 for observed values and the definition version for derived ones
  // (whose source is 'derived:<key>@v<version>').
  `create table if not exists observations(entity_id uuid not null references entities(id) on delete cascade, metric text not null,
    metric_version integer not null default 0, value numeric not null, period text not null default '', source text not null default '',
    retrieved_at timestamptz not null default now(), primary key (entity_id, metric, period, source))`,
  'create index if not exists observations_metric on observations(metric, metric_version, period)',
  'create index if not exists observations_source on observations(source)',

  `create table if not exists rankings(id uuid primary key default gen_random_uuid(), topic_id uuid references topics(id) on delete set null,
    title text not null default '', scope jsonb not null default '{}'::jsonb, criteria text[] not null default '{}'::text[], page_id text, built_at timestamptz not null default now())`,
  `create table if not exists sources(id uuid primary key default gen_random_uuid(), topic_id uuid references topics(id) on delete cascade,
    url text not null, kind text not null default '', notes text not null default '', last_ok_at timestamptz, created_at timestamptz not null default now())`,
  "create unique index if not exists sources_topic_url on sources(coalesce(topic_id::text, ''), url)",
 ]},
 // Relations between entities: one row per (subject, predicate, object, period), with its source.
 // "Chanel No. 5 —brand→ Chanel", "Paris —country→ France", "France —part_of→ Europe".
 {version:2,name:'entity relations',statements:()=>[
  `create table if not exists relations(subject_id uuid not null references entities(id) on delete cascade, predicate text not null,
    object_id uuid not null references entities(id) on delete cascade, period text not null default '', qualifiers jsonb not null default '{}'::jsonb,
    source text not null default '', retrieved_at timestamptz not null default now(), primary key (subject_id, predicate, object_id, period),
    check (subject_id <> object_id))`,
  'create index if not exists relations_object on relations(object_id, predicate)',
  'create index if not exists relations_predicate on relations(predicate)',
 ]},
 // Snapshot of each entity's latest metric values (with rank among its type) and outgoing relations, derived from
 // observations and relations and kept current on every write, so a page is rendered from one row. Never a source:
 // rebuildLatest() recreates it. {metrics:{population:{value,period,source,retrievedAt,rank,of}}, relations:{brand:[{id,name}]}}
 {version:3,name:'entity latest snapshot',statements:()=>[
  "alter table entities add column if not exists latest jsonb not null default '{}'::jsonb",
 ]},
 // Topic teams' configuration (written by agents through tools, read by the page renderer and the crawler):
 // entity_types: an editor's template and a collector's schema per entity type; rankings gain a public slug and
 // their definition; recipes: a collector's declarative fetch-and-load rules, run without an agent;
 // team_runs: what each agent of a team did, for the operations page.
 {version:4,name:'topic team configuration',statements:()=>[
  `create table if not exists entity_types(type text primary key, topic_id uuid references topics(id) on delete set null,
    label text not null default '', plural text not null default '', description text not null default '',
    schema jsonb not null default '{}'::jsonb, template jsonb not null default '{}'::jsonb,
    status text not null default 'draft' check (status in ('draft','published')), updated_by text not null default '', ${audit})`,
  "alter table rankings add column if not exists slug text",
  "alter table rankings add column if not exists config jsonb not null default '{}'::jsonb",
  "alter table rankings add column if not exists status text not null default 'draft'",
  "alter table rankings add column if not exists updated_at timestamptz not null default now()",
  'create unique index if not exists rankings_slug on rankings(slug) where slug is not null',
  `create table if not exists recipes(id uuid primary key default gen_random_uuid(), type text not null, name text not null,
    description text not null default '', steps jsonb not null default '[]'::jsonb, schedule text not null default '',
    status text not null default 'active' check (status in ('active','paused','failed')), created_by text not null default '',
    last_run_at timestamptz, last_result jsonb, ${audit}, unique (type, name))`,
  `create table if not exists team_runs(id uuid primary key default gen_random_uuid(), topic_id uuid references topics(id) on delete cascade,
    role text not null, task text not null default '', status text not null default 'running', summary text not null default '',
    calls jsonb not null default '[]'::jsonb, cost_usd numeric not null default 0, started_at timestamptz not null default now(), finished_at timestamptz)`,
  'create index if not exists team_runs_topic on team_runs(topic_id, started_at desc)',
 ]},
 // Rankings are found by meaning too: the router compares a query with each ranking's title, scope and criteria.
 {version:5,name:'ranking embeddings',statements:dim=>[
  `alter table rankings add column if not exists embedding vector(${dim})`,
  'create index if not exists rankings_embedding on rankings using hnsw (embedding vector_cosine_ops)',
 ]},
 // One vector per ranking view: the ranking as a whole (criterion '') and each criterion ("Country Rankings by
 // CO2 emissions per capita"), so a query about one measure finds that view directly.
 {version:6,name:'ranking view vectors',statements:dim=>[
  `create table if not exists ranking_vectors(ranking_id uuid not null references rankings(id) on delete cascade, criterion text not null default '',
    text text not null, embedding vector(${dim}) not null, created_at timestamptz not null default now(), primary key (ranking_id, criterion))`,
  'create index if not exists ranking_vectors_embedding on ranking_vectors using hnsw (embedding vector_cosine_ops)',
 ]},
 // Whether an entity has a page: its type has a page template and the entity meets the template's threshold
 // (template.page.minMetrics, default 1) — a stub that only has a name (created as the far end of a relation)
 // gets no page until data arrives. Kept current on every write; links, the sitemap and the router use it.
 {version:7,name:'entity pages',statements:()=>[
  'alter table entities add column if not exists has_page boolean not null default false',
  'create index if not exists entities_pages on entities(type) where has_page',
 ]},
 // A short, permanent number per entity: its page address is /e/<num>/<slug> (the slug is only for reading).
 {version:8,name:'entity numbers',statements:()=>[
  'alter table entities add column if not exists num bigint generated by default as identity',
  'create unique index if not exists entities_num on entities(num)',
 ]},
 // Reader views of ranking pages per day (counted from browsers, once per page per session): what is popular.
 {version:9,name:'ranking views',statements:()=>[
  'create table if not exists ranking_views(slug text not null, day date not null default current_date, n integer not null default 0, primary key (slug, day))',
 ]},
 // What readers searched for and how many pages answered: the manager reads it to grow the topic tree.
 {version:10,name:'search log',statements:()=>[
  `create table if not exists search_log(id bigserial primary key, query text not null, norm text not null, locale text not null default 'en',
    results integer not null default 0, handled boolean not null default false, at timestamptz not null default now())`,
  'create index if not exists search_log_open on search_log(at) where not handled',
 ]},
 // Topic teams waiting to run (the scheduler starts them within the concurrency and budget limits), and small
 // platform state (when the manager last ran).
 {version:11,name:'team queue',statements:()=>[
  `create table if not exists team_queue(slug text primary key, name text not null, brief text not null, parent_slug text, priority integer not null default 0,
    status text not null default 'queued' check (status in ('queued','running','done','failed')), note text not null default '',
    created_at timestamptz not null default now(), started_at timestamptz, finished_at timestamptz)`,
  'create index if not exists team_queue_next on team_queue(priority desc, created_at) where status = \'queued\'',
  'create table if not exists platform_state(key text primary key, value jsonb not null default \'{}\'::jsonb, updated_at timestamptz not null default now())',
 ]},
];
export const SCHEMA_VERSION=MIGRATIONS[MIGRATIONS.length-1].version;

export async function migrate(db:EntityDb,{embedDim}:{embedDim:number}):Promise<{applied:number[];version:number;embedDim:number}>{
 if(!Number.isInteger(embedDim)||embedDim<1||embedDim>16000)throw Error('Invalid embedding dimension '+embedDim+'.');
 await db.query('create table if not exists schema_version(version integer primary key, name text not null, applied_at timestamptz not null default now())');
 const applied:number[]=[];
 for(const m of MIGRATIONS){
  const done=await db.query('select 1 from schema_version where version=$1',[m.version]);
  if(done.rows.length)continue;
  await db.tx(async(q:Queryable)=>{
   await q.query('select pg_advisory_xact_lock($1)',[MIGRATION_LOCK]);
   if((await q.query('select 1 from schema_version where version=$1',[m.version])).rows.length)return;
   for(const s of m.statements(embedDim))await q.query(s);
   await q.query('insert into schema_version(version,name) values ($1,$2)',[m.version,m.name]);
   applied.push(m.version);
  });
 }
 const stored=Number((await db.query<{value:string}>("select value from entity_meta where key='embed_dim'")).rows[0]?.value);
 if(stored&&stored!==embedDim)console.warn(`entity-db: embeddings are ${stored}-dimensional (fixed at creation); ENTITY_EMBED_DIM=${embedDim} is ignored.`);
 return {applied,version:SCHEMA_VERSION,embedDim:stored||embedDim};
}
export async function storedEmbedDim(db:Queryable):Promise<number>{
 return Number((await db.query<{value:string}>("select value from entity_meta where key='embed_dim'")).rows[0]?.value)||0;
}
