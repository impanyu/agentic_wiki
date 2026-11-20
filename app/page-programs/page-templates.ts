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
 criteria:'3–8 criteria: the one asked for first, then the measures readers compare these entities by. Each: key (the CSV column), label, unit, order ("desc" when bigger ranks first, "asc" for e.g. mortality or price), format (number|compact|percent|currency|decimal), year, and a source line covering all of them.',
 outline:[
  '# <Scope> ranked by <main criterion>',
  'Lead: one paragraph — what is ranked, how many entities, the criteria and the data year, the leader and one striking fact.',
  '```component  ← the ranking block: load action reads the CSV with page_file.read into state.rows; ui: one ranking node (rows {"$":"state.rows"}, criteria, default, groupKey, chart "auto", source). See read_generation_contract kind "components" for the full example.',
  '## Highlights — 4–8 findings the data shows (leaders, gaps, regional patterns, surprises), with numbers; optionally a second component block (echart scatter of two criteria, treemap by group, gauge, timeline) when it reveals something the ranking does not.',
  '## By <group> — optional: a short comparison by region/sector with an echart (bar or pie) built from the same Page file.',
  '## Methodology and sources — definitions of each criterion, source and year, coverage (N of M), how ties and missing values are handled, known caveats.',
  '## Related rankings — links as [text](/?ask=…) to sibling rankings (same scope by another measure, sub-scopes, related scopes); search_contexts finds pages that already exist.',
 ],
 style:'Make it look premium: a crisp title, a strong lead, the ranking block right after the lead, short scannable sections, real cited numbers, no filler.',
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
