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

### Topic teams
Each topic is run by a team of three agents, created together by the router:
- **editor** — roadmap, data requests, pages;
- **reviewer** — independent checks of the editor's pages, rework requests;
- **collector** — the team's data: designs the entity-type schemas of its topic (fields,
  metrics, units, identity keys), and writes, tests and repairs the ingestion recipes for
  those types — a recipe is specific to (entity type × source), because each type is
  stored differently and draws on its own set of sources. It also watches coverage and
  freshness and settles conflicts. It runs on demand (new data request, broken recipe,
  conflict), not continuously.

Shared infrastructure (no agents):
- **Platform building blocks** in the recipe library: how to open and parse a platform's
  pages or API (e.g. Amazon product page, Shopify products.json, schema.org Product,
  World Bank indicator, Wikidata SPARQL), parameterized and versioned. Collectors build
  their type-specific recipes on top — field mapping, units, validation — and a fix to a
  block helps every team.
- **Per-source request budgets** in the crawler: every recipe that touches a platform shares
  one queue and rate limit for it, so many teams never add up to a ban.
- The entity-type schema registry (base types such as product, company, place, extended per
  topic), the crawler (replays recipes without a model) and the entity DB.

### Data collection — crawler infrastructure plus on-demand collector agents
Scheduled crawling and refreshing is infrastructure, not an agent's job. Only the parts that
need judgment use a model.

- **Recipes**: a declarative *ingestion recipe* says how to get one dataset: tool and URL
  pattern, pagination, JSONata selection, mapping to entities/metrics/attributes, identity
  keys, units, schedule, and validation (expected row count range, required fields, value
  ranges). Recipes are stored in the entity DB, versioned, and reused by every editor.
- **Crawler (infrastructure, no LLM)**: a scheduler and workers replay recipes on their
  schedules, 24/7 — incremental fetches, writing observations with source and retrieval time,
  coverage and freshness bookkeeping, change detection. When a run fails validation (rows
  drop, schema changes, a page is blocked) it raises an event instead of guessing. It scales
  out by adding worker machines.
- **Collector agent (on demand, cheap model class)**: the judgment part of collection —
  where to get data when a source is blocked or thin, which source is authoritative, how its
  fields map. Started only by events —
  (1) an editor's data request no recipe covers yet → find authoritative sources, write and
  test a recipe; (2) a recipe broke → repair it; (3) a conflict or identity match the rules
  cannot settle → adjudicate and record the decision. It exits when done. A complex platform (a large marketplace whose layouts change often)
  may get a dedicated collector agent that owns that platform's recipes long term.
- **Data requests**: editors state what their pages need (scope, entity type, fields,
  coverage, freshness); the request is matched to existing recipes or handed to a collector
  agent; coverage and gaps are reported back to the editor's inbox.
- Data quality duties (source tiers, cross-checks, conflict records, coverage against
  membership lists/universes, freshness SLAs) are enforced by the crawler's validation and the
  collector agent's decisions.

So: per topic **editor** + **reviewer** + **collector** (created by the router); shared:
the **recipe library** (platform building blocks + type recipes), the **crawler** with
per-source budgets, and the **entity DB**.

### How an editor composes a page (replaces the one-shot generator)
Today a page is written in one agent run: a few searches and reads, then the whole article in
one final answer (median 5 model calls, ~3.7K output tokens), under the instruction "match
length to the question" — which is why pages come out short. Editors instead work in stages,
from the entity database outwards:

1. **Dossier** — collect what the DB already knows about the entity or scope (attributes,
   observations with periods and sources, related entities, existing rankings and positions).
2. **Gap filling** — compare the dossier with the template's required fields and sections
   for this entity type; structured data that is missing or stale becomes a data request
   (served by existing recipes or a collector agent); the editor itself reads primary documents for narrative facts, writing
   every fact back to the DB with source and retrieval time before it is used on a page.
3. **Outline** — the entity-type template gives the section plan (e.g. a country: geography,
   history, politics, economy, demographics, culture, infrastructure, rankings; a company:
   business, products, history, leadership, financials, competitors, rankings) with a target
   depth set by the entity's importance and the evidence available — major entities get long,
   comprehensive articles; minor ones stay proportionate but never thin.
4. **Section drafting** — each section is written in its own model call from its slice of the
   dossier and sources (parallel where possible), so length is not capped by one answer and
   every paragraph is grounded; components (stats cards, charts from observations, ranking
   positions) are generated from DB queries, not typed by hand.
5. **Assembly and checks** — lead, infobox, sections, references (each citation = a source
   row), "data as of" stamps; automated checks (coverage, numbers vs. DB, links), then the
   reviewer.

### Freshness, completeness and authority (editor duties)
- **Every fact is dated and cited**: observations and attributes keep source, period and
  retrieval time; pages show "data as of" per section and per ranking.
- **Freshness SLA per field**: each metric/attribute class has a refresh cadence derived from
  its source (daily prices, monthly stats, annual indicators, rarely-changing facts); the
  roadmap schedules `refresh` items; stale facts are flagged on pages and to the reviewer.
- **Change propagation**: when a refresh changes a value, the editor re-renders the affected
  sections and rankings (not the whole page) and records a page version.
- **Ranking completeness** depends on the kind of scope, recorded on every ranking:
  - *closed sets* (countries, US states, a league's clubs): an authoritative membership list
    stored with its source; coverage = ranked / members must be ~100%;
  - *large catalogs* (companies, universities, apps, perfumes): an explicit universe — a
    comprehensive catalog plus a public eligibility threshold (e.g. "in a major fragrance
    database, ≥1,000 community ratings, in production"), a dedupe rule for variants
    (flankers, editions, concentrations); coverage is measured against that universe and
    the page shows eligible / ranked / excluded-for-insufficient-data counts;
  - *subjective "best"* (best perfumes, best films): "best" is broken into measurable
    criteria — vote-weighted community rating (Bayesian average, so 20 votes can't beat
    20,000), critics' scores, awards, popularity/sales — plus an optional editor-designed
    composite index (versioned, with methodology and sensitivity analysis).
  Cross-checks catch gaps: items on award lists, bestseller charts or critics' lists that are
  missing from the universe are flagged; the reviewer spot-checks well-known members.
  Broad scopes get sub-rankings (by category, price tier, era, region) whose universes are
  sharper. Agents use any page a normal anonymous visit opens; where a page actually requires
  a login, a CAPTCHA or an interactive challenge they stop and use archives (Wayback Machine,
  Common Crawl), official APIs or data dumps instead; the page says which criteria have
  reduced coverage.
- **Ranking authority**: each criterion names its source tier; lower-tier values are
  cross-checked; conflicts are recorded and resolved (see Quality).

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
- `metrics(key, version, kind observed|derived, label, unit, order, format, definition jsonb,
  methodology, created_by, status draft|published|retired)` — public, versioned definitions
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

### Quality: data, pages and rankings
Quality is the product. Three gates, each checked by the editor and again by its reviewer:

**Data collection**
- Source tiers: official statistics and registries (UN, World Bank, national agencies,
  exchanges, standards bodies) > curated open data (Wikidata, OpenAlex, OSM) > reputable
  secondary compilations (Wikipedia lists with citations) > everything else. Each `sources`
  row records its tier, licence, update frequency and last successful pull.
- Cross-checks: a value from a lower tier is verified against a second source; disagreements
  beyond a tolerance are recorded as conflicts and resolved by tier, recency and
  definitional match — never silently averaged.
- Automated checks on every ingest: coverage (rows vs. the known size of the scope),
  units and scale (e.g. thousands vs. units), outliers against the previous pull and peers,
  duplicates and identity merges, period consistency (no mixing 2019 and 2023 in one ranking
  without saying so), freshness against the source's cadence.
- Every observation keeps source URL, period, retrieval time and the transformation applied.
- Collection policy: agents may fetch anything a normal anonymous visit can open — including
  sites served through bot-protection services, as long as the page loads normally; they stop
  only when a page actually requires a login, a CAPTCHA or an interactive challenge. They never
  solve CAPTCHAs, spoof fingerprints to defeat detection, rotate proxies to evade blocks or log
  in. Challenge detection looks for real interstitials (Cloudflare "Just a moment", "Verify you
  are human", hCaptcha/reCAPTCHA/Turnstile challenge pages, PerimeterX, DataDome, login walls),
  not the mere presence of a protection script; a blocked tool call returns
  `{blocked, reason, fallbacks}`.
- Fallbacks: the `archive` public source — `wayback_snapshots` / `wayback_fetch` (Wayback CDX
  index and raw `id_` snapshots) and `commoncrawl_index` / `commoncrawl_fetch` (Common Crawl
  URL index, falling back to its published cluster.idx/cdx files when the index server is
  overloaded; one WARC record by HTTP Range) — lists every captured page of a site section and
  reads pages that are gone or blocked. `extract_tables`, `browse_page` and `crawl_pages` fall
  back to the latest Wayback capture automatically and mark it `fromArchive` with
  `snapshotUrl` and the capture date, which the page cites. archive.org and the Common Crawl
  index are paced at about one request per second in the shared limiter.
- Crawling: `crawl_pages` stays polite (≥1 s per host, same site, page cap) and obeys
  robots.txt by default; `CRAWL_ROBOTS=ignore` makes it follow matching links regardless, and
  every result reports the mode used.

**Page generation** — the page templates, components and the reviewer's checklist (section
"Reviewers"); a page is published only after it passes.

**Rankings and metrics — public and transparent**
- Every metric has a public definition page: what it measures, unit, direction, sources,
  periods, coverage, known caveats, version history.
- **Editors can design their own metrics** (indices and derived measures, e.g. "innovation
  index = 0.4·patents per capita + 0.3·R&D share of GDP + 0.3·top-500 universities per
  capita"). A derived metric is declarative, not code: inputs (metrics, periods,
  transforms such as log or per capita), normalization (min-max, z-score, percentile),
  combination (weighted sum/geometric mean, ratio, difference), weights, a missing-data rule
  and the scope. Definitions are versioned and immutable once used; a change makes a new
  version, and rankings say which version they use.
- Before a derived metric is published the editor writes its methodology, the system
  computes a **sensitivity analysis** (how the top ranks move when each weight changes ±20%
  or an input is dropped), and the reviewer checks the definition is meaningful, not
  redundant, not double-counting, and robust enough; results appear on the metric page.
- Ranking pages show for each criterion: definition link, source, period, coverage (N of M),
  tie rule and how missing values are treated; downloads include the full provenance.

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
Implemented in `app/llm` (chains, limits and prices in `catalog.ts`/`prices.ts`; see
`app/llm/README.md`), with a metered monthly OpenAI budget for the `premium` class.

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
