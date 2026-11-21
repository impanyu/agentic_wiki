// Text and page assembly for the database-driven pages (/e/<type>/<slug>, /rankings/<slug>): template
// sentences filled with formatted values, ranks and changes (a sentence that names a missing value is
// dropped, never printed with a blank), stat cards, chart sections, references and JSON-LD properties.
// Pure functions over plain data (no React, DB or DOM): the pages load the data, this decides what is said.
// The contract is docs/rankwiki-templates.md. Tests load this file with ranking-data.ts and urls.ts inlined.
import {makeFormatter,type Criterion,type Format} from '../workflows/viz/ranking-data';
import {slugify} from './urls';

// ───────────── addresses ─────────────
export const entityPath=(type:string,name:string)=>'/e/'+encodeURIComponent(type)+'/'+encodeURIComponent(slugify(name));
export const rankingPath=(slug:string)=>'/rankings/'+encodeURIComponent(slug);

// ───────────── values ─────────────
// Ranks are shown up to the top 1,000 (rankings stop there); beyond it an entity is "outside the top 1,000".
export const SHOWN_RANKS=1000;
export type MetricInfo={key:string;label:string;unit:string;order:'desc'|'asc';format:string;description?:string;methodology?:string};
export type Point={period:string;value:number};
export type MetricFact={value:number;period:string;source?:string;retrievedAt?:string|null;rank?:number|null;of?:number|null;history?:Point[]};

const FORMAT_NAMES:Format[]=['number','compact','percent','currency','decimal'];
const COMMON_CURRENCIES=['USD','EUR','GBP','JPY','CNY','INR','CHF','CAD','AUD','KRW','BRL','RUB','MXN','SEK','NOK','DKK','PLN','TRY','ZAR','SGD','HKD','NZD','SAR','AED','IDR','THB','ILS','CZK','HUF'];
let currencyCodes:Set<string>|null=null;
export function isCurrencyCode(unit:string):boolean{
 const u=String(unit||'').trim().toUpperCase();if(!/^[A-Z]{3}$/.test(u))return false;
 if(!currencyCodes){let list:string[]=COMMON_CURRENCIES;try{const f=(Intl as unknown as {supportedValuesOf?:(k:string)=>string[]}).supportedValuesOf;if(f)list=f('currency');}catch{}currencyCodes=new Set(list);}
 return currencyCodes.has(u);
}
const prettyUnit=(u:string)=>u.replace(/\bkm2\b/g,'km²').replace(/\bm2\b/g,'m²').replace(/\bkm3\b/g,'km³');
// A metric definition as a ranking criterion (and the formatting of every value of it on the pages).
export function criterionOf(d:MetricInfo,extra:{key?:string;year?:string}={}):Criterion{
 const unit=prettyUnit(String(d.unit||'').trim());const currency=isCurrencyCode(unit)?unit.toUpperCase():'';
 const asked=FORMAT_NAMES.includes(d.format as Format)?d.format as Format:null;
 const format:Format=asked==='currency'||(!asked&&currency)?'currency':asked||(unit==='%'?'percent':'number');
 return {key:extra.key||d.key,label:d.label||d.key,order:d.order==='asc'?'asc':'desc',format,
  ...(format==='currency'?{currency:currency||'USD'}:format==='percent'||!unit?{}:{unit}),
  ...(d.description?{description:d.description}:{}),...(extra.year?{year:extra.year}:{})};
}
export function formatMetric(d:MetricInfo,value:number,locale='en'):string{
 return makeFormatter(criterionOf(d),[value],locale)(value);
}
export function ordinal(n:number,locale='en'):string{
 if(/^zh/i.test(locale))return '第'+n;
 if(/^en/i.test(locale)||!locale){const s=['th','st','nd','rd'],v=n%100;return n+(s[(v-20)%10]||s[v]||s[0]);}
 return n+'.';
}
const nf=(locale:string,o:Intl.NumberFormatOptions)=>{try{return new Intl.NumberFormat(locale||'en',o);}catch{return new Intl.NumberFormat('en',o);}};
export const countText=(n:number,locale='en')=>nf(locale,{maximumFractionDigits:0}).format(n);
const comparePeriodText=(a:string,b:string)=>{const x=Number(a),y=Number(b);return a!==''&&b!==''&&Number.isFinite(x)&&Number.isFinite(y)?x-y:a.localeCompare(b);};
export const sortPoints=(points:Point[])=>[...points].sort((a,b)=>comparePeriodText(a.period,b.period));
// Change since the period before the value's own: "+1.2%" (percentage points for percent metrics).
export function changeText(d:MetricInfo,fact:MetricFact,locale='en'):string|null{
 const h=sortPoints((fact.history||[]).filter(p=>Number.isFinite(p.value)&&p.period));
 const i=h.findIndex(p=>p.period===fact.period);const prev=i>0?h[i-1]:i<0?[...h].reverse().find(p=>comparePeriodText(p.period,fact.period)<0):null;
 if(!prev)return null;
 const sign=(x:number)=>x>0?'+':x<0?'−':'±';
 if(criterionOf(d).format==='percent'){const dd=fact.value-prev.value;return sign(dd)+nf(locale,{maximumFractionDigits:1}).format(Math.abs(dd))+' pp';}
 if(!prev.value)return null;
 const pct=(fact.value-prev.value)/Math.abs(prev.value)*100;
 return sign(Math.round(pct*10)/10)+nf(locale,{maximumFractionDigits:1,minimumFractionDigits:Math.abs(pct)<10?1:0}).format(Math.abs(pct))+'%';
}
export function listText(items:string[],locale='en'):string{
 const list=items.filter(Boolean);
 try{return new (Intl as unknown as {ListFormat:new(l:string,o:object)=>{format:(x:string[])=>string}}).ListFormat(locale||'en',{style:'long',type:'conjunction'}).format(list);}
 catch{return list.length<2?list.join(''):list.slice(0,-1).join(', ')+' and '+list[list.length-1];}
}
const scalarText=(v:unknown):string=>typeof v==='string'?v.trim():typeof v==='number'&&Number.isFinite(v)?String(v):typeof v==='boolean'?(v?'yes':'no'):Array.isArray(v)?v.map(scalarText).filter(Boolean).join(', '):'';
// "Life expectancy" → "life expectancy" inside a sentence; acronyms (GDP, HDI) keep their case.
export const lowerLabel=(s:string)=>s.replace(/\b[A-Z][a-z]+\b/g,w=>w.toLowerCase());
export const humanize=(k:string)=>{const s=k.replace(/[_.]+/g,' ').trim();return s.charAt(0).toUpperCase()+s.slice(1);};

export type EntityValuesInput={name:string;typeLabel:string;typePlural?:string;metrics:Record<string,MetricFact>;defs:Record<string,MetricInfo>;attributes:Record<string,unknown>;relations:Record<string,{name:string}[]>;locale?:string};
// Every value a template may name, as display text: name, type.label, metric./period./rank./of./change., attr., rel.
export function entityValues(x:EntityValuesInput):Record<string,string>{
 // In sentences a type is a common noun: "a country", not "a Country" (acronyms such as "NBA team" keep their capitals).
 const lower=(t:string)=>t.replace(/\b([A-Z])([a-z]+)\b/g,(_m,a:string,b:string)=>a.toLowerCase()+b);
 const locale=x.locale||'en';const out:Record<string,string>={name:x.name,'type.label':lower(x.typeLabel)};
 if(x.typePlural)out['type.plural']=x.typePlural;
 for(const [key,f] of Object.entries(x.metrics)){
  if(!f||!Number.isFinite(f.value))continue;const d=x.defs[key]||{key,label:key,unit:'',order:'desc',format:''};
  out['metric.'+key]=formatMetric(d,f.value,locale);
  if(f.period)out['period.'+key]=f.period;
  if(f.rank!=null&&f.rank>=1&&f.rank<=SHOWN_RANKS)out['rank.'+key]=ordinal(f.rank,locale);
  if(f.of!=null&&f.of>=1)out['of.'+key]=countText(f.of,locale);
  const ch=changeText(d,f,locale);if(ch)out['change.'+key]=ch;
 }
 for(const [k,v] of Object.entries(x.attributes||{})){const s=scalarText(v);if(s)out['attr.'+k]=s;}
 for(const [p,list] of Object.entries(x.relations||{}))if(list?.[0]?.name)out['rel.'+p]=list[0].name;
 return out;
}
// {name} placeholders → values; null when any named value is missing (the sentence is dropped).
const PLACEHOLDER=/\{([A-Za-z_][\w]*(?:\.[\w@:-]+)?)\}/g;
export function fill(pattern:string,values:Record<string,string>):string|null{
 let missing=false;
 const s=String(pattern||'').replace(PLACEHOLDER,(_m,k:string)=>{const v=values[k];if(v==null||v===''){missing=true;return '';}return v;});
 return missing||!s.trim()?null:s.trim();
}
// Text with links: a sentence as parts, each filled value linking to the page of what it names when one exists.
export type Part={text:string;href?:string};
export function fillParts(pattern:string,values:Record<string,string>,hrefs:Record<string,string>={}):Part[]|null{
 const parts:Part[]=[];let last=0,missing=false;const src=String(pattern||'');
 for(const m of src.matchAll(PLACEHOLDER)){const v=values[m[1]];if(v==null||v===''){missing=true;break;}
  if(m.index!>last)parts.push({text:src.slice(last,m.index)});parts.push(hrefs[m[1]]?{text:v,href:hrefs[m[1]]}:{text:v});last=m.index!+m[0].length;}
 if(missing)return null;if(last<src.length)parts.push({text:src.slice(last)});
 const text=parts.map(p=>p.text).join('').trim();if(!text)return null;
 // Trim like fill(): leading/trailing whitespace of the sentence.
 if(parts.length){parts[0]={...parts[0],text:parts[0].text.replace(/^\s+/,'')};const l=parts.length-1;parts[l]={...parts[l],text:parts[l].text.replace(/\s+$/,'')};}
 return parts.filter(p=>p.text);
}
export const partsText=(parts:Part[])=>parts.map(p=>p.text).join('');
// The key mentions are resolved by (names, aliases): case and spacing ignored.
export const mentionKey=(name:string)=>String(name||'').normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
export const fillAll=(patterns:unknown,values:Record<string,string>):string[]=>(Array.isArray(patterns)?patterns:typeof patterns==='string'?[patterns]:[]).map(p=>typeof p==='string'?fill(p,values):null).filter((s):s is string=>!!s);

// ───────────── entity pages ─────────────
export type Section={kind:string;title?:string;metrics?:string[];metric?:string;sentences?:string[]};
export type Template={lead?:(string|string[])[];card?:string[];sections?:Section[]};
export type EntityRelations={outgoing:{predicate:string;name:string;type:string;source?:string}[];incoming:{predicate:string;type:string;count:number;sample:{name:string}[]}[]};
export type EntityRankingRef={slug:string;title:string;filters?:Record<string,unknown>;ranks:{key:string;label:string;rank:number|null;of:number|null}[]};
export type EntityPageData={
 entity:{id:string;name:string;type:string;description:string;aliases:string[];ids:Record<string,string>;attributes:Record<string,unknown>;image?:string|null};
 type:{label:string;plural:string;template:Template|null};
 defs:Record<string,MetricInfo>;
 metrics:Record<string,MetricFact>;
 relations:EntityRelations;
 // Latest values of every peer (the top 1,000 of the type) for the metrics position/peer_compare/radar name.
 peers:Record<string,{name:string;type?:string;value:number}[]>;
 rankings:EntityRankingRef[];
 // Pages that exist for names this page mentions (attribute values, related entities): mentionKey(name) → path.
 // Resolved when the page is assembled, so links appear on old pages as soon as the new page exists.
 links?:Record<string,string>;
};
export type PageSection={component:string;title?:string;props?:Record<string,unknown>;paragraphs?:string[];paragraphParts?:Part[][];links?:{href:string;title:string;detail:string}[]};
export type EntityPageModel={title:string;lead:string[];leadParts:Part[][];cards:Record<string,unknown>[];sections:PageSection[];references:{source:string;what:string}[];asOf:string|null;
 description:string;properties:{name:string;value:number|string;unitText?:string}[]};

const LOCATION_KEYS=['iso3','iso2','code','iso_3166_2','region_code','fips'];
const coord=(v:unknown)=>{const n=typeof v==='number'?v:typeof v==='string'?Number(v):NaN;return Number.isFinite(n)?n:null;};
function locationOf(e:EntityPageData['entity']):Record<string,unknown>|null{
 const a=e.attributes||{};let region='';
 for(const k of LOCATION_KEYS){const v=e.ids?.[k]??a[k];if(typeof v==='string'&&v.trim()){region=v.trim();break;}}
 if(!region&&e.type==='country')region=e.name;
 if(!region&&e.type!=='country'&&typeof a.country==='string')region=a.country;
 const lat=coord(a.lat??a.latitude),lon=coord(a.lon??a.lng??a.longitude);
 const coordinates=typeof a.coordinates==='string'&&/-?\d/.test(a.coordinates)?a.coordinates:'';
 if(!region&&(lat==null||lon==null)&&!coordinates)return null;
 return {name:e.name,...(region?{region}:{}),...(lat!=null&&lon!=null?{lat,lon}:coordinates?{coordinates}:{})};
}
const DATE=/^-?\d{3,4}(-\d{2}(-\d{2})?)?$/;
const DATED=/(founded|founding|established|inception|opened|launched|released|born|died|built|created|dissolved|independence|formed|introduced|date)/i;
function datedAttributes(a:Record<string,unknown>):{date:string;label:string}[]{
 return Object.entries(a||{}).flatMap(([k,v])=>{const s=scalarText(v);return DATE.test(s)&&(DATED.test(k)||/-\d{2}-\d{2}$/.test(s))?[{date:s,label:humanize(k)}]:[];});
}
// When a type has no template: the card and charts follow the entity's own metrics.
export function defaultTemplate(d:EntityPageData):Template{
 const keys=Object.keys(d.metrics).sort((a,b)=>(d.metrics[b].history?.length||0)-(d.metrics[a].history?.length||0)||a.localeCompare(b));
 const first=keys[0];const label=(k:string)=>lowerLabel(d.defs[k]?.label||humanize(k));
 const attrs=Object.keys(d.entity.attributes||{}).filter(k=>scalarText(d.entity.attributes[k])&&!LOCATION_KEYS.includes(k)&&!DATE.test(scalarText(d.entity.attributes[k]))).slice(0,3);
 const rels=[...new Set(d.relations.outgoing.map(r=>r.predicate))].slice(0,2);
 const lead:(string|string[])[]=['{name} is a {type.label}.'];
 if(first)lead.push([`Its ${label(first)} is {metric.${first}} ({period.${first}}), {rank.${first}} of {of.${first}}.`,`Its ${label(first)} is {metric.${first}} ({period.${first}}).`]);
 return {lead,card:[...keys.slice(0,6),...rels.map(p=>'rel.'+p),...attrs.map(a=>'attr.'+a)],
  sections:[...keys.filter(k=>(d.metrics[k].history?.length||0)>1).slice(0,4).map(k=>({kind:'trend',title:d.defs[k]?.label||humanize(k),metrics:[k]})),
   ...(first?[{kind:'position',metric:first},{kind:'peer_compare',metric:first}]:[]),
   ...(keys.length>=3?[{kind:'radar_profile',metrics:keys.slice(0,6)}]:[]),
   {kind:'location_map'},{kind:'relations'},{kind:'rankings'},{kind:'timeline'}]};
}
// Lead: one sentence per pattern, dropped when a value is missing; an element may also be a list of
// alternatives (the first that can be filled wins), e.g. a sentence with a rank and one without.
// A sentence whose facts (the metric, rank, attribute… values it names; name and type do not count) were all
// stated by an earlier sentence is dropped, so two patterns never repeat the same fact.
const facts=(pattern:string)=>[...pattern.matchAll(PLACEHOLDER)].map(m=>m[1]).filter(k=>k!=='name'&&!k.startsWith('type.')).map(k=>k.replace(/^(metric|period|rank|of|change)\./,''));
function leadSentences(patterns:unknown[],values:Record<string,string>,hrefs:Record<string,string>={}):Part[][]{
 const said=new Set<string>();
 return patterns.flatMap(p=>{const alts=Array.isArray(p)?p:[p];
  for(const a of alts){if(typeof a!=='string')continue;const s=fillParts(a,values,hrefs);if(!s)continue;
   const f=facts(a);if(f.length&&f.every(k=>said.has(k)))return [];f.forEach(k=>said.add(k));return [s];}
  return [];});
}
// Trend series. Two series in one unit whose sizes differ by 50× or more (GDP and GDP per capita) get an axis
// each: the trend component draws two axes for two units, so they are told apart by their labels (currency and
// percent values carry no unit text, so only the axis names change).
function trendSeries(list:{c:Criterion;points:Point[]}[]){
 const max=(p:Point[])=>Math.max(0,...p.map(x=>Math.abs(x.value)));
 const split=list.length===2&&(list[0].c.unit||'')===(list[1].c.unit||'')&&list.every(x=>x.c.format==='currency'||x.c.format==='percent')
  &&Math.max(max(list[0].points),max(list[1].points))>=50*Math.max(1e-9,Math.min(max(list[0].points),max(list[1].points)));
 return list.map(({c,points})=>({label:c.label,...(split?{unit:c.label}:c.unit?{unit:c.unit}:{}),points}));
}
export function assembleEntityPage(d:EntityPageData,locale='en'):EntityPageModel{
 const e=d.entity;const tpl:Template=d.type.template&&(d.type.template.lead||d.type.template.card||d.type.template.sections)?d.type.template:defaultTemplate(d);
 const relMap:Record<string,{name:string}[]>={};for(const r of d.relations.outgoing)(relMap[r.predicate]??=[]).push({name:r.name});
 const values=entityValues({name:e.name,typeLabel:d.type.label||humanize(e.type).toLowerCase(),typePlural:d.type.plural,metrics:d.metrics,defs:d.defs,attributes:e.attributes,relations:relMap,locale});
 // Where each filled value leads: attributes and related entities to their pages (when they exist), ranks to the ranking view.
 const links=d.links||{};const pageOf=(name:string)=>links[mentionKey(name)];
 const hrefs:Record<string,string>={};
 // An attribute value without a page of its own can still lead to the sub-ranking scoped to it ("Europe & Central Asia" →
 // Country Rankings in Europe & Central Asia).
 const scopedRanking=(k:string,t:string)=>{const r=d.rankings.find(x=>{const f=x.filters?.[k];return typeof f==='string'&&f.toLowerCase()===t.toLowerCase();});return r?rankingPath(r.slug):undefined;};
 for(const [k,v] of Object.entries(e.attributes||{})){const t=scalarText(v);const h=t&&(pageOf(t)||scopedRanking(k,t));if(h)hrefs['attr.'+k]=h;}
 for(const [p,list] of Object.entries(relMap)){const h=list?.[0]&&pageOf(list[0].name);if(h)hrefs['rel.'+p]=h;}
 for(const k of Object.keys(d.metrics)){const r=d.rankings.find(x=>x.ranks.some(y=>y.key===k));if(r){const h=rankingPath(r.slug)+(r.ranks[0]?.key===k?'':'?rank='+encodeURIComponent(k));hrefs['rank.'+k]=h;hrefs['of.'+k]=h;}}
 const def=(k:string):MetricInfo=>d.defs[k]||{key:k,label:humanize(k),unit:'',order:'desc',format:''};
 const used=new Set<string>();const relUsed=new Set<string>();
 const firstRanking=(k:string)=>d.rankings.find(r=>r.ranks.some(x=>x.key===k));
 // Card
 const cards:Record<string,unknown>[]=[];
 for(const item of tpl.card||[]){
  if(item.startsWith('attr.')){const k=item.slice(5),s=scalarText(e.attributes?.[k]);if(s){const h=pageOf(s)||scopedRanking(k,s);cards.push({label:humanize(k),value:s,...(h?{href:h}:{})});}continue;}
  if(item.startsWith('rel.')){const p=item.slice(4),r=d.relations.outgoing.find(x=>x.predicate===p);if(r){relUsed.add(p);const h=pageOf(r.name);cards.push({label:humanize(p),value:r.name,...(h?{href:h}:{})});}continue;}
  const k=item.startsWith('metric.')?item.slice(7):item;const f=d.metrics[k];
  if(!f){const s=scalarText(e.attributes?.[k]);if(s)cards.push({label:humanize(k),value:s});continue;}
  used.add(k);const c=criterionOf(def(k));const r=firstRanking(k);const outside=f.rank!=null&&f.rank>SHOWN_RANKS;
  cards.push({label:c.label,value:f.value,format:c.format,...(c.unit?{unit:c.unit}:{}),...(c.currency?{currency:c.currency}:{}),year:f.period,order:c.order,
   ...(f.rank!=null&&!outside?{rank:f.rank}:{}),...(f.of!=null&&!outside?{of:f.of}:{}),
   ...(outside?{note:'Outside the top '+countText(SHOWN_RANKS,locale)+(f.of?' of '+countText(f.of,locale):'')}:{}),
   history:sortPoints(f.history||[]),...(r?{href:rankingPath(r.slug)+(r.ranks[0]?.key===k?'':'?rank='+encodeURIComponent(k))}:{})});
 }
 // Sections
 const sections:PageSection[]=[];
 const peerValues=(k:string)=>{
  const list=(d.peers[k]||[]).map(p=>({name:p.name,value:p.value,...(p.type?{href:entityPath(p.type,p.name)}:{})}));
  const f=d.metrics[k];const inList=list.some(p=>p.name===e.name);
  if(f&&!inList)list.push({name:e.name,value:f.value});
  return {list,outside:!!f&&!inList};
 };
 const measure=(k:string)=>{const c=criterionOf(def(k));return {label:c.label,format:c.format,order:c.order,...(c.unit?{unit:c.unit}:{}),...(c.currency?{currency:c.currency}:{}),...(d.metrics[k]?.period?{year:d.metrics[k].period}:{})};};
 const outsideNote=(k:string)=>{const f=d.metrics[k];return 'Among the top '+countText(SHOWN_RANKS,locale)+' '+(d.type.plural||'entities')+'; '+e.name+' is outside them'+(f?.rank&&f.of?' ('+ordinal(f.rank,locale)+' of '+countText(f.of,locale)+')':'')+'.';};
 for(const s of tpl.sections||[]){
  switch(s.kind){
   case 'trend':{
    const all=(s.metrics||[]).filter(k=>(d.metrics[k]?.history?.length||0)>1);if(!all.length)break;all.forEach(k=>used.add(k));
    // One chart per unit and format (people and USD never share an axis or a formatter), at most 6 lines each.
    const groups=new Map<string,string[]>();for(const k of all){const c=criterionOf(def(k)),g=(c.unit||'')+'|'+c.format+'|'+(c.currency||'');const l=groups.get(g)??[];if(l.length<6)l.push(k);groups.set(g,l);}
    for(const keys of groups.values()){
     const c0=criterionOf(def(keys[0]));
     const title=groups.size===1&&s.title?s.title:keys.length===1?def(keys[0]).label:(s.title?s.title+': ':'')+keys.map(k=>def(k).label).join(', ');
     sections.push({component:'trend',title,props:{format:c0.format,...(c0.currency?{currency:c0.currency}:{}),...(c0.unit?{unit:c0.unit}:{}),
      series:trendSeries(keys.map(k=>({c:criterionOf(def(k)),points:sortPoints(d.metrics[k].history||[])}))),
      source:[...new Set(keys.map(k=>d.metrics[k].source).filter(Boolean))].join('; ')}});
    }
    break;}
   case 'position':case 'peer_compare':{
    const k=s.metric||s.metrics?.[0];if(!k||!d.metrics[k])break;const {list,outside}=peerValues(k);if(list.length<2)break;used.add(k);
    sections.push({component:s.kind,title:s.title||(s.kind==='position'?def(k).label+': where '+e.name+' stands':def(k).label+': neighbours'),
     props:{values:list,highlight:e.name,...measure(k),...(outside?{subtitle:outsideNote(k)}:{}),...(d.metrics[k].source?{source:d.metrics[k].source}:{})}});
    break;}
   case 'radar_profile':{
    const keys=(s.metrics||[]).filter(k=>d.metrics[k]&&(d.peers[k]?.length||0)>1);if(keys.length<3)break;keys.forEach(k=>used.add(k));
    const rows=new Map<string,Record<string,unknown>>();
    for(const k of keys)for(const p of peerValues(k).list){let r=rows.get(p.name);if(!r){r={name:p.name};rows.set(p.name,r);}r[k]=p.value;}
    sections.push({component:'radar_profile',title:s.title||'Profile',props:{criteria:keys.map(k=>{const c=criterionOf(def(k));return {key:k,label:c.label,order:c.order,format:c.format,...(c.unit?{unit:c.unit}:{}),...(c.currency?{currency:c.currency}:{})};}),
     rows:[...rows.values()],highlight:e.name,subtitle:'Percentile among '+(d.type.plural||'peers')+' on each measure'}});
    break;}
   case 'location_map':{const loc=locationOf(e);if(loc)sections.push({component:'location_map',title:s.title||'Location',props:loc});break;}
   case 'relations':{
    const link=(name:string)=>{const h=pageOf(name);return h?{href:h}:{};};
    const rels=[...d.relations.outgoing.map(r=>({predicate:humanize(r.predicate),name:r.name,type:r.type,...link(r.name)})),
     ...d.relations.incoming.flatMap(g=>g.sample.map(x=>({predicate:humanize(g.predicate)+' of',name:x.name,type:g.type,...link(x.name)})))];
    if(!rels.length)break;d.relations.outgoing.forEach(r=>relUsed.add(r.predicate));
    sections.push({component:'relation_graph',title:s.title||'Related',props:{center:{name:e.name},relations:rels.slice(0,80)}});
    break;}
   case 'rankings':{
    if(!d.rankings.length)break;
    sections.push({component:'rankings',title:s.title||'Rankings',links:d.rankings.map(r=>({href:rankingPath(r.slug),title:r.title,
     detail:r.ranks.map(x=>x.label+': '+(x.rank==null?'not ranked':x.rank>SHOWN_RANKS?'outside the top '+countText(SHOWN_RANKS,locale):ordinal(x.rank,locale)+(x.of?' of '+countText(x.of,locale):''))).join(' · ')}))});
    break;}
   case 'timeline':{const ev=datedAttributes(e.attributes);if(ev.length)sections.push({component:'timeline',title:s.title||'Timeline',props:{events:ev}});break;}
   case 'text':{
    const sentenceParts=(Array.isArray(s.sentences)?s.sentences:[]).map(p=>typeof p==='string'?fillParts(p,values,hrefs):null).filter((x):x is Part[]=>!!x);
    const paragraphs=sentenceParts.map(partsText);if(!paragraphs.length)break;
    for(const p of s.sentences||[])for(const m of String(p).matchAll(PLACEHOLDER)){const [ns,k]=m[1].split('.');if(k&&['metric','period','rank','of','change'].includes(ns)&&d.metrics[k])used.add(k);}
    sections.push({component:'text',title:s.title,paragraphs:[paragraphs.join(' ')],paragraphParts:[sentenceParts.flatMap((x,i)=>i?[{text:' '},...x]:x)]});
    break;}
   default:break;// unknown kinds are ignored
  }
 }
 const leadParts=leadSentences(tpl.lead||[],values,hrefs);const lead=leadParts.map(partsText);
 for(const p of (tpl.lead||[]).flat())for(const m of String(p).matchAll(PLACEHOLDER)){const [ns,k]=m[1].split('.');if(k&&d.metrics[k]&&ns!=='attr'&&ns!=='rel')used.add(k);}
 // References: the sources of the facts shown, each with what it supports.
 const bySource=new Map<string,Set<string>>();
 const add=(src:string|undefined,what:string)=>{if(!src)return;let s=bySource.get(src);if(!s){s=new Set();bySource.set(src,s);}s.add(what);};
 for(const k of used){const f=d.metrics[k];const periods=sortPoints(f.history||[]).map(p=>p.period);add(f.source,def(k).label+(periods.length>1?' ('+periods[0]+'–'+periods[periods.length-1]+')':f.period?' ('+f.period+')':''));}
 for(const r of d.relations.outgoing)if(relUsed.has(r.predicate))add(r.source,humanize(r.predicate));
 const references=[...bySource].map(([source,what])=>({source,what:[...what].join(', ')}));
 const stamps=[...used].map(k=>d.metrics[k].retrievedAt).filter((x):x is string=>!!x).sort();
 const properties:EntityPageModel["properties"]=Object.entries(d.metrics).map(([k,f])=>{const c=criterionOf(def(k));return {name:c.label,value:f.value,...(def(k).unit?{unitText:def(k).unit}:{})};});
 for(const [k,v] of Object.entries(e.attributes||{})){const s=scalarText(v);if(s&&s.length<200)properties.push({name:humanize(k),value:s});}
 const description=(lead.join(' ')||e.description||e.name).slice(0,300);
 return {title:e.name,lead,leadParts,cards,sections,references,asOf:stamps.length?stamps[stamps.length-1]:null,description,properties};
}

// ───────────── ranking pages ─────────────
export type RankingDef={slug:string;title:string;scope:{type?:string;filters?:Record<string,unknown>};criteria:string[];config:Record<string,unknown>;status?:string;updatedAt?:string|null};
export type RankingColumn={column:string;key:string;count:number};
export type RankingPageInput={def:RankingDef;defs:Record<string,MetricInfo>;columns:RankingColumn[];rows:Record<string,unknown>[];
 type:{label:string;plural:string;expected?:number|null};entities:Record<string,{group?:string|null;code?:string|null}>;related:{slug:string;title:string}[]};
export type RankingPageModel={title:string;lead:string|null;criteria:Criterion[];rows:Record<string,unknown>[];defaultKey:string;groupKey?:string;
 about:string[];related:{href:string;title:string}[];sources:string[];periods:string[];count:number;description:string};
const str=(v:unknown)=>typeof v==='string'?v.trim():'';
// Ranking definition + metric definitions + metric_table rows → what the page shows.
export function assembleRankingPage(x:RankingPageInput,locale='en'):RankingPageModel{
 const cfg=x.def.config||{};const groupKey=str(cfg.group)||undefined;
 const periodsOf=(col:string)=>[...new Set(x.rows.filter(r=>typeof r[col]==='number').map(r=>String(r.period??'')).filter(Boolean))].sort(comparePeriodText);
 const sourcesOf=(col:string)=>[...new Set(x.rows.map(r=>str(r[col+'_source'])).filter(Boolean))];
 const def=(k:string):MetricInfo=>x.defs[k]||{key:k,label:humanize(k),unit:'',order:'desc',format:''};
 const criteria=x.columns.map(c=>{const p=periodsOf(c.column);return criterionOf(def(c.key),{key:c.column,year:p[p.length-1]});});
 const rows=x.rows.map(r=>{const meta=x.entities[String(r.entity_id)]||{};const out:Record<string,unknown>={...r,question:r.name};
  if(groupKey&&meta.group)out[groupKey]=meta.group;if(meta.code&&!out.code)out.code=meta.code;
  for(const k of Object.keys(out))if(k.endsWith('_source')||k.endsWith('_rank')||k.endsWith('_period'))delete out[k];return out;});
 const names=new Set(x.rows.map(r=>String(r.entity_id??r.name)));const count=names.size;
 const periods=[...new Set(x.rows.map(r=>String(r.period??'')).filter(Boolean))].sort((a,b)=>comparePeriodText(b,a));
 const sources=[...new Set(x.columns.flatMap(c=>sourcesOf(c.column)))];
 const defaultKey=x.columns.find(k=>k.key===cfg.default||k.column===cfg.default)?.column||criteria[0]?.key||'';
 const values:Record<string,string>={count:countText(count,locale),'type.label':x.type.label,'type.plural':x.type.plural||x.type.label,title:x.def.title,
  criteria:listText(criteria.map(c=>lowerLabel(c.label)),locale),...(sources.length?{source:sources.join('; ')}:{}),...(x.type.expected?{expected:countText(x.type.expected,locale)}:{})};
 const lead=(str(cfg.lead)&&fill(str(cfg.lead),values))||fill('{count} {type.plural}, ranked by {criteria}.',values);
 const about:string[]=[];
 for(const c of x.columns){
  const d=def(c.key),p=periodsOf(c.column),src=sourcesOf(c.column),cr=criterionOf(d);
  const unit=cr.format==='currency'?cr.currency:cr.format==='percent'?'%':cr.unit;
  about.push(`${d.label}${unit?' ('+unit+')':''}${d.description?': '+d.description.replace(/\.$/,''):''}. `
   +(d.methodology?'Method: '+d.methodology.replace(/\.$/,'')+'. ':'')
   +(src.length?'Source: '+src.join('; ')+'. ':'')
   +(p.length?(p.length>1?'Years '+p[0]+'–'+p[p.length-1]:'Year '+p[0])+'. ':'')
   +countText(c.count,locale)+' ranked'+(count&&c.count<count?' of '+countText(count,locale):'')+(cr.order==='asc'?'; lower ranks first':'')+'.');
 }
 about.push(...fillAll(cfg.about,values));
 about.push(`Rankings list the top ${countText(SHOWN_RANKS,locale)} on each criterion; ranks are computed over every ${x.type.label||'entity'} in scope.`);
 const title=x.def.title||humanize(x.type.plural||x.def.slug)+' ranking';
 return {title,lead,criteria,rows,defaultKey,...(groupKey?{groupKey}:{}),about,sources,periods,count,
  related:x.related.map(r=>({href:rankingPath(r.slug),title:r.title||r.slug})),
  description:(lead||title).slice(0,300)};
}
// Rows (long form) as CSV: name, type, period, then each criterion (and the group column).
export function rowsCsv(rows:Record<string,unknown>[],columns:string[]):string{
 const cell=(v:unknown)=>{const s=v==null?'':typeof v==='number'?String(v):String(v);return /[",\n\r]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;};
 return [columns.join(','),...rows.map(r=>columns.map(c=>cell(r[c])).join(','))].join('\n')+'\n';
}
