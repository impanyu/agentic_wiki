# Generative Data Platform — the framework RankWiki is built on

A user says what data they want ("every electric car, to compare performance and price"). The platform plans it
(what entities, which fields, which sources, how to show it), collects it, checks it, shows it — and keeps growing
it on its own. Unlike a database, which stores what it is given and answers what it is asked, the platform is
**proactive and generative**: bottom-up it keeps producing new data products (fields filled, new measures and
indices computed from existing data) and new presentation products (new rankings, comparisons, topics designed
from the reader's point of view). New presentations need new data, which drives collection again.

RankWiki (rankwiki.aisoup.net) is the first project on it. Further data projects follow on the same framework;
what is project-specific (class tree, templates, site map, look) is configuration, the rest is the framework.

## Parts

| Part | Kind | Does |
|---|---|---|
| **Sources** | layer | Pre-wired channels: public APIs (keys managed centrally), search, own site index, web extraction, open data dumps. |
| **Data** | layer | Collect, store, index. Owns the data standards (templates, member admission, units, identity, sources per class). Zones: raw → curated → derived; every value has source, period and retrieval time. |
| **Refinery** | layer | Curation and analysis with native and third-party tools: entity merging, unit and definition normalisation, enrichment, relations, derived measures and composite indices (formula, inputs, version), recomputed when inputs change. Writes back to Data. |
| **Presentation** | layer | Editors design what readers see: rankings as stored queries, levels of narrowing down, entity pages, comparisons, new views. Owns the presentation standards. |
| **Auditor** | module across layers | One engine with data, refinery and presentation checkers. Only enforces the layers' standards: continuous checks, publication gates, patrols, reviewer agents. Hands problems to the Orchestrator. |
| **Orchestrator** (the manager) | module | Talks to the user: turns a request into a plan by having collectors research scope, templates and sources and editors design the presentation (methods in `planner/`), confirms it (with cost) with the user. Then runs everything: work queue and priorities (reader impact first), which agent pool does what, model capacity and budget, hand-offs between layers, arbitration, escalation to humans. |

Loop: the manager plans with the user; collectors and editors set the standards → layers do the work → Auditor checks → Orchestrator routes fixes → Auditor re-checks.

## In RankWiki's code

| Part | Where |
|---|---|
| Sources | `app/public-data/`, `app/data-tools/`, `app/search/site-index.ts`, recipes (`app/teams/recipes`) |
| Data | `app/entity-db/` (entities, observations, class tree, dedup, units) |
| Refinery | derived metrics and composites (`repo.ts`), `dedup.ts`, `units.ts`, `country-subsets.ts` |
| Presentation | rankings, `pages.ts`, `app/rankings/`, `app/e/`, `app/seo/` |
| Auditor | `app/work/checks.ts`, `completeness.ts`, gates in `app/work/kinds.ts`, reviewer pool |
| Orchestrator | manager pool; `app/work/queue.ts`, `runner.ts`, `triggers.ts`; planning imports `site-map.ts`, `class-specs.ts`; methods in `docs/framework/planner/` |

See `playbook.md` for the lessons each project turns into rules.
