# RankWiki class tree — fields (column completeness) research

RankWiki combines ALL good information sources on the internet. For every class of your area you research, as a
domain expert would, (a) EVERY attribute and measure that exists about its members and that a reader, buyer,
student, fan or professional could use, and (b) for each, the BEST sources that publish it. The current class spec
(own fields; ancestors' fields are inherited — see upper.txt) is your starting point, not the limit: add what is
missing, fix what is wrong, and give every field its sources.

## How to research a class
- Start from how experts and users look at these entities: the standard references of the field (a buyer's guide,
  the spec sheet manufacturers publish, the registry's data dictionary, the federation's statistics, the review
  sites' test protocols, the regulator's filings, the academic or industry indices).
- Read the data dictionaries / column lists / API schemas of the class's best sources and of other sources that
  cover these entities — map them broadly: every meaningful field, not five convenient ones.
- Cover all aspects: identity and codes; classification; physical/technical specs; performance and test results;
  price and cost (by market where it varies); ratings and number of ratings (by platform); popularity and reach;
  reliability, safety, recalls, certifications; history and dates (describe, never rank); people and organisations
  (maker, owner, members, founders); places; awards; the field's standard indices and rankings by recognised bodies;
  sustainability and social measures where relevant.
- Measures (`metrics`, numeric, comparable, with unit and direction) vs attributes (describe and filter: enums,
  booleans, codes, text, links). Give enums their values.
- Sources per field: at least two where they exist (primary first), each named precisely (site/API/dataset and the
  exact field or table), with access (open | free key | login | paid | scrape-ok | robots-restricted). Look across
  regions and languages (a Chinese product: JD/Tmall/ZOL; Japanese: Kakaku; German: Idealo; national statistics).
  Check that each source exists and holds the field (open it); do not invent.

## Output — `out/<area>.json`
```json
{"area":"tech","classes":[
 {"key":"smartphone",
  "metrics":[{"key":"price_usd","label":"Launch price","unit":"USD","order":"asc","sources":[{"name":"Manufacturer store","field":"price","access":"scrape-ok"},{"name":"GSMArena","field":"Price","access":"scrape-ok"}]},
             {"key":"battery_life_hours","label":"Battery life (GSMArena test)","unit":"hours","order":"desc","sources":[…]}],
  "attributes":[{"key":"chipset","type":"string","sources":[…]},{"key":"os","type":"enum","values":["Android","iOS","HarmonyOS"],"sources":[…]}],
  "remove":["field keys in the current spec that are wrong or meaningless for this class, with why"],
  "notes":"what no public source has, and how a collector could still get it"}
]}
```
List the class's COMPLETE own field set in your output (existing ones you keep + new ones), each with sources.
Inherited fields are not repeated unless the class needs a different source for them. Use snake_case keys; reuse
existing keys for the same concept. Cover EVERY class of your area; validate the JSON with python3 before finishing.

## Verification (required)
Give every source a `url` (the API, download or page address) as well as its name and field. Open at least one
source per class (and every source you are not sure of) to confirm it exists and holds the fields you map to it;
in your report, say how many you opened and confirmed.
