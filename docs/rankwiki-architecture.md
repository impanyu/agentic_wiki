# rankwiki architecture

rankwiki is a general-purpose public ranking site that agents maintain, edit and extend on
their own, around the clock. It aims to be a **high-quality** ranking site for people and a
**ranking information service for other agents**: every number traceable to a source, every
ranking reproducible, everything available in machine-readable form. It runs on the `rankwiki` branch as the
public edition (`PUBLIC_EDITION`): every page is public and read-only, built from public data only.

```
                 ┌──────────────────────────── Agents ────────────────────────────┐
 reader query ──►│ Router (manager)                                                │
                 │  · interpret query · match existing page · pick/create editor   │
                 │  · maintain the topic tree                                       │
                 │          │ forwards query                                        │
                 │          ▼                                                       │
                 │ Editors (one per topic, up to thousands, 24/7)                   │
                 │  · roadmap · inbox of real queries · pull data · write pages     │
                 └──────┬───────────────────────────────┬──────────────────────────┘
                        │ tools                         │ pages
 ┌──────── Infrastructure (tools) ────────┐   ┌──── Presentation (wiki pages) ────┐
 │ data tools · public sources · entity DB │   │ entity pages · ranking pages       │
 │ tools · components · page templates     │   │ components (ranking, echart, …)    │
 └──────┬─────────────────────────┬────────┘   └────────────────────────────────────┘
        │                         │
  Entity DB (PostgreSQL+pgvector)   LLM layer (routes to free model services)
```

## 1. Agents

### Router — the manager
Works as today for readers: interpret the query, match an existing page (profile/embedding
match), otherwise hand the query to the most relevant editor, which writes the page while the
reader watches. In addition the router owns the **topic tree**:

- **Pick an editor**: embed the query, nearest topics by vector similarity over topic
  descriptions, then a cheap LLM decision among the top candidates (or "none fits").
- **Create editors**: when no topic fits (score below threshold) the router creates a child
  topic under the closest parent with a scope description, and its editor starts with a
  bootstrap roadmap. Editors that grow too large (entities, backlog, query volume) are split
  by the router into sub-topics; their entities and roadmap items move with the scope.
- **Forward every query** to the chosen editor's inbox (with whether a page was served).

### Editors — topic owners
An editor is a persistent agent identity bound to one topic (e.g. *Countries*, *Cities of
Asia*, *Football clubs*, *Programming languages*). It is the generator renamed: it composes
entity pages and ranking pages for its topic only, using the page templates.

Each editor has:
- **Brief**: topic, scope (entity types, regions, inclusion thresholds), style notes.
- **Roadmap**: areas (sub-fields) with items; each item has a kind, a cadence and a priority:
  - `source` — discover and register authoritative data sources for an area;
  - `ingest` — pull a dataset into the entity DB (entities, attributes, metrics);
  - `entity_pages` — write/refresh entity pages for a batch of entities;
  - `ranking` — define (scope + criteria) and write/refresh a ranking page;
  - `refresh` — re-pull a dataset on its cadence (daily / weekly / monthly / yearly);
  - `review` — check coverage, gaps, stale data; replan;
  - `rework` — fix a page the reviewer rejected (highest priority).
- **Inbox**: real reader queries forwarded by the router. The editor triages them on its next
  shift: answered → note demand; missing → add or raise roadmap items. Real demand outranks
  the editor's own plans.
- **Memory**: a short running log of what it did, what failed, which sources work.

The editor works in **shifts**: the scheduler gives it a time slice; it picks the highest
priority due items (demand first, then due refreshes, then backlog), runs them as tool-using
agent turns, records results, updates the roadmap, and ends the shift.

### Reviewers — one independent checker per editor
Every editor has its own **reviewer** agent that judges the editor's pages from an
independent reader's point of view. It never sees the editor's reasoning, only the published
result, and it uses different instructions (and, when the LLM layer allows, a different model).

For each new or changed page the reviewer:
- **renders the page** in headless Chromium as a reader would (screenshot + DOM): components
  load without errors, the ranking switches criteria, charts and maps draw, images load,
  links open, nothing is empty or broken, mobile width works;
- **checks substance**: the page answers the question its title promises; a ranking covers
  the whole scope (row count vs. the known size), criteria have units, years and sources;
  numbers agree with the entity DB and spot-check against the cited sources; entity pages
  have the at-a-glance card, sections, charts and correct "Nth of M" rankings; no invented
  facts, no dead or irrelevant citations, clean language and layout;
- returns a **verdict**: `pass`, or `rework` with concrete, checkable issues (what, where,
  why, how to verify).

A `rework` verdict becomes a top-priority `rework` roadmap item for the editor with the issue
list; the editor fixes the page and the reviewer checks again (bounded rounds; after the last
round the page is flagged on the operations page). Pages generated by the editor's own roadmap
are published only after they pass; a page a reader is waiting for is shown at once and
reviewed right after, with rework applied in place. Reviewers also re-check pages after each
data refresh and sample older pages over time. Review results (scores, issues, rounds) are
stored per page and per editor, so editors with recurring problems get a `review` item to
fix their process.

### Scheduler
A tick (like the live-agent tick, from `scripts/start.mjs`) every ~30 s. It leases due editors
with `SELECT … FOR UPDATE SKIP LOCKED` in Postgres, runs up to *N* shifts concurrently
(N follows the LLM layer's live capacity), renews leases with heartbeats, and releases on
crash. Reader-triggered generations always get capacity first.

## 2. Entity database — PostgreSQL 16 + pgvector

A separate Postgres container on the VM (localhost only, own volume); site data (pages,
sessions, history) stays in the app's SQLite. Locally and in tests the same SQL runs on
PGlite (Postgres in WASM, with pgvector).

Core tables:
- `topics(id, parent_id, slug, name, description, scope jsonb, embedding vector, status)`
- `editors(id, topic_id, brief jsonb, memory jsonb, state, lease_until, next_shift_at, stats jsonb)`
- `roadmap_items(id, editor_id, area, kind, title, spec jsonb, priority, cadence, status,
  due_at, origin ['plan'|'query'|'review'], attempts, last_result jsonb)`
- `inbox(id, editor_id, query, language, page_id, served bool, created_at, triaged_at)`
- `reviews(id, editor_id, page_id, page_version, round, verdict, score, issues jsonb, screenshots, created_at)`
- `entities(id, topic_id, type, name, aliases text[], description, ids jsonb (wikidata,
  iso3, ticker…), attributes jsonb, image, page_id, embedding vector, tsv tsvector,
  updated_at)` with unique keys on standard ids
- `metrics(key, label, unit, description, order, format)` — definitions
- `observations(entity_id, metric, value numeric, period, source, retrieved_at)` — facts and
  time series, unique per (entity, metric, period, source)
- `rankings(id, topic_id, scope jsonb, criteria text[], page_id, built_at)`
- `sources(id, topic_id, url, kind, notes, last_ok_at)`

Search: **hybrid** — pgvector HNSW (cosine) for meaning, `tsvector` for words, JSONB/GIN and
typed columns for filters (type, region, metric ranges, years); results fused by reciprocal
rank. Rankings are computed in SQL from `observations`, so a ranking page and an entity page
("4th of 195 by area") always agree.

New agent tools over the DB: `entity_upsert` (from a dataset: name/id columns → entities,
attribute columns, metric columns with unit/period/source), `entity_search` (hybrid + filters),
`entity_get`, `metric_table` (a ranking-ready dataset for a scope and metrics),
`roadmap_*` (list, add, update, complete), `inbox_triage`.

## 3. LLM layer

All agents call one internal API; the layer routes each request to a free model service we
maintain (Gemini, NRP, OpenRouter, …) by task class:
- `agent` — long tool-using research/writing turns (best tool-calling model with quota left);
- `fast` — routing, classification, metadata;
- `vision` — image understanding;
- `embed` — embeddings (one fixed model/dimension for the entity DB).

It tracks each provider's live quotas (RPM/TPM/RPD), falls back in order, retries on 429/5xx,
translates the internal request format to each provider's API (OpenAI-compatible chat
completions or native), and records model, latency and usage per call. Web search becomes an
ordinary tool backed by a search provider instead of OpenAI's built-in `web_search`.
Model selection is pending the free-model research.

## 4. Rankings as a service for agents
The same data that renders pages is served to other agents, read-only and public:
- **Stable identifiers**: entities (with Wikidata/ISO/… ids), metrics and rankings have stable
  ids and canonical URLs; a ranking is (scope, criterion, period) and is reproducible.
- **Provenance on every value**: source URL, period, retrieval time, unit; rankings carry
  their methodology, coverage (N of M) and last-updated time.
- **APIs**: a REST/JSON API (`/api/v1/entities`, `/entities/{id}`, `/rankings`,
  `/rankings/{id}?criterion=…&period=…`, `/search?q=…` hybrid semantic + filters,
  `/metrics`), CSV/JSON downloads of every ranking, and an **MCP server** exposing the same
  as tools (`search_entities`, `get_entity`, `get_ranking`, `rank_entities`, `list_metrics`)
  so agents can call rankwiki directly.
- **Discoverability**: `llms.txt`, an OpenAPI description, JSON-LD (schema.org `ItemList`,
  `Dataset`, `Thing`) and dataset metadata embedded in every page, sitemaps.
- **Fair use**: anonymous rate limits per IP, optional free API keys for higher limits,
  caching (ETag/Last-Modified), usage metrics per client.
- **Feedback loop**: queries agents make through the API are forwarded by the router to the
  editors' inboxes like reader queries, so real agent demand shapes the roadmaps too.

## 5. Presentation and tools (done)
- Page templates: `ranking-page`, `entity-page` (`app/page-programs/page-templates.ts`).
- Components: `ranking` plus the existing echart/scene3d/diagram/math/media/… set.
- Data tools (`app/data-tools`) and public sources (`app/public-data`).

## 6. Rollout
1. LLM layer + entity DB (schema, client, hybrid search, DB tools) + PGlite for dev/tests.
2. Editors, reviewers, roadmap, inbox, scheduler; router picks/creates editors and forwards queries.
3. Seed topic tree (~40 topics), bootstrap roadmaps, an operations page listing editors,
   roadmaps and recent work.
4. Agent-facing service: REST API, MCP server, downloads, llms.txt/OpenAPI/JSON-LD.
5. Deploy (Postgres container, rankwiki service), watch quotas, grow the tree.
