# Entity database (rankwiki)

Entities, their facts (observations), public metric definitions, and the editor runtime's topics,
editors, roadmap and inbox. PostgreSQL 16 + pgvector in production; PGlite (Postgres in WASM with
pgvector) locally and in tests. The same SQL runs on both. Site data (pages, sessions) stays in SQLite.

| File | Contents |
|---|---|
| `client.ts` | `EntityDb { query, tx, close }`; `createEntityDb(options)`, process-wide `entityDb()`, `setEntityDb()` |
| `schema.ts` | versioned migrations (`schema_version`), run on first use under an advisory lock |
| `metrics.ts` | derived-metric definition (zod) and its pure evaluator; competition ranks |
| `embeddings.ts` | injected embedder (`setEmbedder`), entity embedding text |
| `repo.ts` | repository functions (all take the db first) |
| `tools.ts` | agent tools `entityTools` + `runEntityTool(name, args, ctx, signal)` → `{data}` |

## Environment

| Variable | Meaning |
|---|---|
| `ENTITY_DB_URL` | `postgres://user:pass@127.0.0.1:5432/entities` → node-postgres pool. Unset → PGlite. |
| `ENTITY_DB_POOL` | pool size (default 10) |
| `DATA_DIR` | PGlite data lives in `${DATA_DIR}/entity-db` (default `./data/entity-db`) |
| `ENTITY_EMBED_DIM` | embedding dimension (default 768), **fixed when the schema is created** (stored in `entity_meta.embed_dim`; a later different value is ignored with a warning) |

Run against Postgres:

```sh
docker run -d --name entity-db -p 127.0.0.1:5432:5432 -e POSTGRES_PASSWORD=… -e POSTGRES_DB=entities \
  -v entity-db:/var/lib/postgresql/data pgvector/pgvector:pg16
ENTITY_DB_URL=postgres://postgres:…@127.0.0.1:5432/entities npm run dev
```

The first `entityDb()` call creates the `vector` extension and the schema. Tests: `node --test tests/entity-db.test.mjs` (in-memory PGlite, no Postgres needed).

## Schema

- `topics(id, parent_id, slug, name, description, scope, embedding, status)` — the topic tree.
- `editors(id, topic_id, brief, memory, state, lease_id, lease_until, next_shift_at, stats)`.
- `roadmap_items(id, editor_id, area, kind, title, spec, priority, cadence, status, due_at, origin, attempts, last_result, last_run_at)`.
- `inbox(id, editor_id, query, language, page_id, served, created_at, triaged_at, note)`.
- `entities(id, topic_id, type, name, aliases[], description, ids jsonb, attributes jsonb, image, page_id, embedding, name_keys[], tsv)`;
  `name_keys` (normalised name + aliases) and `tsv` (`'simple'` config: name A, aliases B, description C) are generated columns.
  Indexes: GIN on `ids`, `attributes`, `name_keys`, `tsv`; HNSW `vector_cosine_ops` on `embedding`.
- `metrics(key, version, label, unit, description, methodology, sort_order, format, kind, definition, created_by, status, used)` — PK (key, version).
- `observations(entity_id, metric, metric_version, value, period, source, retrieved_at)` — PK (entity_id, metric, period, source).
  `metric_version` is 0 for observed values, the definition version for derived ones (source `derived:<key>@v<n>`).
- `rankings`, `sources`, `entity_meta`, `schema_version`.

## Identity rule (`upsertEntity` / `upsertEntities`)

1. **Shared standard id** → same entity. `ids` keys are normalised (QIDs read out of Wikidata URLs, iso/ticker
   codes upper-cased). `wikidata` matches across types; every other key (iso3, iso2, ticker, isbn, …) only within
   the type (`iso3 "GEO"` the country is not a language). Unique partial indexes enforce this for the standard keys.
   If two ids point at different entities, the first match (wikidata first) wins and the conflicting keys are not
   written (`idConflicts`).
2. Else **same type and a shared normalised name or alias** (lower case, single spaces, straight quotes) — unless
   both carry the same id key with different values (two "Georgia"s with different QIDs stay apart).
3. Else a new entity. Entities without any id are unique by (type, normalised name).

Merging never overwrites existing ids, adds the new name as an alias, updates attributes, replaces the
description only with a non-empty one, and clears the embedding when the searchable text changed.
Writers serialise on an advisory lock; each row runs in a savepoint so a bad row is reported, not fatal.

## Search (`hybridSearch`)

Three ranked lists, each restricted by type / topic / filters: vector KNN (`embedding <=> query`, only with an
embedder), full text (`to_tsquery('simple', 'w1:* | w2:*')`, ranked by `ts_rank_cd`) and name/alias match
(exact normalised, then prefix). Fused by reciprocal rank: `score = Σ 1/(60 + rank)`. No embedder → text + name
only (`mode: "text"`); empty query → filtered list by name.

Filters (`{"region":"Asia","population":{">":1e7}}`): a key that is a metric compares the entity's latest value;
otherwise an attribute (case-insensitive equality, arrays match any element, numeric comparisons via a safe cast);
`ids.<key>` matches identifiers. Operators: `> >= < <= = != in contains exists`. Every value is a bound parameter.

## Metrics, rankings and derived metrics

- `metricTable` returns one row per entity with each metric's latest (or given-period) value, period, source and
  **competition rank** (ties share a rank, missing values unranked) — the same numbers feed ranking pages and
  `getEntity` facts ("rank 4 of 195"), so they always agree.
- Observed metrics: `defineMetric`. Derived metrics: `defineDerivedMetric` with a declarative definition
  (`inputs` with `transform` none/log/per_capita/per_km2/rank_pct, `normalize`, `combine`
  weighted_sum/weighted_geomean/ratio/difference, `weights`, `missing` skip_entity/reweight/zero, `min_inputs`,
  `scope`). New derived versions are drafts; `publishMetric` makes one public and retires earlier published ones.
- **Versioning**: once a version is used (computed/observed) or published, a change to unit, order or definition
  creates the next version; label/description/methodology/format edit in place.
- `computeDerivedMetric` evaluates over the latest inputs in scope and stores observations; a recompute replaces
  that source's values. `sensitivity` reports how the top 20 move under ±20 % weights and dropped inputs.
- `metricTable` resolves a derived key to its published version (else latest); `key@N` pins a version.
- Weighted combinations divide by Σ|w| (negative weight = lower is better). The geometric mean floors
  min-max/rank-normalised values at 0.01. `per_capita` / `per_km2` divide by the observed `population` / `area_km2`.

## Embeddings

The layer never calls a model. `setEmbedder(texts => Promise<number[][]>)` injects the LLM layer's embedder;
`embedPending(db, limit)` embeds entities and topics whose embedding is null (the entity_upsert tool also starts
it in the background).

## Editor runtime

`createTopic`, `getTopic`, `listChildTopics`, `nearestTopics` (vector, else full text); `createEditor`,
`leaseDueEditors` (`FOR UPDATE SKIP LOCKED`, lease id + expiry), `renewLease`, `releaseEditor`;
`addRoadmapItem`, `updateRoadmapItem`, `listRoadmap`, `dueRoadmapItems` (reader demand first),
`completeRoadmapItem` (cadence → next due; failures back off 1 h, 2 h, 4 h… and fail after 5), `nextDue`;
`addInbox`, `listInbox`, `triageInbox`; `addSource`, `listSources`, `markSourceOk`, `recordRanking`.
