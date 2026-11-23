# RankWiki workflows

Every process that keeps RankWiki growing runs on a fixed workflow: a trigger, fixed stages with one deliverable each,
an acceptance check the program enforces, and a fixed way out (done, retried, escalated or reported). Agents make
decisions inside a stage; they never decide the order of the stages. Programs do all the fetching, computing and
rendering.

## 1. The model

- **Topic tree = class hierarchy.** A subtopic's entity type extends the type of the topic above it
  (`schema.extends`, set automatically). It inherits every metric, attribute, relation, index and template section
  of its ancestors and only adds its own. Shared attributes are designed high in the tree, specific ones low.
- **Is-a.** A ranking of a type ranks every entity of its subtypes too (on the shared criteria); an entity page shows
  its ranks in the rankings of every type it extends. Criteria accumulate downward: high rankings compare everything
  below on a few shared criteria, low rankings compare a narrow set on many.
- **Dividing is not staffing.** Every topic records its owning team (`topics.scope.team`). A team owns a subtree:
  it designs the subtree's shared types, templates and sources once and covers the subtopics one per cycle, most
  important first. A subtopic gets a team of its own only when the manager spins it off.
- **Pages = data × template.** No agent writes pages. The renderer builds every page on request from the database
  and the effective template, in the reader's language.

## 2. Team workflows (`app/teams/run.ts`)

A team is queued with a reason; the reason picks the workflow. Every stage is checkpointed (a restart resumes after
the last finished stage). A failed stage is retried once on the commercial model, then skipped or stops the run with
an issue, as the stage says.

| Workflow | Trigger | Stages (role → deliverable, check) |
|---|---|---|
| **build** | a new topic or subtopic the team owns | plan (editor → types, universe, main ranking, criteria) → survey (collector → ≥3 sources recorded) → universe (collector → entities in the database by a recipe that ran) → starter (editor → main ranking and basic template: **pages visible**) → metrics (collector → every planned metric by a recipe; unobtainable ones listed) → resolve (editor → replace / drop / request access, recorded) → replace (collector → replacements loaded) → design (editor → full template, sub-rankings, indices, previews) → review loop |
| **repair** | a recipe failed or drifted (within 3 h) | repair (collector → fixed from the source register, recipe runs) |
| **expand** | ≥3 reader queries waiting 12 h | triage (editor → need behind each query, neighbouring needs, plan items, subtopic proposals, a decision per query) → load (collector) → pages (editor) → review loop |
| **review and grow** | routine: 3 days after the first build, then every 7 days (read topics) or 14 days (quiet ones) | grow (editor → ≥10 new measures or attributes with their sources, ≥1 new index, new sub-rankings by kind and place, subtopic proposals) → load (collector → the additions loaded from a second source where one exists, as recipes) → pages (editor → criteria, template, indices, sub-rankings, previews) → review loop |
| **sources** | the source register is over 90 days old | source review (collector → every chosen source rechecked, dead ones replaced, new ones added, register dated) |

**Review loop** (shared): review → issues routed by owner (collector / editor / platform) → at most 2 fix rounds →
the manager's binding ruling → the team applies it → final review → approved work is published (sitemap), the rest
stays draft and an issue is raised. Platform defects always become operator issues.

**Who answers for what.** The collector answers for the data: every stage of the collector is accepted only when the
platform's checks pass — every measure has a recipe that has run, no measure is mostly zero, no entity has only
zero values, no name looks like something other than a name (no letters, a web address, a sentence). The reviewer
answers for the pages: every ranking and several entity pages are previewed before the verdict. The editor answers
for the design and for growing it.

**Wikidata starter.** A topic without a ranking does not wait for its team: a program maps it to Wikidata classes
and numeric properties (one model call), loads the top entities with their measures, Wikipedia article, picture and
homepage, and publishes a first ranking (config fastlane). The team's build then starts from it — Wikidata is one
source among several; the team adds the others, cross-checks and deepens.

## 3. Growing the tree (`app/teams/manager.ts`)

| Channel | Trigger | What happens |
|---|---|---|
| Reader searches | daily, when searches found nothing | the manager groups them: assign to a topic's inbox, open a new topic (≤20/day; under a parent it joins the parent's team), or ignore |
| Subtopic proposals | an editor calls `propose_subtopics` | the manager approves / revises / rejects in the daily review; approved ones join the proposer's team |
| Sub-rankings | an editor saves a filtered ranking | the set appears as a child node in the address tree (no approval; established classifications only) |
| Expand workflow | reader queries in an inbox | the editor generalises from the queries (see above) |
| Tending | every 6 h, one top-level subject in turn | the manager opens ≤10 missing subtopics (joining the owning team) and flags duplicates or misplaced topics |

Every addition follows an established classification (UN M49, industry segments, GS1/UNSPSC/HS, ATC, NAICS/ISIC,
biological taxonomy, official divisions).

## 4. Staffing (`spinOff`, hourly)

A subtopic gets its own team (editor, collector, reviewer) when its demand calls for it (≥5 queries waiting or ≥100
views in 30 days) or when its team has more than 12 subtopics still to cover (the next three most important are spun
off). The new team owns that subtree from then on.

## 5. Programs (no agents)

| Program | Trigger | What it does |
|---|---|---|
| Crawler | every minute, recipes due by schedule | runs collection recipes (up to 3 at once), bulk loads over many runs; failure → repair workflow |
| Indices | after each recipe | recomputes the editors' indices of the type and the types it extends |
| Introductions and links | every minute | fills missing introductions, pictures, homepages (Wikidata P856) and Wikipedia links, finding the Wikidata item from a Wikidata, ORCID, OpenAlex or IMDb id (40 a minute) |
| Wikidata starter | continuously (FASTLANE_WORKERS) | first rankings for topics without one (see above) |
| Translation | continuously | a pool of workers translates the queue (home page and subject pages first, then texts readers met, then the tree), on models the teams do not use; a page's missing texts are translated before it is shown |
| Vectors | every minute | search vectors for new entities and rankings |
| Maintenance | hourly | queues repairs, expansions, reviews, source reviews; spins off teams |
| Queue | every minute | starts queued teams within TEAM_CONCURRENCY and the monthly budget |

## 6. Escalation to the operators

Everything a workflow cannot settle lands on the admin page (Issues; Services → access requests), merged by cause,
pushed when a webhook is set: a stage that stops, a team not approved after the ruling, platform defects, access
needed (keys, accounts, quota), recipes failing repeatedly, the budget reached, tree duplicates flagged by the manager.
