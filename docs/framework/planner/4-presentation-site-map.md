# RankWiki site map — initialisation brief

RankWiki (rankwiki.aisoup.net) is a public encyclopedia of rankings. It has two structures:

1. **Class tree (data, done).** 3,227 classes, single inheritance, each class split by one attribute. Each class
   declares its metrics (measures that rank) and attributes (that describe and filter), inherited downwards.
   Your input file lists your area's classes with their OWN metrics and attributes (ancestors' are inherited;
   upper classes like `thing`, `place`, `person`, `organization`, `product`, `creative_work` are in `upper.txt`).
2. **Site map (pages, YOUR job now).** The pages readers browse. The current pages were carried over from the old
   site and are incomplete and uneven (example: "Provinces and states of the world" had only "US states" and
   "European regions" under it). You design the complete site map for your area, as an expert editor of a
   reference site would (Wikipedia portals, a well-run comparison site): every page readers would look for exists,
   each level is complete, and every page has a clear purpose.

## What a page is
A page shows ONE stored query: `{class, filters}` over the class tree (filters are attribute conditions, e.g.
`{"country_iso3":"CAN"}`, `{"league":"Premier League"}`, `{"price_band":"budget"}`), or it is a **hub** that only
groups other pages (a navigation page with no ranking of its own). A page has a main ranking and may have more
rankings (views). Membership is always by attributes — never hand-made lists.

## Rules
1. **Coverage.** Every class that readers would recognise gets a page (leaf classes and meaningful intermediate
   classes). Purely technical intermediate classes need no page of their own (fold them into the parent page's
   children). Under each page, the children together must cover the page's space: all its readable subclasses
   AND the views readers expect (by type, era, size band, price band, use, league, region…).
2. **By country is automatic.** The platform creates "X Rankings in <Country>" for every country with ≥5 members
   of a class. Do NOT list per-country views; DO list by-region/continent views only when readers use them, and
   per-country pages only when a country's members come from a national system readers know as such
   (US states, Japanese prefectures are just "first-level divisions in USA/JPN" → automatic).
3. **Main ranking per page** = what that page's readers compare: at least 5 measures from the class's metrics
   (own + inherited), ordered by importance; for anything sold, think as a buyer (price, rating and number of
   ratings, the performance specs that matter, reliability, value). Years and dates describe; they never rank.
   Where experts use a composite (overall score), define one: a key, a label, 4–12 input metrics with weights
   (negative weight = lower is better), and why. The composite is the default.
4. **Views** must filter on attributes the class has (own or inherited). If a view needs an attribute that does
   not exist, list it in `attributes_needed` (class, attribute key, type, values, why, likely source) — the
   collectors will add it.
5. **Keep addresses.** If an existing page continues (same class and filters), keep its slug (`keep`). If two old
   pages are the same thing, keep the better one and list the other in `retire` with `into`. Retire only pages that
   are duplicates, empty forever, or make no sense — never because they are small.
6. **Hierarchy for readers.** `parent` is the page a reader reaches it from. It usually mirrors the class tree but
   may differ (e.g. "Football players" under "Football", not under "Athletes", if that is how readers browse). Top
   pages of your area hang under one of the existing top hubs (listed in `_hubs.txt`; e.g. `geography`, `sports`,
   `electronics`, `food-drink`, `education`…) — use their slugs.
7. **Slugs**: lower-case kebab-case, unique, readable (`provinces-and-states`, `football-players`). Names: plain
   English, plural ("Football players").

## Output — write ONE JSON file `out/<area>.json` (exact shape)
```json
{
  "area": "geography",
  "pages": [
    {
      "slug": "provinces-and-states",
      "keep": true,                       // true = an existing page with this slug continues
      "name": "Provinces and states of the world",
      "parent": "geography",              // a page slug (yours, another area's top page, or a top hub)
      "shows": {"class": "first_level_division", "filters": {}},   // or {"hub": true}
      "purpose": "One sentence: who comes here and what they compare.",
      "main": {
        "title": "Provinces and States of the World Rankings",
        "criteria": ["population", "area_km2", "population_density", "gdp_per_capita_ppp", "hdi_subnational", "..."],
        "default": "population",          // a criterion or the composite key
        "composite": null                 // or {"key","label","inputs":[{"metric","weight"}],"why"}
      },
      "views": [
        {"slug": "provinces-and-states-by-continent-asia", "title": "Provinces and States in Asia", "filters": {"continent": "Asia"}, "why": "…"}
      ],
      "related": ["countries", "cities"]  // pages readers go to next (any area)
    }
  ],
  "retire": [{"slug": "old-page", "into": "page-slug", "why": "duplicate of …"}],
  "attributes_needed": [{"class": "first_level_division", "attribute": "continent", "type": "enum", "values": ["Africa","Asia","Europe","North America","South America","Oceania"], "why": "…", "source": "derived from country"}]
}
```
Every existing page (listed in full in `in/<area>.pages.txt`) must appear either in `pages` (keep: true) or in `retire` — none may be dropped
silently. Work through ALL classes of your area; be thorough ("事无巨细"): it is the site's permanent skeleton.
Validate your JSON (python3 -c "import json;json.load(open(...))") before finishing.
