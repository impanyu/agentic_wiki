# Entity-type templates and ranking definitions

Agents (editors, collectors) write these through tools; programs read them to render pages and to
collect data. No agent runs when a page is rendered. Stored in the entity database (Postgres):
`entity_types.template`, `entity_types.schema`, `rankings.config` (+ `rankings.slug/title/scope/criteria`).

## Values a template can name

- `metric.<key>` — the entity's latest value of a metric, formatted with the metric's unit/format
- `period.<key>` — the period of that value ("2023")
- `rank.<key>` / `of.<key>` — its rank among all entities of the type (only when ≤ 1,000), and how many are ranked
- `change.<key>` — change since the previous period ("+1.2%")
- `attr.<name>` — an attribute ("Europe & Central Asia")
- `rel.<predicate>` — the related entity's name (first one), e.g. `rel.capital`
- `name`, `type.label` — the entity's name, the type's label ("country")

## Entity-type template (`entity_types.template`)

```json
{
  "lead": [
    "{name} is a {type.label} in {attr.region} with a population of {metric.population} ({period.population}).",
    "It ranks {rank.population} of {of.population} by population and {rank.gdp_usd} by GDP."
  ],
  "card": ["population", "gdp_usd", "gdp_per_capita_usd", "area_km2", "life_expectancy", "capital", "region"],
  "sections": [
    {"kind": "trend", "title": "Population", "metrics": ["population"]},
    {"kind": "trend", "title": "Economy", "metrics": ["gdp_usd", "gdp_per_capita_usd"]},
    {"kind": "position", "metric": "gdp_per_capita_usd"},
    {"kind": "peer_compare", "metric": "population"},
    {"kind": "radar_profile", "metrics": ["gdp_per_capita_usd", "life_expectancy", "population", "area_km2"]},
    {"kind": "location_map"},
    {"kind": "relations"},
    {"kind": "rankings"},
    {"kind": "text", "title": "Economy", "sentences": ["{name}'s GDP was {metric.gdp_usd} in {period.gdp_usd}, {change.gdp_usd} on the year before."]}
  ]
}
```

- A sentence is shown only when every value it names exists (missing data drops the sentence, never prints a blank).
- `card` items are metric keys (shown with value, year, rank, sparkline) or `attr.`/`rel.` names (shown as text).
- Section kinds: `trend` (metrics over time), `position` (where the entity sits among all of its type),
  `peer_compare` (neighbours by rank), `radar_profile` (percentiles across metrics), `location_map`
  (from `ids.iso3`/`code`, ISO 3166-2, lat/lon attributes), `relations` (relation graph of outgoing and
  incoming relations), `rankings` (every ranking definition whose scope contains the entity, with its rank
  on each criterion), `timeline` (dated attributes), `text` (titled sentences). Unknown kinds are ignored.
- References are assembled from the sources of the facts shown.
- `page` (optional): `{"minMetrics": 3}` — the page threshold. An entity gets a page only when its type has a
  template and it has at least `minMetrics` distinct metrics (default 1, allowed 1–50). Entities below it (a name
  mentioned once, a stub with no data) stay in the DB and still count in rankings, but have no URL: nothing links
  to them, the sitemap and router skip them. The program recomputes this flag (`entities.has_page`) whenever data
  is written and whenever the template is saved, so raising or lowering the threshold takes effect at once.

## Entity-type schema (`entity_types.schema`, written by the collector)

```json
{
  "identity": {"ids": ["iso3", "wikidata"], "match": "Rows merge on any shared id, else same type and name/alias."},
  "metrics": [{"key": "population", "label": "Population", "unit": "people", "order": "desc", "format": "compact", "source": "World Bank SP.POP.TOTL", "history": true}],
  "attributes": ["region", "income_group", "capital"],
  "relations": [{"predicate": "part_of", "type": "region"}],
  "universe": {"source": "World Bank country list (excludes aggregates)", "expected": 217}
}
```

## Ranking definition (`rankings` row: `slug`, `title`, `scope`, `criteria`, `config`)

```json
{
  "slug": "country-rankings",
  "title": "Country Rankings",
  "scope": {"type": "country", "filters": {}},
  "criteria": ["population", "gdp_usd", "gdp_per_capita_usd", "area_km2", "life_expectancy"],
  "config": {
    "default": "population",
    "views": "auto",
    "period": "all",
    "group": "region",
    "lead": "All {count} {type.plural}, ranked by {criteria} ({source}).",
    "about": ["Scope: every country in the World Bank list ({count} of {expected})."],
    "related": ["countries-in-europe-and-central-asia-rankings"]
  }
}
```

- Rendered at `/rankings/<slug>`; rows come from `metric_table` (scope, criteria, period `all` → long form with
  a year picker and time views), at most the top 1,000 per criterion. `group` names an attribute used for
  group views (sunburst, box plot). The ranking's "About" lines are assembled from the metric definitions
  (label, unit, methodology, source, years covered, coverage counts) plus `about` patterns.
- A sub-ranking is another definition with filters, e.g. `{"type": "country", "filters": {"region": "Europe & Central Asia"}}`.

## Recipes (`recipes` row, written by the collector, executed by the crawler)

```json
{
  "type": "country",
  "name": "worldbank-population",
  "schedule": "monthly",
  "steps": [
    {"id": "src", "tool": "call_public_source", "args": {"source": "worldbank", "action": "indicator", "params": {"indicator": "SP.POP.TOTL", "date": "1960:2024"}}},
    {"id": "clean", "tool": "query_data", "args": {"datasetId": "$src", "expression": "…JSONata…"}},
    {"id": "load", "tool": "entity_upsert", "args": {"datasetId": "$clean", "type": "country", "nameColumn": "name", "idColumns": "{\"iso3\":\"iso3\"}", "metricColumns": "{\"value\":{\"metric\":\"population\",\"unit\":\"people\",\"period\":\"year\"}}", "source": "World Bank WDI SP.POP.TOTL"}}
  ]
}
```

- Steps call the same tools agents use (public sources, data tools, entity tools) with the same arguments;
  `"$<step id>"` passes an earlier step's dataset id. The executor runs them in order with no model.
