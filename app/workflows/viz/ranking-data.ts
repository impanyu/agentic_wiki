// Pure helpers for the ranking component: parse, rank, format, summarize, choose the chart.
// No React or DOM; tests load this file (with world-codes.ts and rich-helpers.ts) directly.
import {countryKey} from './world-codes';
import {safeImageUrl} from './rich-helpers';

type Obj=Record<string,unknown>;
export type Format='number'|'compact'|'percent'|'currency'|'decimal';
export type Criterion={key:string;label:string;unit?:string;order:'desc'|'asc';format:Format;decimals?:number;currency?:string;description?:string;year?:string;theme?:string;remote?:boolean};
export type Entry={index:number;row:Obj;name:string;question:string;value:number|null;rank:number|null;group:string|null;image:string|null;code:string|null};
export type Summary={top:Entry|null;median:number|null;aggregate:'sum'|'average';aggregateValue:number|null;ranked:number;total:number;max:number;min:number};

const isObj=(v:unknown):v is Obj=>!!v&&typeof v==='object'&&!Array.isArray(v);
const FORMATS:Format[]=['number','compact','percent','currency','decimal'];

// Numbers or numeric strings ("1,234.5", "72.5%", "$ 1 200", "1_000"); anything else is no data.
export function parseNumber(v:unknown):number|null{
 if(typeof v==='number')return Number.isFinite(v)?v:null;
 if(typeof v!=='string')return null;
 const s=v.replace(/[\s  ,_]/g,'').replace(/^[$€£¥]/,'').replace(/%$/,'').replace(/^\+/,'').replace(/^[−–]/,'-');
 if(!s||!/^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s))return null;
 const n=Number(s);return Number.isFinite(n)?n:null;
}

const text=(v:unknown)=>typeof v==='string'?v.trim():typeof v==='number'&&Number.isFinite(v)?String(v):'';

export function normalizeCriteria(raw:unknown):Criterion[]{
 const out:Criterion[]=[];const seen=new Set<string>();
 for(const c of Array.isArray(raw)?raw:[]){
  if(!isObj(c)||typeof c.key!=='string'||!c.key||seen.has(c.key))continue;seen.add(c.key);
  const d=parseNumber(c.decimals);
  out.push({key:c.key,label:text(c.label)||c.key,order:c.order==='asc'?'asc':'desc',format:FORMATS.includes(c.format as Format)?c.format as Format:'number',
   ...(text(c.unit)?{unit:text(c.unit)}:{}),...(d!=null&&d>=0?{decimals:Math.min(6,Math.round(d))}:{}),
   ...(typeof c.currency==='string'&&/^[A-Za-z]{3}$/.test(c.currency)?{currency:c.currency.toUpperCase()}:{}),
   ...(text(c.description)?{description:text(c.description)}:{}),...(text(c.year)?{year:text(c.year)}:{}),...(text(c.theme)?{theme:text(c.theme)}:{}),...(c.remote===true?{remote:true}:{})});
 }
 return out;
}

export const askHref=(question:string)=>'/?ask='+encodeURIComponent(question);

// One entry per row that has a name; value is null when the criterion is missing.
export function toEntries(rows:unknown,nameKey='name',groupKey?:string):Omit<Entry,'value'|'rank'>[]{
 const out:Omit<Entry,'value'|'rank'>[]=[];
 (Array.isArray(rows)?rows:isObj(rows)?[rows]:[]).forEach((row,index)=>{
  if(!isObj(row))return;const name=text(row[nameKey]);if(!name)return;
  out.push({index,row,name,question:text(row.question)||name,group:groupKey?text(row[groupKey])||null:null,image:safeImageUrl(row.image),code:text(row.code)||null});
 });
 return out;
}

// Competition ranking (1,2,2,4); rows without a value follow, unranked, in their original order.
export function rankEntries(entries:Omit<Entry,'value'|'rank'>[],key:string,order:'desc'|'asc'='desc'):{ranked:Entry[];missing:Entry[]}{
 const all=entries.map(e=>({...e,value:parseNumber(e.row[key]),rank:null as number|null}));
 const ranked=all.filter(e=>e.value!=null).sort((a,b)=>(order==='asc'?a.value!-b.value!:b.value!-a.value!)||a.index-b.index);
 ranked.forEach((e,i)=>{e.rank=i&&ranked[i-1].value===e.value?ranked[i-1].rank:i+1;});
 return {ranked,missing:all.filter(e=>e.value==null)};
}

export function median(values:number[]):number|null{
 if(!values.length)return null;const s=[...values].sort((a,b)=>a-b),m=s.length>>1;
 return s.length%2?s[m]:(s[m-1]+s[m])/2;
}

// Sums are meaningless for rates and averages (percent, decimal): those show the average.
export function summarize(ranked:Entry[],missing:Entry[],c:Pick<Criterion,'format'>&{unit?:string}):Summary{
 const vals=ranked.map(e=>e.value!);const sum=vals.reduce((a,b)=>a+b,0);
 // Shares of a total only make sense for quantities that add up (people, money, tonnes, area, counts); a height, a
 // length, a speed, a temperature, a rate per something, a score or an age is averaged instead.
 const intensive=/^(m|km|cm|mm|ft|mi|in|nmi|°[cf]?|k|km\/h|m\/s|mph|kn|years?|yr|hpa|db|ghz|mhz|hz|nits|ppi|mp|mah|kg\/m3)$|per |\/|score|index|rating|ratio|rank|grade|density|rate/i;
 const aggregate=c.format==='percent'||c.format==='decimal'||intensive.test(String(c.unit||'').trim())?'average':'sum';
 return {top:ranked[0]??null,median:median(vals),aggregate,aggregateValue:vals.length?aggregate==='sum'?sum:sum/vals.length:null,ranked:ranked.length,total:ranked.length+missing.length,
  max:vals.length?Math.max(...vals):0,min:vals.length?Math.min(...vals):0};
}

const intl=(locale:string,o:Intl.NumberFormatOptions)=>{try{return new Intl.NumberFormat(locale||'en',o);}catch{try{return new Intl.NumberFormat('en',o);}catch{return new Intl.NumberFormat('en');}}};
const unitGlue=(unit:string)=>/^[%°′″‰]/.test(unit)?unit:' '+unit;

// A formatter for one criterion; values decide the default precision (0 when all are integers).
export function makeFormatter(c:Pick<Criterion,'format'|'decimals'|'currency'|'unit'>,values:number[],locale:string,opts:{unit?:boolean;compact?:boolean}={}):(n:number|null)=>string{
 const ints=values.every(v=>Number.isInteger(v));
 const maxAbs=values.reduce((m,v)=>Math.max(m,Math.abs(v)),0);
 let f:Intl.NumberFormat;let suffix='';
 switch(c.format){
  case 'compact':f=intl(locale,{notation:'compact',maximumFractionDigits:c.decimals??1});break;
  case 'percent':f=intl(locale,{maximumFractionDigits:c.decimals??1});suffix='%';break;
  // Large amounts (GDP) read better as $25.4T than as 14 digits.
  case 'currency':f=intl(locale,maxAbs>=1e6||opts.compact?{style:'currency',currency:c.currency||'USD',notation:'compact',maximumFractionDigits:c.decimals??1}:{style:'currency',currency:c.currency||'USD',minimumFractionDigits:c.decimals??(ints?0:2),maximumFractionDigits:c.decimals??(ints?0:2)});break;
  case 'decimal':f=intl(locale,{minimumFractionDigits:c.decimals??1,maximumFractionDigits:c.decimals??1});break;
  default:f=opts.compact?intl(locale,{notation:'compact',maximumFractionDigits:1}):intl(locale,{maximumFractionDigits:c.decimals??(ints?0:2)});
 }
 const unit=opts.unit!==false&&c.unit&&c.format!=='percent'&&c.format!=='currency'?unitGlue(c.unit):'';
 return n=>n==null||!Number.isFinite(n)?'—':f.format(n)+suffix+unit;
}

// Share of the total (for summable values) or a "top x%" percentile.
export function shareOf(e:Entry,s:Summary,locale:string):{kind:'share'|'top';text:string}|null{
 if(e.value==null||e.rank==null)return null;
 if(s.aggregate==='sum'&&s.aggregateValue&&s.aggregateValue>0&&s.min>=0){
  const p=e.value/s.aggregateValue*100;
  return {kind:'share',text:intl(locale,{maximumFractionDigits:p<1?2:1}).format(p)+'%'};
 }
 return {kind:'top',text:Math.max(1,Math.ceil(e.rank/s.ranked*100))+'%'};
}

// 'auto' draws a world map when at least 60% of rows carry a recognizable country code.
export function chartMode(chart:unknown,entries:{code:string|null}[]):'bar'|'map'|'none'{
 if(chart==='bar'||chart==='map'||chart==='none')return chart;
 if(!entries.length)return 'bar';
 const known=entries.filter(e=>countryKey(e.code)).length;
 return known>=3&&known/entries.length>=.6?'map':'bar';
}

// Map colors follow a log scale when positive values span two or more orders of magnitude (population, GDP).
export function colorScale(values:number[]):{log:boolean;min:number;max:number}{
 if(!values.length)return {log:false,min:0,max:1};
 const min=Math.min(...values),max=Math.max(...values);
 if(min>0&&max/min>=100)return {log:true,min:Math.log10(min),max:Math.log10(max)};
 return {log:false,min,max:max===min?min+1:max};
}

// Stable group order (first appearance) for colors and filter chips.
export function groupsOf(entries:{group:string|null}[]):string[]{
 const out:string[]=[];for(const e of entries)if(e.group&&!out.includes(e.group))out.push(e.group);return out;
}

// Equal Earth projection (Šavrič, Patterson, Jenny 2018); y grows downward as ECharts expects.
const A1=1.340264,A2=-0.081106,A3=0.000893,A4=0.003796,M=Math.sqrt(3)/2,RAD=Math.PI/180;
export function equalEarth(p:number[]):number[]{
 const t=Math.asin(M*Math.sin(p[1]*RAD)),t2=t*t,t6=t2*t2*t2;
 return [p[0]*RAD*Math.cos(t)/(M*(A1+3*A2*t2+t6*(7*A3+9*A4*t2))),-t*(A1+A2*t2+t6*(A3+A4*t2))];
}
export function equalEarthInvert(p:number[]):number[]{
 const y=-p[1];let t=y,t2=0,t6=0;
 for(let i=0;i<12;i++){t2=t*t;t6=t2*t2*t2;const fy=t*(A1+A2*t2+t6*(A3+A4*t2))-y,fpy=A1+3*A2*t2+t6*(7*A3+9*A4*t2);const d=fy/fpy;t-=d;if(Math.abs(d)<1e-12)break;}
 t2=t*t;t6=t2*t2*t2;
 return [M*p[0]*(A1+3*A2*t2+t6*(7*A3+9*A4*t2))/Math.cos(t)/RAD,Math.asin(Math.max(-1,Math.min(1,Math.sin(t)/M)))/RAD];
}

export const escapeHtml=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]!);

// Attribution text split into plain and link parts (http/https URLs only).
// Known datasets named in source text, linked to their public pages (where a reader can check the figure).
// A source given as an address links to itself; an API address links to the dataset's page instead.
const DATASETS:{re:RegExp;href:(m:RegExpMatchArray)=>string}[]=[
 {re:/World Bank WDI ([A-Z][A-Z0-9]*(?:\.[A-Z0-9]+)+)/g,href:m=>'https://data.worldbank.org/indicator/'+m[1]},
 {re:/World Bank (?:WDI|World Development Indicators)(?! [A-Z][A-Z0-9]*\.)/g,href:()=>'https://databank.worldbank.org/source/world-development-indicators'},
 {re:/\bWikidata (Q\d+)\b/g,href:m=>'https://www.wikidata.org/wiki/'+m[1]},
 {re:/\bWikidata (P\d+)\b/g,href:m=>'https://www.wikidata.org/wiki/Property:'+m[1]},
 {re:/\bUN (?:DESA )?World Population Prospects\b/g,href:()=>'https://population.un.org/wpp/'},
 {re:/\bIMF World Economic Outlook\b/g,href:()=>'https://www.imf.org/en/Publications/WEO'},
 {re:/\bOur World in Data\b/g,href:()=>'https://ourworldindata.org/'},
];
const API_PAGES:[RegExp,string][]=[[/^https?:\/\/api\.worldbank\.org\/v2\/country\/?$/,'https://data.worldbank.org/country'],[/^https?:\/\/api\.worldbank\.org\//,'https://data.worldbank.org/']];
export function linkParts(s:string):{text:string;href?:string}[]{
 const spans:{start:number;end:number;href:string}[]=[];
 for(const m of s.matchAll(/https?:\/\/[^\s<>"']+/g)){
  let url=m[0];const trail=url.match(/[.,;:!?)\]]+$/);if(trail)url=url.slice(0,-trail[0].length);
  spans.push({start:m.index!,end:m.index!+url.length,href:API_PAGES.find(([re])=>re.test(url))?.[1]??url});
 }
 for(const d of DATASETS)for(const m of s.matchAll(d.re)){const start=m.index!,end=start+m[0].length;
  if(!spans.some(x=>start<x.end&&end>x.start))spans.push({start,end,href:d.href(m)});}
 spans.sort((a,b)=>a.start-b.start);
 const out:{text:string;href?:string}[]=[];let last=0;
 for(const x of spans){if(x.start>last)out.push({text:s.slice(last,x.start)});out.push({text:s.slice(x.start,x.end),href:x.href});last=x.end;}
 if(last<s.length)out.push({text:s.slice(last)});
 return out;
}

// Polygons that cross the antimeridian (Russia, Fiji) would streak across a flat map:
// their points on the far side are pinned to the edge of the side holding most of the polygon.
export function fixAntimeridian(geometry:{type:string;coordinates:any}):{type:string;coordinates:any}{
 const polys:number[][][][]=geometry.type==='Polygon'?[geometry.coordinates]:geometry.type==='MultiPolygon'?geometry.coordinates:[];
 const fixed=polys.map(poly=>{
  const crosses=poly.some(ring=>ring.some((p,i)=>i>0&&Math.abs(p[0]-ring[i-1][0])>180));
  if(!crosses)return poly;
  let east=0,west=0;for(const ring of poly)for(const p of ring)p[0]>=0?east++:west++;
  const edge=east>=west?180:-180;
  return poly.map(ring=>ring.map(p=>(edge>0?p[0]<0:p[0]>0)?[edge,p[1]]:p));
 });
 return geometry.type==='Polygon'?{...geometry,coordinates:fixed[0]}:geometry.type==='MultiPolygon'?{...geometry,coordinates:fixed}:geometry;
}

// ───────────── time ─────────────
// A ranking's rows may be in long form: one row per entity and period ({name, period: "2019", population…}).
// The reader then picks a period, or "latest" (each entity's most recent value of each criterion).
export const LATEST='latest';
const periodText=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?String(v):typeof v==='string'?v.trim():'';
export const comparePeriods=(a:string,b:string)=>{const x=Number(a),y=Number(b);return Number.isFinite(x)&&Number.isFinite(y)&&a!==''&&b!==''?x-y:a.localeCompare(b);};
// The period column, when the rows are in long form (an explicit key, else "period" or "year" with entities repeating).
export function periodKeyOf(rows:unknown,nameKey='name',explicit?:unknown):string|null{
 const list=Array.isArray(rows)?rows.filter(isObj):[];if(list.length<2)return null;
 const candidates=typeof explicit==='string'&&explicit?[explicit]:['period','year'];
 for(const k of candidates){
  if(!list.some(r=>periodText(r[k])))continue;
  if(typeof explicit==='string'&&explicit)return k;
  const names=new Set<string>();let repeat=false;for(const r of list){const n=text(r[nameKey]);if(names.has(n)){repeat=true;break;}names.add(n);}
  if(repeat)return k;
 }
 return null;
}
// Distinct periods, newest first.
export function rowPeriods(rows:unknown,key:string):string[]{
 const s=new Set<string>();for(const r of Array.isArray(rows)?rows:[])if(isObj(r)){const p=periodText(r[key]);if(p)s.add(p);}
 return [...s].sort((a,b)=>comparePeriods(b,a));
}
// The periods a reader may rank by: those where most entities have a value. A year with a handful of values is not a
// ranking of that year (the rest would be listed without data), so it is not offered; "latest" stays.
// A ranking always ranks one year (never a mix of each entity's latest years): the years offered for a criterion are
// those with data for it (at least 3 entities); the default is the newest year whose coverage is at least half of the
// best-covered year's (a year just begun, with a handful of values, is not the default).
export function yearsOf(rows:unknown,o:{nameKey:string;periodKey:string;key:string}):{years:string[];counts:Map<string,number>;fallback:string|null}{
 const by=new Map<string,Set<string>>();
 for(const r of Array.isArray(rows)?rows:[]){if(!isObj(r))continue;const n=text(r[o.nameKey]),p=periodText(r[o.periodKey]);if(!n||!p||parseNumber(r[o.key])==null)continue;let s=by.get(p);if(!s){s=new Set();by.set(p,s);}s.add(n);}
 const counts=new Map([...by].map(([p,s])=>[p,s.size]));
 const years=[...counts.keys()].filter(p=>counts.get(p)!>=3).sort((a,b)=>comparePeriods(b,a));
 return {years,counts,fallback:years.length?null:[...counts.keys()].sort((a,b)=>comparePeriods(b,a))[0]??null};
}
export function defaultYear(rows:unknown,o:{nameKey:string;periodKey:string;key:string}):string|null{
 const {years,counts,fallback}=yearsOf(rows,o);if(!years.length)return fallback;
 const best=Math.max(...years.map(y=>counts.get(y)!));
 return years.find(y=>counts.get(y)!>=best*0.5)??years[0];
}
export function rankablePeriods(rows:unknown,o:{nameKey:string;periodKey:string;keys:string[]},periods:string[]):string[]{
 const by=new Map<string,Set<string>>();const any=new Set<string>();
 for(const r of Array.isArray(rows)?rows:[]){if(!isObj(r))continue;const n=text(r[o.nameKey]),p=periodText(r[o.periodKey]);if(!n||!p)continue;
  if(!o.keys.some(k=>parseNumber(r[k])!=null))continue;any.add(n);let s=by.get(p);if(!s){s=new Set();by.set(p,s);}s.add(n);}
 // Every year with data is offered; in a year's view only the entities with data that year are ranked (the rest are
 // left out, not shown). A year with fewer than 3 entities is no ranking.
 return periods.filter(p=>(by.get(p)?.size||0)>=Math.min(3,any.size));
}
// The rows the latest view needs: for each entity, the row holding each criterion's most recent value (plus the rows
// of one extra period, for a page opened on ?year=). rowsAt(…, latest) over them gives the same table as over all rows,
// so a page can send these first and fetch the full history afterwards.
export function latestRows(rows:Obj[],o:{nameKey:string;periodKey:string;keys:string[];period?:string}):Obj[]{
 const by=new Map<string,Obj[]>();
 for(const r of rows){const n=text(r[o.nameKey]);if(!n)continue;const l=by.get(n);if(l)l.push(r);else by.set(n,[r]);}
 const keep=new Set<Obj>();
 for(const list of by.values()){
  list.sort((a,b)=>comparePeriods(periodText(b[o.periodKey]),periodText(a[o.periodKey])));
  keep.add(list[0]);
  for(const k of o.keys){const r=list.find(x=>parseNumber(x[k])!=null);if(r)keep.add(r);}
  if(o.period)for(const r of list)if(periodText(r[o.periodKey])===o.period)keep.add(r);
 }
 return rows.filter(r=>keep.has(r));
}
// One row per entity for a period: the entity's row of that period, or — for "latest" — each criterion's most
// recent value. Each row records the period of each value in __period.<key>.
export function rowsAt(rows:unknown,o:{nameKey:string;periodKey:string;period:string;keys:string[]}):Obj[]{
 const by=new Map<string,Obj[]>();
 for(const r of Array.isArray(rows)?rows:[]){if(!isObj(r))continue;const n=text(r[o.nameKey]);if(!n)continue;let l=by.get(n);if(!l){l=[];by.set(n,l);}l.push(r);}
 const out:Obj[]=[];
 for(const list of by.values()){
  list.sort((a,b)=>comparePeriods(periodText(b[o.periodKey]),periodText(a[o.periodKey])));
  // A chosen period lists only the entities measured in it: an entity without a value that year is not ranked.
  if(o.period!==LATEST){const r=list.find(x=>periodText(x[o.periodKey])===o.period);if(r&&o.keys.some(k=>parseNumber(r[k])!=null))out.push({...r,...Object.fromEntries(o.keys.map(k=>['__period.'+k,o.period]))});continue;}
  const row:Obj={...list[0]};
  for(const k of o.keys){const r=list.find(x=>parseNumber(x[k])!=null);row[k]=r?r[k]:null;if(r)row['__period.'+k]=periodText(r[o.periodKey]);}
  out.push(row);
 }
 return out;
}
// Values of one criterion over time for each entity: name → [[period, value]…] oldest first.
export function seriesOf(rows:unknown,o:{nameKey:string;periodKey:string;key:string}):Map<string,[string,number][]>{
 const m=new Map<string,[string,number][]>();
 for(const r of Array.isArray(rows)?rows:[]){if(!isObj(r))continue;const n=text(r[o.nameKey]),p=periodText(r[o.periodKey]),v=parseNumber(r[o.key]);if(!n||!p||v==null)continue;
  let l=m.get(n);if(!l){l=[];m.set(n,l);}l.push([p,v]);}
 for(const l of m.values())l.sort((a,b)=>comparePeriods(a[0],b[0]));
 return m;
}
