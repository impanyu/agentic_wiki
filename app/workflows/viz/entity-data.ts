// Pure helpers behind the entity-page components (stat_cards, trend, position, radar_profile,
// peer_compare, location_map, relation_graph, timeline): normalize props, rank and place one entity
// among its peers, lay out sparklines and beeswarms, pick neighbours, project points onto U.S. maps.
// No React or DOM; tests load this file (with its dependencies inlined) directly.
// Internal names carry an "ev" prefix: tests concatenate this file with ranking-data.ts and ranking-geo.ts.
import {parseNumber,makeFormatter,median,colorScale,toEntries,rankEntries,normalizeCriteria,type Criterion,type Format} from './ranking-data';
import {countryKey} from './world-codes';
import {usStateKey} from './ranking-geo';

type EvObj=Record<string,unknown>;
const evIsObj=(v:unknown):v is EvObj=>!!v&&typeof v==='object'&&!Array.isArray(v);
const evText=(v:unknown)=>typeof v==='string'?v.trim():typeof v==='number'&&Number.isFinite(v)?String(v):'';
// JSONata yields one object for a one-item result; list props accept it as one item.
export const evList=(v:unknown):unknown[]=>Array.isArray(v)?v:evIsObj(v)?[v]:[];
const EV_FORMATS:Format[]=['number','compact','percent','currency','decimal'];
export const asFormat=(f:unknown):Format=>EV_FORMATS.includes(f as Format)?f as Format:'number';
export const asOrder=(o:unknown):'desc'|'asc'=>o==='asc'?'asc':'desc';
export const EV_FONT='Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
export const EV_ACCENT='#4f7cff',EV_HOT='#ff8a4c';
export const EV_PALETTE=['#4f7cff','#22c3a6','#ff8a4c','#a46bff','#f2c94c','#ef5da8','#2bb3e0','#7bd389'];
export const EV_MEDAL=['#e8a400','#8d99ab','#c0773a'];

// Links: same-site paths or https URLs only.
export function safeHref(u:unknown):string|null{
 if(typeof u!=='string')return null;const s=u.trim();
 if(/^\/(?!\/)[^\s]*$/.test(s))return s;
 if(/^https:\/\/[^\s<>"']+$/i.test(s)){try{new URL(s);return s;}catch{return null;}}
 return null;
}

// ───────────── periods and dates ─────────────
// A sortable number for "2023", 2023, "2023-05", "2023-Q2", "2023-05-17", "FY2023", "-500"; null when there is no year.
export function periodKey(p:unknown):number|null{
 const s=evText(p);if(!s)return null;
 const m=/(^|[^\d])(-?\d{1,4})(?:[-/.](?:[Qq]([1-4])|(\d{1,2}))(?:[-/.](\d{1,2}))?)?(?!\d)/.exec(s);
 if(!m)return null;
 const y=Number(m[2]);if(!m[3]&&!m[4])return y;
 const month=m[3]?(Number(m[3])-1)*3+1:Math.min(12,Math.max(1,Number(m[4])));
 const day=m[5]?Math.min(31,Math.max(1,Number(m[5]))):1;
 return y+(month-1)/12+(day-1)/372;
}
export type Point={period:string;value:number};
// [{period,value}] (or [{date|year|x, value|y}]) with numeric values, in time order; a repeated period keeps the last value.
export function normalizePoints(raw:unknown):Point[]{
 const out:Point[]=[];const at=new Map<string,number>();
 for(const p of evList(raw)){
  if(!evIsObj(p))continue;
  const period=evText(p.period??p.date??p.year??p.x);const value=parseNumber(p.value??p.y);
  if(!period||value==null)continue;
  const i=at.get(period);if(i!=null)out[i]={period,value};else{at.set(period,out.length);out.push({period,value});}
 }
 return sortByPeriod(out,p=>p.period);
}
// Stable chronological sort when every item has a period; otherwise the given order.
export function sortByPeriod<T>(items:T[],period:(t:T)=>string):T[]{
 const keys=items.map(t=>periodKey(period(t)));
 if(keys.some(k=>k==null))return items;
 return items.map((t,i)=>({t,i,k:keys[i]!})).sort((a,b)=>a.k-b.k||a.i-b.i).map(x=>x.t);
}

// ───────────── numbers ─────────────
export function ordinal(n:number,locale='en'):string{
 if(/^zh/i.test(locale))return '第'+n;
 if(/^en/i.test(locale)||!locale){const s=['th','st','nd','rd'],v=n%100;return n+(s[(v-20)%10]||s[v]||s[0]);}
 return n+'.';
}
// Share of the other peers this value beats: 100 = best of all, 0 = last; ties count half. Order asc: smaller is better.
export function percentileOf(value:number,values:number[],order:'desc'|'asc'='desc'):number{
 const n=values.length;if(n<=1)return 100;
 let worse=0,equal=0;
 for(const v of values){if(v===value)equal++;else if(order==='asc'?v>value:v<value)worse++;}
 return Math.max(0,Math.min(100,(worse+Math.max(0,equal-1)/2)/(n-1)*100));
}
// "Top x%" of a rank among n (as the ranking table shows it).
export const topPercent=(rank:number,n:number)=>Math.max(1,Math.ceil(rank/Math.max(1,n)*100));

// ───────────── stat cards ─────────────
export type Change={delta:number;pct:number|null;from:string;good:boolean|null};
export type StatCard={label:string;value:number|null;text:string;unit?:string;format:Format;decimals?:number;currency?:string;year?:string;
 rank:number|null;of:number|null;order:'desc'|'asc';history:Point[];change:Change|null;href:string|null;note?:string};
// The change against the previous period: the latest history point before the card's year, or (without a
// year) the point before the last when the last one is the current value.
export function changeOf(value:number|null,year:string|undefined,history:Point[],order:'desc'|'asc'='desc'):Change|null{
 if(value==null||!history.length)return null;
 let prev:Point|undefined;const yk=year?periodKey(year):null;
 if(yk!=null){for(let i=history.length-1;i>=0;i--){const k=periodKey(history[i].period);if(k!=null&&k<yk){prev=history[i];break;}}}
 else{const last=history[history.length-1];prev=last.value===value?history[history.length-2]:last;}
 if(!prev)return null;
 const delta=value-prev.value;
 return {delta,pct:prev.value!==0?delta/Math.abs(prev.value)*100:null,from:prev.period,good:delta===0?null:order==='asc'?delta<0:delta>0};
}
// History for the sparkline, ending with the current value when its year is not in the history yet.
export function sparkSeries(c:Pick<StatCard,'value'|'year'|'history'>):Point[]{
 const h=c.history;if(c.value==null||!c.year)return h;
 const yk=periodKey(c.year);
 if(yk==null||h.some(p=>periodKey(p.period)===yk))return h;
 return sortByPeriod([...h,{period:c.year,value:c.value}],p=>p.period);
}
export function normalizeStats(raw:unknown):StatCard[]{
 const out:StatCard[]=[];
 for(const it of evList(raw)){
  if(!evIsObj(it))continue;const label=evText(it.label);if(!label)continue;
  const value=parseNumber(it.value);const text=value==null?evText(it.value):'';
  if(value==null&&!text)continue;
  const order=asOrder(it.order),history=normalizePoints(it.history),year=evText(it.year)||undefined;
  const rank=parseNumber(it.rank),of=parseNumber(it.of),d=parseNumber(it.decimals);
  out.push({label,value,text,format:asFormat(it.format),order,history,year,
   rank:rank!=null&&rank>=1?Math.round(rank):null,of:of!=null&&of>=1?Math.round(of):null,
   change:changeOf(value,year,history,order),href:safeHref(it.href),
   ...(evText(it.unit)?{unit:evText(it.unit)}:{}),...(d!=null&&d>=0?{decimals:Math.min(6,Math.round(d))}:{}),
   ...(typeof it.currency==='string'&&/^[A-Za-z]{3}$/.test(it.currency)?{currency:it.currency.toUpperCase()}:{}),
   ...(evText(it.note)?{note:evText(it.note)}:{})});
 }
 return out;
}
// "+3.4%" (relative), "+1.2 pp" for values already in percent, or the signed absolute change.
export function changeText(c:Change,card:Pick<StatCard,'format'|'decimals'|'currency'|'unit'>,locale:string):string{
 const sign=c.delta>0?'+':c.delta<0?'−':'±';
 const nf=(n:number,d=1)=>{try{return new Intl.NumberFormat(locale||'en',{maximumFractionDigits:d}).format(n);}catch{return n.toFixed(d);}};
 if(card.format==='percent')return sign+nf(Math.abs(c.delta),card.decimals??1)+' pp';
 if(c.pct!=null)return sign+nf(Math.abs(c.pct),Math.abs(c.pct)<10?1:0)+'%';
 return sign+makeFormatter(card,[c.delta],locale)(Math.abs(c.delta));
}
// A sparkline: points spread evenly over width w, values over height h (inset by pad).
export function sparkPath(values:number[],w:number,h:number,pad=2):{line:string;area:string;end:[number,number];min:number;max:number}|null{
 if(values.length<2)return null;
 const min=Math.min(...values),max=Math.max(...values),span=max-min;
 const r=(n:number)=>Math.round(n*10)/10;
 const pts=values.map((v,i)=>[r(pad+(w-2*pad)*i/(values.length-1)),r(span?pad+(h-2*pad)*(1-(v-min)/span):h/2)] as [number,number]);
 const line='M'+pts.map(p=>p[0]+','+p[1]).join('L');
 return {line,area:line+'L'+pts[pts.length-1][0]+','+h+'L'+pts[0][0]+','+h+'Z',end:pts[pts.length-1],min,max};
}

// ───────────── peers: position and neighbours ─────────────
export type Peer={name:string;value:number;rank:number;index:number;href:string|null};
// Every peer with a value, ranked (competition ranking: ties share a rank).
export function rankPeers(raw:unknown,order:'desc'|'asc'='desc',valueKey='value'):Peer[]{
 const {ranked}=rankEntries(toEntries(raw,'name'),valueKey,order);
 return ranked.map(e=>({name:e.name,value:e.value!,rank:e.rank!,index:e.index,href:safeHref(e.row.href)}));
}
const evKey=(s:string)=>s.normalize('NFKD').replace(/[̀-ͯ]/g,'').trim().toLowerCase();
export function findPeer<T extends {name:string}>(peers:T[],name:unknown):number{
 const n=evText(name);if(!n)return -1;
 const i=peers.findIndex(p=>p.name===n);if(i>=0)return i;
 const k=evKey(n);return peers.findIndex(p=>evKey(p.name)===k);
}
export type Scale={log:boolean;min:number;max:number};
// Linear, or log10 when asked ('auto': positive values spanning 100× or more, as the ranking map does).
export function scaleOf(values:number[],log:unknown='auto'):Scale{
 const pos=values.length>0&&values.every(v=>v>0);
 if(log===true&&pos){const a=Math.log10(Math.min(...values)),b=Math.log10(Math.max(...values));return {log:true,min:a,max:b>a?b:a+1};}
 if(log==='auto'||log==null){const s=colorScale(values);if(s.log)return s;}
 if(!values.length)return {log:false,min:0,max:1};
 const min=Math.min(...values),max=Math.max(...values);return {log:false,min,max:max>min?max:min+1};
}
export function scaleX(s:Scale,v:number,x0:number,x1:number):number{
 const u=s.log?Math.log10(Math.max(v,1e-300)):v;
 const t=(u-s.min)/(s.max-s.min||1);return x0+(x1-x0)*Math.min(1,Math.max(0,t));
}
// Round tick values for an axis (linear: 1-2-5 steps; log: powers of ten).
export function ticksOf(s:Scale,count=4):number[]{
 if(s.log){const out:number[]=[];for(let e=Math.ceil(s.min);e<=Math.floor(s.max);e++)out.push(10**e);
  if(out.length>count+2){const step=Math.ceil(out.length/(count+1));return out.filter((_,i)=>i%step===0);}return out;}
 const span=s.max-s.min;if(!(span>0))return [s.min];
 const raw=span/count,mag=10**Math.floor(Math.log10(raw)),step=[1,2,2.5,5,10].map(m=>m*mag).find(x=>x>=raw)!;
 const out:number[]=[];for(let v=Math.ceil(s.min/step)*step;v<=s.max+step*1e-9;v+=step)out.push(Math.round(v/step)*step);
 return out;
}
// Beeswarm: y offsets (centred on 0) so circles of radius r at the given x positions do not overlap;
// each circle takes the free spot closest to the axis. Offsets are capped at maxOffset (overlap beyond).
export function beeswarm(xs:number[],r:number,maxOffset=Infinity):number[]{
 const d=2*r,d2=d*d-1e-6,order=xs.map((_,i)=>i).sort((a,b)=>xs[a]-xs[b]||a-b);
 const ys=new Array<number>(xs.length).fill(0);const placed:number[]=[];
 for(const i of order){
  const near:number[]=[];
  for(let k=placed.length-1;k>=0&&near.length<120;k--){const j=placed[k];if(xs[i]-xs[j]>=d)break;near.push(j);}
  const cands=[0];
  for(const j of near){const dx=xs[i]-xs[j],dy=Math.sqrt(Math.max(0,d*d-dx*dx))+1e-6;cands.push(ys[j]+dy,ys[j]-dy);}
  cands.sort((a,b)=>Math.abs(a)-Math.abs(b)||b-a);
  let y=cands.find(c=>near.every(j=>{const dx=xs[i]-xs[j],dy=c-ys[j];return dx*dx+dy*dy>=d2;}))??0;
  if(Math.abs(y)>maxOffset)y=Math.sign(y)*maxOffset;
  ys[i]=y;placed.push(i);
 }
 return ys;
}
// Dot radius for a strip of n peers.
export const dotRadius=(n:number)=>n<=40?6:n<=120?4.5:n<=400?3:n<=1200?2:1.4;
export type PositionSummary={peer:Peer|null;n:number;rank:number|null;percentile:number|null;top:number|null;median:number|null;min:Peer|null;max:Peer|null};
export function positionOf(peers:Peer[],highlight:unknown,order:'desc'|'asc'='desc'):PositionSummary{
 const i=findPeer(peers,highlight);const p=i>=0?peers[i]:null;const vals=peers.map(x=>x.value);
 const byValue=[...peers].sort((a,b)=>a.value-b.value);
 return {peer:p,n:peers.length,rank:p?.rank??null,percentile:p?percentileOf(p.value,vals,order):null,top:p?topPercent(p.rank,peers.length):null,
  median:median(vals),min:byValue[0]??null,max:byValue[byValue.length-1]??null};
}
export type NeighbourRow={kind:'peer';peer:Peer;highlight:boolean}|{kind:'gap';skipped:number};
// The entity with `around` peers on each side by rank, the top `top` above a gap when they are not in that
// window, and a closing gap for the peers below. A gap of one peer shows the peer instead.
export function neighbours(peers:Peer[],index:number,around=4,top=3):NeighbourRow[]{
 const a=Math.max(0,Math.floor(around)),tp=Math.max(0,Math.floor(top));
 const at=index>=0&&index<peers.length?index:-1;
 let lo=at<0?0:Math.max(0,at-a),hi=at<0?Math.min(peers.length,2*a+1):Math.min(peers.length,at+a+1);
 const rows:NeighbourRow[]=[];const head=Math.min(tp,lo);
 if(lo-head<=1)lo=0;
 for(let i=0;i<Math.min(head,lo);i++)rows.push({kind:'peer',peer:peers[i],highlight:i===at});
 if(lo>head)rows.push({kind:'gap',skipped:lo-head});
 if(peers.length-hi===1)hi=peers.length;
 for(let i=lo;i<hi;i++)rows.push({kind:'peer',peer:peers[i],highlight:i===at});
 if(hi<peers.length)rows.push({kind:'gap',skipped:peers.length-hi});
 return rows;
}

// ───────────── radar profile ─────────────
export type RadarEntity={name:string;found:boolean;percentiles:(number|null)[];values:(number|null)[];ranks:(number|null)[]};
export function highlightsOf(raw:unknown,limit=4):string[]{
 const xs=(Array.isArray(raw)?raw:[raw]).map(evText).filter(Boolean);return [...new Set(xs)].slice(0,limit);
}
// Percentiles (100 = best) of each highlighted entity on every criterion, within the peer set `rows`;
// the peer median is 50 by construction. counts: peers with a value per criterion.
export function radarProfile(criteriaRaw:unknown,rows:unknown,highlight:unknown):{criteria:Criterion[];entities:RadarEntity[];counts:number[]}{
 const criteria=normalizeCriteria(criteriaRaw);const entries=toEntries(rows,'name');
 const cols=criteria.map(c=>rankEntries(entries,c.key,c.order).ranked);
 const seen=new Set<string>();
 const entities=highlightsOf(highlight,12).map(name=>{
  const k=evKey(name);const e=entries.find(x=>x.name===name)??entries.find(x=>evKey(x.name)===k);
  const values=criteria.map(c=>e?parseNumber(e.row[c.key]):null);
  return {name:e?.name??name,found:!!e,values,
   percentiles:criteria.map((c,i)=>values[i]==null?null:Math.round(percentileOf(values[i]!,cols[i].map(x=>x.value!),c.order)*10)/10),
   ranks:criteria.map((_,i)=>e?cols[i].find(x=>x.index===e.index)?.rank??null:null)};
 }).filter(x=>!seen.has(x.name)&&!!seen.add(x.name)).slice(0,4);
 return {criteria,entities,counts:cols.map(c=>c.length)};
}
// A radar polygon (server fallback): points at angle i/n from the top, radius ∝ percentile.
export function radarPolygon(pcts:(number|null)[],cx:number,cy:number,r:number):string{
 const n=pcts.length;
 return pcts.map((p,i)=>{const a=-Math.PI/2+2*Math.PI*i/n,rr=r*Math.max(0,Math.min(100,p??0))/100;return (Math.round((cx+rr*Math.cos(a))*10)/10)+','+(Math.round((cy+rr*Math.sin(a))*10)/10);}).join(' ');
}

// ───────────── trend ─────────────
export type Series={label:string;unit?:string;points:Point[]};
export function normalizeSeries(raw:unknown,points?:unknown):Series[]{
 const out:Series[]=[];
 evList(raw).forEach((s,i)=>{if(!evIsObj(s))return;const pts=normalizePoints(s.points??s.data);if(!pts.length)return;
  out.push({label:evText(s.label??s.name)||'Series '+(i+1),points:pts,...(evText(s.unit)?{unit:evText(s.unit)}:{})});});
 if(!out.length&&points!=null){const pts=normalizePoints(points);if(pts.length)out.push({label:'',points:pts});}
 return out;
}
// Every period of every series, in time order (first appearance when some have no year).
export function periodsOf(series:Series[]):string[]{
 const seen=new Set<string>();const all:string[]=[];
 for(const s of series)for(const p of s.points)if(!seen.has(p.period)){seen.add(p.period);all.push(p.period);}
 return sortByPeriod(all,p=>p);
}
export type Annotation={period:string;label:string};
export function normalizeAnnotations(raw:unknown):Annotation[]{
 return evList(raw).flatMap(a=>{if(!evIsObj(a))return [];const period=evText(a.period??a.date??a.year),label=evText(a.label);return period&&label?[{period,label}]:[];});
}
// The trend drawn as plain SVG paths (server fallback): one path per series over the shared periods.
export function trendPaths(series:Series[],w:number,h:number,log=false,pad=6):{periods:string[];scale:Scale;paths:string[]}{
 const periods=periodsOf(series);const at=new Map(periods.map((p,i)=>[p,i]));
 const values=series.flatMap(s=>s.points.map(p=>p.value));
 const scale=scaleOf(values,log?true:false);
 const span=Math.max(1,periods.length-1);
 const y=(v:number)=>h-pad-(scaleX(scale,v,0,h-2*pad));
 const paths=series.map(s=>s.points.map((p,i)=>(i?'L':'M')+(Math.round((pad+(w-2*pad)*at.get(p.period)!/span)*10)/10)+','+(Math.round(y(p.value)*10)/10)).join(''));
 return {periods,scale,paths};
}

// ───────────── relations ─────────────
export type Relation={predicate:string;name:string;href:string|null;type:string|null};
export function normalizeRelations(raw:unknown,limit=80):Relation[]{
 const out:Relation[]=[];const seen=new Set<string>();
 for(const r of evList(raw)){
  if(!evIsObj(r))continue;const predicate=evText(r.predicate??r.relation)||'related',name=evText(r.name??r.object);
  if(!name||seen.has(predicate+'\u0000'+name))continue;seen.add(predicate+'\u0000'+name);
  out.push({predicate,name,href:safeHref(r.href),type:evText(r.type)||null});
  if(out.length>=limit)break;
 }
 return out;
}
export function groupRelations(rels:Relation[]):{predicate:string;items:Relation[]}[]{
 const m=new Map<string,Relation[]>();for(const r of rels){const g=m.get(r.predicate);if(g)g.push(r);else m.set(r.predicate,[r]);}
 return [...m].map(([predicate,items])=>({predicate,items}));
}
export type GraphNode={id:string;name:string;category:number;href:string|null;center:boolean;type:string|null;predicates:string[]};
export type GraphLink={source:string;target:string;predicate:string;category:number};
// One node per related name (a name under several predicates is one node with several links); the
// category (color) is the node's first predicate; the centre is category -1.
export function relationGraph(center:string,rels:Relation[]):{nodes:GraphNode[];links:GraphLink[];categories:string[]}{
 const categories=groupRelations(rels).map(g=>g.predicate);
 const nodes:GraphNode[]=[{id:'\u0000center',name:center,category:-1,href:null,center:true,type:null,predicates:[]}];
 const byName=new Map<string,GraphNode>();const links:GraphLink[]=[];
 for(const r of rels){
  let n=byName.get(r.name);
  if(!n){n={id:'n'+byName.size,name:r.name,category:categories.indexOf(r.predicate),href:r.href,center:false,type:r.type,predicates:[]};byName.set(r.name,n);nodes.push(n);}
  if(!n.href&&r.href)n.href=r.href;n.predicates.push(r.predicate);
  links.push({source:nodes[0].id,target:n.id,predicate:r.predicate,category:categories.indexOf(r.predicate)});
 }
 return {nodes,links,categories};
}

// ───────────── timeline ─────────────
export type TimelineEvent={date:string;label:string;detail?:string;href:string|null;tone?:string;key:number|null};
// events [{date,label,detail?,href?}]; the older items form [{time,title,text,tone}] is read too.
export function normalizeEvents(raw:unknown,order:unknown='asc'):TimelineEvent[]{
 const out:TimelineEvent[]=[];
 for(const e of evList(raw)){
  if(!evIsObj(e))continue;
  const date=evText(e.date??e.time??e.year),label=evText(e.label??e.title);if(!label&&!date)continue;
  const detail=evText(e.detail??e.text),tone=evText(e.tone);
  out.push({date,label:label||date,href:safeHref(e.href),key:periodKey(date),...(detail?{detail}:{}),...(tone?{tone}:{})});
 }
 if(order==='none')return out;
 const sorted=sortByPeriod(out,e=>e.date);
 return order==='desc'&&sorted!==out?[...sorted].reverse():sorted;
}
const EV_MONTHS=/^(-?\d{1,4})-(\d{2})(?:-(\d{2}))?$/;
// "1850-09-09" → "Sep 9, 1850", "1850-09" → "Sep 1850" (in the reader's locale); anything else as written.
export function formatDate(d:string,locale='en'):string{
 const m=EV_MONTHS.exec(d.trim());if(!m)return d;
 const y=Number(m[1]),mo=Number(m[2]),day=m[3]?Number(m[3]):null;
 if(mo<1||mo>12||day!=null&&(day<1||day>31)||y<1)return d;
 const dt=new Date(Date.UTC(2000,mo-1,day??1));dt.setUTCFullYear(y);
 try{return new Intl.DateTimeFormat(locale||'en',day?{year:'numeric',month:'short',day:'numeric',timeZone:'UTC'}:{year:'numeric',month:'short',timeZone:'UTC'}).format(dt);}catch{return d;}
}
// The year an event falls in (for the year markers between events), or null.
export const yearOf=(e:TimelineEvent)=>e.key==null?null:Math.floor(e.key);

// ───────────── location ─────────────
export type RegionKindEv='world'|'us'|'us-counties';
// A region code or name → the map it is drawn on and its key there. regionType forces the reading;
// otherwise a 5-digit FIPS is a county, a U.S. state name/postal code/2-digit FIPS a state, an ISO
// 3166-1 code a country (2-letter codes that are also U.S. postal codes, e.g. CA or IN, read as states).
export function regionOf(region:unknown,regionType?:unknown):{kind:RegionKindEv;key:string}|null{
 const s=typeof region==='number'?String(region):evText(region);if(!s)return null;
 const t=evText(regionType).toLowerCase().replace(/[\s-]+/g,'_');
 const county=()=>{const m=/^(?:US-?)?(\d{4,5})$/i.exec(s);return m?{kind:'us-counties' as const,key:m[1].padStart(5,'0')}:null;};
 const state=()=>{if(/^\d{3,}$/.test(s))return null;const k=usStateKey(s,s);return k?{kind:'us' as const,key:k}:null;};
 const country=()=>{const k=countryKey(s);return k?{kind:'world' as const,key:k}:null;};
 if(t==='country')return country();
 if(t==='us_state'||t==='state')return state();
 if(t==='us_county'||t==='county')return county();
 return county()??state()??country();
}
// Albers USA (as d3.geoAlbersUsa().scale(1300).translate([487.5,305]), the projection of us-atlas's
// *-albers-10m files): lower 48, with Alaska and Hawaii insets. Returns plane coordinates, y down.
function evConic(phi0:number,phi1:number){
 const R=Math.PI/180,s0=Math.sin(phi0*R),n=(s0+Math.sin(phi1*R))/2,c=1+s0*(2*n-s0),r0=Math.sqrt(c)/n;
 return (lon:number,lat:number):[number,number]=>{const r=Math.sqrt(Math.max(0,c-2*n*Math.sin(lat*R)))/n,x=lon*R*n;return [r*Math.sin(x),r0-r*Math.cos(x)];};
}
function evPart(phi0:number,phi1:number,rotate:number,center:[number,number],k:number,t:[number,number]){
 const raw=evConic(phi0,phi1),c=raw(center[0],center[1]);
 return (lon:number,lat:number):[number,number]=>{let l=lon+rotate;l=((l+180)%360+360)%360-180;const p=raw(l,lat);return [t[0]+k*(p[0]-c[0]),t[1]-k*(p[1]-c[1])];};
}
const EV_K=1300,EV_T:[number,number]=[487.5,305];
const evLower48=evPart(29.5,45.5,96,[-0.6,38.7],EV_K,EV_T);
const evAlaska=evPart(55,65,154,[-2,58.5],EV_K*.35,[EV_T[0]-.307*EV_K,EV_T[1]+.201*EV_K]);
const evHawaii=evPart(8,18,157,[-3,19.9],EV_K,[EV_T[0]-.205*EV_K,EV_T[1]+.212*EV_K]);
export function albersUsa(lon:number,lat:number):[number,number]{
 if(lat>=50&&(lon<=-129||lon>=170))return evAlaska(lon,lat);
 if(lat<=24&&lat>=17&&lon<=-150&&lon>=-162)return evHawaii(lon,lat);
 return evLower48(lon,lat);
}
// Bounding box [minX,minY,maxX,maxY] of a Polygon/MultiPolygon, counting only its main parts (polygons
// at least `share` of the largest one's area), so France's box is metropolitan France, not French Guiana.
export function mainBox(geometry:{type:string;coordinates:any}|null|undefined,share=.2):[number,number,number,number]|null{
 if(!geometry)return null;
 const polys:number[][][][]=geometry.type==='Polygon'?[geometry.coordinates]:geometry.type==='MultiPolygon'?geometry.coordinates:[];
 const area=(ring:number[][])=>{let a=0;for(let i=0,j=ring.length-1;i<ring.length;j=i++)a+=(ring[j][0]+ring[i][0])*(ring[j][1]-ring[i][1]);return Math.abs(a/2);};
 const areas=polys.map(p=>p[0]?area(p[0]):0);const big=Math.max(0,...areas);
 let b:[number,number,number,number]|null=null;
 polys.forEach((p,i)=>{if(areas[i]<big*share)return;for(const [x,y] of p[0]??[]){if(!b)b=[x,y,x,y];else{b[0]=Math.min(b[0],x);b[1]=Math.min(b[1],y);b[2]=Math.max(b[2],x);b[3]=Math.max(b[3],y);}}});
 return b;
}
// A box padded by `pad` of its size on each side and widened to at least minSpan.
export function padBox(b:[number,number,number,number],pad:number,minSpan:number):[number,number,number,number]{
 const cx=(b[0]+b[2])/2,cy=(b[1]+b[3])/2;
 const w=Math.max(minSpan,(b[2]-b[0])*(1+2*pad)),h=Math.max(minSpan*.6,(b[3]-b[1])*(1+2*pad));
 return [cx-w/2,cy-h/2,cx+w/2,cy+h/2];
}
export function boxOfPoints(pts:[number,number][]):[number,number,number,number]|null{
 if(!pts.length)return null;
 return [Math.min(...pts.map(p=>p[0])),Math.min(...pts.map(p=>p[1])),Math.max(...pts.map(p=>p[0])),Math.max(...pts.map(p=>p[1]))];
}
export function unionBox(a:[number,number,number,number]|null,b:[number,number,number,number]|null){
 if(!a)return b;if(!b)return a;return [Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[2],b[2]),Math.max(a[3],b[3])] as [number,number,number,number];
}
// "36.78° N, 119.42° W"
export function latLonText(p:[number,number]):string{
 const [lon,lat]=p;const f=(v:number)=>Math.abs(v).toFixed(2);
 return f(lat)+'° '+(lat>=0?'N':'S')+', '+f(lon)+'° '+(lon>=0?'E':'W');
}
export const placeNameKey=evKey;
