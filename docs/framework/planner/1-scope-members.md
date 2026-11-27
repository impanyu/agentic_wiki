# RankWiki class tree — membership (row completeness) initialisation

RankWiki combines ALL good information sources; it is not built on any single one. Every class must know, precisely
and checkably, WHICH entities are its members and WHERE the complete member list comes from, so a program can load
it and prove it complete. For each class you research its member sources as a domain expert would: what does a
professional in this field use as the complete list? Wikidata is only one candidate among many — often incomplete
or uneven (most products, apps, local businesses, many niche entities are missing or thin there). Never default to it.

For each class of your area, write:

1. **lists** — the member sources, ordered by authority (first = the primary list a professional would trust), at
   least TWO independent ones (THREE for classes over 10,000 members) wherever they exist. Think broadly, per field:
   - official registers and regulators (company registries, FDA/EMA drug lists, FAA aircraft registry, national
     heritage registers, school/university directories such as IPEDS, protected-area databases such as WDPA);
   - standards bodies and code lists (ISO 3166, UN M49, GS1, IUCN, ICD, ATC, NAICS/ISIC, IATA/ICAO codes);
   - federations, leagues, associations and their rosters (FIFA, national leagues, professional associations);
   - domain databases and bulk datasets (OpenAlex, ROR, GeoNames, OpenStreetMap, MusicBrainz, IMDb datasets,
     Open Library, GBIF, PubChem, Discogs, TheSportsDB, Steam, app-store charts, package registries…);
   - for products: manufacturers' own catalogues (every brand of the category), the big retailers' category listings
     (Amazon, Best Buy, Walmart, JD, Tmall, regional leaders), spec/review databases (GSMArena, RTINGS, DXOMARK…),
     certification databases (Energy Star, FCC ID, EPREL), price-comparison sites;
   - statistics offices and international organisations (World Bank, OECD, Eurostat, national statistics);
   - Wikidata / Wikipedia lists ONLY where they are genuinely strong for the class (then give the SPARQL WHERE
     pattern with `?item`, tested; use direct patterns, never `P279*`).
   For each list: `name`, `url` (download, API or page address), `format` (csv | json | api | bulk | html | sparql),
   `id` (the identifier it shares with others: iso3166_2, ror, ipeds, imdb, isbn, gtin, fifa, geonames, osm,
   wikidata, model number…), `covers` (all members / which part / which countries), `access` (open | free key |
   login | paid | scrape-ok | robots-restricted), and `query` for sparql lists.
2. **expected** — the realistic number of members (from the sources; the old note is given).
3. **admission** — one sentence: who counts as a member (the notability, activity or market threshold).
4. **gaps** — what no list covers well and how a collector should close it (per-country registries, local-language
   sources, the brands' own sites).

## Output — `out/<area>.json`
```json
{"area":"geography","classes":[
 {"key":"first_level_division","expected":4300,"admission":"Every current first-level administrative division as its country defines it.",
  "lists":[
   {"name":"ISO 3166-2","url":"https://www.iso.org/obp/ui/","format":"html","id":"iso3166_2","covers":"all","access":"open"},
   {"name":"GeoNames ADM1","url":"https://download.geonames.org/export/dump/admin1CodesASCII.txt","format":"csv","id":"geonames","covers":"all","access":"open"},
   {"name":"GADM level 1","url":"https://gadm.org/data.html","format":"bulk","id":"gadm","covers":"all","access":"open"},
   {"name":"Wikidata (countries' P150)","format":"sparql","query":"?c wdt:P298 ?country_iso3 ; wdt:P150 ?item .","id":"wikidata","covers":"most","access":"open"}],
  "gaps":"…"}
]}
```
Cover EVERY class of your area. Check that the sources you name exist and hold what you say (open the page or API;
test SPARQL with `LIMIT 5` on https://query.wikidata.org/sparql, one query at a time, waiting 60 s on 429/503).
Validate the JSON with python3 before finishing.
