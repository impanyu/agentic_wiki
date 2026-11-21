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
