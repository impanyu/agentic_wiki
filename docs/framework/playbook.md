# Playbook — from a request to a live data product, and the lessons learned

## Steps
1. **Scope** (Planner 1): every class of entity the request implies; per class the admission rule, expected count,
   and 2+ independent member lists (3 for classes over 10,000), ordered by authority. Never one source by default.
2. **Template** (Planner 2): decided before looking at data — everything an expert reference would show (≥50 fields
   with inherited, 80–150 for rich classes), no padding, no duplicates of inherited fields. National subclasses
   where a country's statistics system adds rich fields (US states, Chinese provinces…).
3. **Sources** (Planner 3): per field the best 2–3 sources with exact field and access; fields without a source stay
   declared ("source needed").
4. **Presentation** (Planner 4): one main ranking per class; narrowing down by one attribute per level; more than
   12 countries → a continent level first; composite indices with formulas; readers' ranking criteria first.
5. **Collect, refine, audit, publish**: a ranking is public only when its gates pass.

## Lessons (each became a rule or a check)
| Problem seen | Rule / check now |
|---|---|
| Templates came out thin because available sources decided the fields | Template first, sources second (Planner 2) |
| One source per class → wrong values went unnoticed (company revenue, city population) | 2–3 sources per class and field; publication gate |
| Revenue in billions, rupees and USD under one measure | Auditor: one measure's sources 100× apart (`class-source-scales`) |
| "Totals" row first in the Olympic medal table; countries listed twice | Auditor: top-of-ranking check daily (`ranking-top-sanity`) |
| Same thing created twice because ids were spelled differently (FIPS 01 / 1 / 0400000US01, Open Library links) | Identity: one code in any spelling is one id |
| A percentage column filled with counts (65+ share = 6.9 million %) | Data: a `_pct` value over 10,000 is never written (changes such as inflation exempt) |
| City ranking mixed city proper, metro areas and Chinese prefecture totals | One definition per measure; other definitions are other measures or other classes |
| "Population" and "population_pct" twins, `revenue` vs `revenue_usd` | One measure, one key: a unit-suffixed twin takes the existing key |
| Narrow-down with 100+ countries in one list | Presentation: a continent level when over 12 countries |
| Deploys restarted agents mid-task; a day of collection lost | Orchestrator: workers drain and run from their own release copy |
| Unmet gate at budget end marked the task failed and escalated to a costlier model | Orchestrator: partial result kept, continuation queued |
| National subclass took territories, islands and city rows | Admission rule per class checked on move (e.g. 50 states + DC) |
