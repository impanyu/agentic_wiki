// Page templates of the public ranking wiki: what an entity page and a ranking page
// contain, in order, and the data pipeline that fills them. Agents read them with
// read_generation_contract kind "entity-page" or "ranking-page"; the components contract
// (kind "components") has every component's props.
const pipeline=[
 '1. Find complete, authoritative sources for the whole scope: call_public_source (wikidata sparql for "every X with property Y", worldbank indicator, restcountries, openalex, appstore top charts, steam, packages…), fetch_data for any JSON/CSV/XML API, extract_tables for "List of…" articles and statistics tables, browse_page for JavaScript-built pages of platforms and apps (it also returns the JSON the page loads), crawl_pages for public listings spread over many pages, and the archive public source (wayback_snapshots / commoncrawl_index list every captured page of a site section; wayback_fetch / commoncrawl_fetch read one) for pages that are gone or blocked by a login, CAPTCHA or challenge.',
 '2. Every fetch returns a datasetId with columns and a preview, never hundreds of rows: inspect with describe_data, then use query_data (JSONata) to clean, convert units, join sources on a shared key (ISO code, Wikidata QID, ticker…) and derive columns (per-capita, density, growth).',
 '3. Check coverage (row count against the known size of the scope), missing values and outliers with describe_data; fill gaps from a second source rather than guessing, and note what stays missing.',
 '4. save_data writes the final table as a Page file (CSV) with the columns the page needs; the page then reads it in the reader’s browser with page_file.read.',
].join(' ');
export const rankingPageTemplate={
 when:'The question names a set of things to compare or rank, or a plural category: "countries by population", "largest companies by revenue", "best universities in Asia", "most played Steam games", "tallest buildings".',
 data:pipeline+' Columns: name, question (opens the entity page, e.g. "Brazil (country)"), code when a standard one exists (ISO 3166-1 alpha-3 for countries), image (https flag or logo) when reliable, group (region, sector, genre…), then one plain numeric column per criterion (no units or separators; empty when unknown). Rank EVERY entity of the scope; for open-ended scopes use a complete authoritative list with a stated threshold.',
 completeness:'Classify the scope and state it in the lead and methodology: a closed set (countries, states, a league) → rank every member of an authoritative membership list (cite it; coverage ≈100%); a large catalog (companies, universities, apps, perfumes) → define the universe as a comprehensive catalog plus a public eligibility threshold and a dedupe rule for variants, and report eligible / ranked / excluded counts; a subjective "best" → break it into measurable criteria (vote-weighted community rating with a Bayesian average so few votes cannot beat many, critics, awards, popularity) and optionally an editor-designed composite. Cross-check the universe against award lists, bestseller charts and critics\u2019 lists and add what is missing; split very broad scopes into sub-rankings with sharper universes. Use any page a normal anonymous visit opens; stop only where a page actually requires a login, a CAPTCHA or an interactive challenge (never solve or evade it) and then use archives (Wayback Machine, Common Crawl via the archive source), official APIs or data dumps; say on the page which criteria have reduced coverage.',
 naming:'Every page is about one entity or one set of entities, named like an encyclopedia entry: an entity page is titled with the entity\u2019s canonical name ("France", "iPhone 17 Pro", "Chanel No. 5"); a ranking page "<scope> Rankings" ("Country Rankings", "Perfume Rankings"; 国家排行榜). A question such as "countries ranked by GDP" or "most populous countries" is answered by the scope\u2019s ranking page with that measure among its criteria (it opens on it with ?rank=<criterion key>).',
 criteria:'3–8 criteria: every measure readers commonly compare these entities by, including the one the question asked for; default = the scope\u2019s most canonical measure (population for countries). Each: key (the CSV column), label, unit, order ("desc" when bigger ranks first, "asc" for e.g. mortality or price), format (number|compact|percent|currency|decimal), year, and a source line covering all of them.',
 draft:'kind "article", templateId "ranking-v1" (a compact ranking layout: no contents sidebar, no images required).',
 outline:[
  '# <Scope> Rankings — "<scope as a singular noun> Rankings" plus any membership qualifier: "Country Rankings", "Perfume Rankings", "University Rankings in Asia"; Chinese "<范围>排行榜". Never "Top …" (every member is ranked) and never a criterion in the title. One ranking page per scope.',
  'summary: one line — what is ranked, how many, data year (e.g. "All 217 countries and economies, ranked by population, GDP, area and more (World Bank, 2024).").',
  'body, in this order and nothing else:',
  '1. One short sentence (optional) stating scope, count and data year, with its citation.',
  '2. The ```component block with the ranking (load action reads the CSV into state.rows). This is the page. Its views (bars, treemap, donut, map, 3D height map, scatter) are chosen from the data automatically; set views only to reorder or narrow them. Give rows a code (ISO country code or U.S. state postal code) so the maps work.',
  '3. "## About this ranking" — at most 5 short bullets: the scope/universe and its source (coverage N of M), each criterion\u2019s source and year in one line, how ties and missing values are handled.',
  '4. "## Related rankings" — 3–8 links [Name Rankings](/?ask=…) to sibling scopes (sub-regions, categories, related sets).',
  'No highlights, narratives, extra charts or images: readers came for the ranking; facts about individual members belong on their entity pages.',
 ],
 style:'Short and fast: title, one line, the ranking, a compact note. Under ~3,000 characters of prose.',
};
export const entityPageTemplate={
 when:'The question names one specific thing: a country, city, company, university, person, product, app, game, species, building, programming language…',
 data:'Research the entity from primary and authoritative sources (official site, Wikipedia/Wikidata entity, statistics agencies, registries, the public data sources). For its key figures fetch time series where they exist (e.g. worldbank indicator for a country, revenue history for a company) as datasets and save_data them for charts.',
 outline:[
  '# <Entity name>',
  'Lead: what it is and why it matters, in 2–3 sentences.',
  '```component  ← at-a-glance block: a card with an image (when a reliable https image exists) and stats/key_value of 4–8 key figures with units and years (population, area, founded, revenue, rank…).',
  '## Sections suited to the kind of entity (History, Geography, Economy, Products, Research, Records…), well sourced, with images.',
  '## In numbers — interactive echart(s) of its own data over time or its breakdowns (from a Page file), with a sentence on what each shows.',
  '## Rankings — where it ranks on its key measures, e.g. "4th of 195 countries by area (2023)", each linked to the ranking page: [Countries ranked by area](/?ask=Countries ranked by area). Get the positions from the same data the ranking pages use (rank within the full dataset), not from memory.',
  '## See also — related entities and rankings as /?ask= links.',
 ],
 style:'A rich, trustworthy wiki article: lead, at-a-glance card, sections, charts, rankings, references.',
};
