// Lists the interface strings of the public pages into app/i18n/public/en.json (keys = English text). Run after
// adding or changing a t('…') call in these files; then translate the new keys into every other language file
// (tests/i18n-public.test.mjs fails until each language has them all).
import {readFileSync,writeFileSync} from 'node:fs';
const FILES=['app/rankings/view.tsx','app/explore.tsx','app/home.tsx','app/i18n/switcher.tsx','app/theme.tsx',
 'app/workflows/viz/ranking.tsx','app/workflows/viz/entity-viz.tsx','app/workflows/viz/entity-charts.tsx',
 'app/rankings/ranking-page.tsx','app/e/entity-page.tsx','app/topics/topic-page.tsx'];
// Text the shared workspace toolbar shows on the public home page, and labels passed to t() through variables.
const EXTRA=['Search an entity or a ranking — e.g. Countries, iPhone 17, Perfumes','Open answer','Open answer · Enter','Sign in','Sign out','Sign in with Google','Home','Question or context',
 'Recently visited','No visited pages yet.','Loading…','Loading more…','Load more','Remove from history','Generating','Wiki page','Web app'];
const keys=new Set(EXTRA);
const call=/(?<![\w$])t\(\s*(['"])((?:\\.|(?!\1).)+?)\1/g;
for(const f of FILES){const src=readFileSync(f,'utf8');for(const m of src.matchAll(call))keys.add(m[2].replace(/\\(['"])/g,'$1'));}
const chart=readFileSync('app/workflows/viz/ranking-chart.ts','utf8');
const views=/VIEW_LABELS[^=]*=\{([^}]*)\}/.exec(chart);if(views)for(const m of views[1].matchAll(/:'([^']+)'/g))keys.add(m[1]);
const sorted=[...keys].filter(k=>/[A-Za-z]/.test(k)).sort();
writeFileSync('app/i18n/public/en.json',JSON.stringify(Object.fromEntries(sorted.map(k=>[k,k])),null,1)+'\n');
console.log(sorted.length,'strings');
