# RankWiki — complete field templates (template first, sources second)

RankWiki is a public reference site of rankings and entity pages that combines ALL good sources on the internet.
Every class needs a COMPLETE field template: everything worth knowing about its members. The previous pass let the
sources that were found decide the fields, so templates came out thin (US states had ~30 fields where an expert
would expect 100+). This pass fixes that. Work in two strictly separate steps for each class of your slice.

## Keep the reader in mind throughout
Always think as the people who look these entities up: what would they want to know, compare and rank by? Let that
guide every field. Give per class `ranking_criteria` (what readers would rank by, most wanted first) and 1–3
`composites` (an overall score, a value score for things sold, or a field index: inputs with weights, negative =
lower is better); mark metrics readers would rank by `rankable`: true.

## Step 1 — the template, decided WITHOUT looking at what data is available
Think as the best domain expert writing the definitive reference for these entities: a national statistical
yearbook (for places), a professional buyer's guide and spec sheet (for products), an encyclopedia and the
field's standard databases (for people, organisations, works), a scout's report (for athletes), a fact sheet (for
institutions). List EVERYTHING such a reference would show about one member, covering every aspect:
- identity, names, codes and identifiers; classification and type; status; dates and history (describe, never rank);
- size and scale; physical and technical specifications; composition;
- performance, quality, results, test scores, awards, records;
- economy and cost: price (per market), revenue, budget, cost of living, value for money;
- people and organisation: leaders, founders, members, staff, ownership;
- place: location, region, climate, environment;
- popularity and reach: audience, users, ratings and number of ratings per platform, search and web interest;
- reliability, safety, risk, recalls, certifications, sustainability, social measures;
- the standard indices and rankings of the field (by recognised bodies);
- for places in particular: demography (age, sex, ethnicity, migration), economy (GDP by sector, income, poverty,
  employment by industry), labour, prices and housing, education, health, crime and justice, government and
  politics, public finance and taxes, infrastructure and transport, energy, environment and climate, tourism, culture.
Size: every entity is high-dimensional. Own + inherited fields: at least 50 for every class, 80–150 for rich classes
(places, organisations, products people compare, people, works, institutions). A template below that will be sent back — but never pad it: every field must be
meaningful for this kind of entity, shared by its members (not a quirk of a few), something readers actually care
about, and not a duplicate or a trivial variant of another field (no per-unit copies, no restated inherited fields).
Use common sense: a reviewer will strike padded, redundant or meaningless fields. Do not repeat fields the class inherits (the parent's fields are
listed in the slice or in `_upper_fields.txt`) unless the class needs them redefined; DO add every field the
inherited set lacks. Keep good current fields (same key), add the missing ones, use snake_case keys, reuse
existing keys for the same concept. Metrics are numeric and comparable (unit + direction); attributes describe and
filter (enums with values, booleans, codes, text, links).
National subclasses: where members in one country come from a national statistics system with its own rich
fields (US states → Census/BEA/BLS/CDC/FBI; Chinese provinces → NBS yearbook; Indian states → MoSPI/RBI; Japanese
prefectures; German Länder; US counties; UK local authorities …), propose a national subclass with its extra
fields (`national_subclasses`).

## Step 2 — sources, field by field
For each field, name the best sources (primary first, at least two where they exist) with url and the exact
field/table/column, access (open | free key | login | paid | scrape-ok | robots-restricted). If you cannot find a
source, the field STAYS in the template with "source_needed": true and a note on where it might come from. Never
drop a field because data is hard to get. Open at least the main source of each class to confirm it holds what
you map (and say so).

## Output — `out/<slice>.json`
```json
{"slice":"s00","classes":[
 {"key":"first_level_division",
  "audience":"people comparing where to live, work, study or invest; students; journalists",
  "ranking_criteria":["population","median_household_income_usd","cost_of_living_index","…"],
  "composites":[{"key":"state_livability_index","label":"Livability score","inputs":[{"metric":"median_household_income_usd","weight":0.2},{"metric":"cost_of_living_index","weight":-0.2},{"metric":"violent_crime_rate_per_100k","weight":-0.15},"…"],"why":"…"}],
  "fields":[{"key":"median_age","kind":"metric","label":"Median age","unit":"years","order":"desc","aspect":"demography","reader_interest":"high",
             "sources":[{"name":"…","url":"…","field":"…","access":"open"}],"source_needed":false},
            {"key":"governor_party","kind":"attribute","type":"enum","values":["…"],"aspect":"politics","sources":[…]}],
  "national_subclasses":[{"key":"us_state","label":"US state","country_iso3":"USA","why":"Census/BEA/BLS/CDC/FBI publish 100s of state fields",
                          "fields":[…same shape…]}],
  "checked":["main source opened and confirmed: …"]}
]}
```
List each class's COMPLETE own field set (kept + new). Cover every class in your slice; validate the JSON with
python3 before finishing. Report: classes, fields per class (min/median/max), share with sources, source_needed
count, national subclasses proposed.
