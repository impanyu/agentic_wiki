'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {Search,ArrowDownWideNarrow,ArrowUpNarrowWide,ChartColumn,LayoutGrid,ChartPie,Sun,Map as MapIcon,Box,ChartScatter,TrendingUp,ChartNoAxesColumn,SquareSplitVertical,Grid3x3,ChartSpline,ArrowDownUp,Radar,ChartLine,ListOrdered,Play,type LucideIcon} from 'lucide-react';
import type {VizProps} from './types';
import {type Entry,type Summary,normalizeCriteria,toEntries,rankEntries,summarize,makeFormatter,shareOf,groupsOf,linkParts,parseNumber,periodKeyOf,rowPeriods,rankablePeriods,yearsOf,defaultYear,rowsAt,seriesOf,LATEST} from './ranking-data';
import {useAskLink,useRankingView} from '@/app/seo/link-context';
import {geoKind,geoKeyOf,registerGeo,baseRegion,pointOf,geoAspect,type GeoData} from './ranking-geo';
import {useTheme} from '@/app/theme';
import {themeOption} from './chart-theme';
import './viz.css';
import './ranking.css';

type ECharts=typeof import('echarts');
type Chart=ReturnType<ECharts['init']>;
import {PALETTE,MAP_BOTTOM,errMessage,rgba,NEG,columnOption,viewOption,barChartHeight,BAR_WINDOW,autoViews,pickViews,VIEW_LABELS,VIEW_HEIGHT,chartKey,type RankingViewKind} from './ranking-chart';

// Same prebuilt bundle as the echart component, so the page shares one echarts instance.
let echartsP:Promise<ECharts>|null=null;
// @ts-ignore
const loadECharts=()=>echartsP??=import('echarts/dist/echarts.js').then(m=>((m as any).default??m) as ECharts).catch(e=>{echartsP=null;throw e;});
// echarts-gl (3D height map) registers on the same prebuilt echarts instance; loaded only for that view.
let glP:Promise<ECharts>|null=null;
// @ts-ignore echarts-gl ships no types
const loadGL=()=>glP??=loadECharts().then(e=>import('echarts-gl/dist/echarts-gl.js').then(()=>e)).catch(e=>{glP=null;throw e;});

// One ECharts instance in a resizable box; the shimmer shows until the chart has an option.
// With aspect (width/height), the box is never taller than the drawing needs (the world map).
// svg: the same chart rendered on the server, shown until the interactive chart is ready.
function ChartBox({option,height,label,aspect,extra=0,onClick,onChart,svg,gl}:{option:Record<string,unknown>|null;height:number;label:string;aspect?:number;extra?:number;onClick?:(p:any)=>void;onChart?:(c:Chart|null)=>void;svg?:string;gl?:boolean}){
 const box=useRef<HTMLDivElement>(null);const chart=useRef<Chart|null>(null);const outer=useRef<HTMLDivElement>(null);
 const [width,setWidth]=useState(0);
 useEffect(()=>{if(!aspect||!outer.current)return;const el=outer.current;const ro=new ResizeObserver(()=>setWidth(el.clientWidth));ro.observe(el);setWidth(el.clientWidth);return ()=>ro.disconnect();},[aspect]);
 const h=aspect&&width?Math.max(180,Math.min(height,Math.round(width/aspect)+extra)):height;
 const cb=useRef({onClick,onChart});cb.current={onClick,onChart};
 const [ready,setReady]=useState(false);const [error,setError]=useState('');
 const dark=useTheme()==='dark';const themeRef=useRef(dark);
 useEffect(()=>{
  let dead=false,ro:ResizeObserver|null=null;
  (gl?loadGL():loadECharts()).then(echarts=>{
   if(dead||!box.current)return;
   const c=echarts.init(box.current,null,{renderer:'canvas'});chart.current=c;
   c.on('click',(p:any)=>cb.current.onClick?.(p));
   ro=new ResizeObserver(()=>c.resize());ro.observe(box.current);
   cb.current.onChart?.(c);setReady(true);
  }).catch(e=>!dead&&setError(errMessage(e)));
  return ()=>{dead=true;ro?.disconnect();cb.current.onChart?.(null);chart.current?.dispose();chart.current=null;};
 },[]);
 useEffect(()=>{
  const c=chart.current;if(!c||c.isDisposed()||!option)return;
  // A timeline option (baseOption + options per period, the bar race) replaces the chart; others merge.
  // A theme switch redraws from scratch; otherwise a timeline option (the bar race) replaces the chart, others merge.
  const fresh=themeRef.current!==dark;themeRef.current=dark;
  try{c.setOption(themeOption(option,dark) as any,fresh||'baseOption' in option?{notMerge:true}:{replaceMerge:['series','dataZoom','visualMap']});setError('');}catch(e){setError(errMessage(e));}
 },[option,ready,dark]);
 return <div ref={outer} className="wf-rank-chartbox" style={{height:h}}>
  <div ref={box} className="wf-echart-canvas" role="img" aria-label={label}/>
  {(!ready||!option)&&!error&&(svg?<div className="wf-rank-svg" role="img" aria-label={label} dangerouslySetInnerHTML={{__html:svg}}/>:<div className="wf-viz-loading wf-rank-shimmer" aria-busy="true"/>)}
  {error&&<div className="wf-rank-notice" role="alert">{error}</div>}
 </div>;
}

// A small round image (flag, logo) or, without one or when it fails, the initial.
// A medal for the podium: a ribbon and a gold, silver or bronze disc with the place on it (inline SVG, no image).
const MEDAL={1:['#fff3b0','#f4c430','#b8860b','#8a6508'],2:['#ffffff','#d5dae2','#9aa3b2','#6b7484'],3:['#ffd9b3','#d8894b','#a35a22','#7a3f12']} as const;
function Medal({place}:{place:1|2|3}){
 const [hi,mid,lo,edge]=MEDAL[place],id='wf-medal-'+place;
 return <svg className="wf-rank-medal" viewBox="0 0 64 80" aria-hidden="true">
  <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={hi}/><stop offset=".45" stopColor={mid}/><stop offset="1" stopColor={lo}/></linearGradient>
   <linearGradient id={id+'r'} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#3b5bdb"/><stop offset="1" stopColor="#2f4ac0"/></linearGradient></defs>
  <path d="M14 0h14l8 30h-14z" fill={'url(#'+id+'r)'}/><path d="M50 0H36l-8 30h14z" fill="#e03131"/>
  <circle cx="32" cy="50" r="24" fill={edge}/><circle cx="32" cy="50" r="21.5" fill={'url(#'+id+')'}/>
  <circle cx="32" cy="50" r="16.5" fill="none" stroke={edge} strokeOpacity=".35" strokeWidth="1.5"/>
  <text x="32" y="57" textAnchor="middle" fontSize="20" fontWeight="800" fill={edge}>{place}</text>
 </svg>;
}
function Avatar({e,color}:{e:Entry;color:string}){
 const [broken,setBroken]=useState(false);
 return e.image&&!broken?<img className="wf-rank-avatar" src={e.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={()=>setBroken(true)}/>
  :<span className="wf-rank-avatar wf-rank-initial" style={{background:rgba(color,.14),color}}>{Array.from(e.name)[0]?.toUpperCase()}</span>;
}

const PAGE=50,ROW_CAP=1000;
const replaceUrl=(u:URL)=>window.history.replaceState(window.history.state,'',u);
const VIEW_ICONS:Record<RankingViewKind,LucideIcon>={bar:ChartColumn,trend:ChartLine,bump:ListOrdered,race:Play,treemap:LayoutGrid,donut:ChartPie,sunburst:Sun,map:MapIcon,map3d:Box,scatter:ChartScatter,
 lorenz:TrendingUp,distribution:ChartNoAxesColumn,boxplot:SquareSplitVertical,heatmap:Grid3x3,parallel:ChartSpline,slope:ArrowDownUp,radar:Radar};

export default function Ranking({props,setValue,fire,ctx}:VizProps){
 const t=ctx.t,locale=ctx.locale||'en';
 const askLink=useAskLink();
 const criteria=useMemo(()=>normalizeCriteria(props.criteria),[props.criteria]);
 const nameKey=typeof props.nameKey==='string'&&props.nameKey?props.nameKey:'name';
 const groupKey=typeof props.groupKey==='string'&&props.groupKey?props.groupKey:undefined;
 // ?rank=<criterion key> opens the ranking on that criterion (one ranking page per scope;
 // "countries by GDP" and "countries by population" are the same page on different criteria).
 // On the crawlable page the server passes it (view.rank) so the HTML is sorted by it; in the app view
 // it is read after mount, so the server-rendered HTML and the first browser render agree.
 const view=useRankingView();
 // Time: rows in long form (one per entity and period) let the reader rank any period (?year=) or the latest
 // value of each entity; the time views plot every period.
 const periodKey=useMemo(()=>periodKeyOf(props.rows,nameKey,props.periodKey),[props.rows,nameKey,props.periodKey]);
 const allPeriods=useMemo(()=>periodKey?rowPeriods(props.rows,periodKey):[],[props.rows,periodKey]);
 const initial=criteria.find(c=>c.key===view.rank)?.key??criteria.find(c=>c.key===props.default)?.key??criteria[0]?.key??'';
 const [critKey,setCritKey]=useState(initial);
 useEffect(()=>{const fromUrl=new URLSearchParams(location.search).get('rank');if(fromUrl&&criteria.some(c=>c.key===fromUrl))setCritKey(fromUrl);},[criteria]);
 const c=criteria.find(x=>x.key===critKey)??criteria.find(x=>x.key===initial)??criteria[0];
 // One year at a time, judged per criterion: the years this criterion has data for; entities without a value that
 // year are not ranked. The time views still plot every year.
 const periods=useMemo(()=>periodKey&&c?yearsOf(props.rows,{nameKey,periodKey,key:c.key}).years:[],[props.rows,periodKey,nameKey,c]);
 const fallbackYear=useMemo(()=>periodKey&&c?defaultYear(props.rows,{nameKey,periodKey,key:c.key}):null,[props.rows,periodKey,nameKey,c]);
 const initialPeriod=view.period&&periods.includes(view.period)?view.period:typeof props.period==='string'&&periods.includes(props.period)?props.period:fallbackYear??LATEST;
 const [chosen,setPeriod]=useState(initialPeriod);
 useEffect(()=>{const y=new URLSearchParams(location.search).get('year');if(y&&periods.includes(y))setPeriod(y);},[periods]);
 // A year the current criterion has no data for falls back to its default year.
 const period=periodKey?(periods.includes(chosen)?chosen:fallbackYear??LATEST):LATEST;
 const flatRows=useMemo(()=>periodKey?rowsAt(props.rows,{nameKey,periodKey,period,keys:criteria.map(x=>x.key)}):props.rows,[props.rows,periodKey,nameKey,period,criteria]);
 const entries=useMemo(()=>toEntries(flatRows,nameKey,groupKey),[flatRows,nameKey,groupKey]);
 const timeSeries=useMemo(()=>periodKey&&c&&allPeriods.length>1?{periods:[...allPeriods].reverse(),series:seriesOf(props.rows,{nameKey,periodKey,key:c.key})}:null,[periodKey,c,allPeriods,props.rows,nameKey]);
 const choosePeriod=(p:string)=>{setPeriod(p);view.onPeriod?.(p);try{const u=new URL(location.href);if(p===LATEST)u.searchParams.delete('year');else u.searchParams.set('year',p);replaceUrl(u);}catch{}};
 const height=typeof props.height==='number'&&props.height>=200?Math.min(props.height,1200):420;
 const top=typeof props.top==='number'&&props.top>=1?Math.floor(props.top):20;
 const [allBars,setAllBars]=useState(false);
 const [query,setQuery]=useState('');
 const [group,setGroup]=useState<string|null>(null);
 // Soft paging: every listed row is in the page (and its HTML); the reader reveals them PAGE at a time.
 const [page,setPage]=useState(0);
 const [geoError,setGeoError]=useState('');
 const charts=useRef<Record<string,Chart|null>>({});
 const tableWrap=useRef<HTMLDivElement>(null);


 const {ranked,missing}=useMemo(()=>c?rankEntries(entries,c.key,c.order):{ranked:[],missing:[]},[entries,c]);
 const summary:Summary=useMemo(()=>summarize(ranked,missing,c??{format:'number'}),[ranked,missing,c]);
 const values=useMemo(()=>ranked.map(e=>e.value!),[ranked]);
 const fmt=useMemo(()=>c?makeFormatter(c,values,locale):(n:number|null)=>String(n??'—'),[c,values,locale]);
 const axisFmt=useMemo(()=>c?makeFormatter(c,values,locale,{unit:false,compact:true}):fmt,[c,values,locale,fmt]);
 // The podium on a phone: the short form (17.8M people), so the number stays on one line.
 const shortFmt=useMemo(()=>c?makeFormatter(c,values,locale,{compact:true}):fmt,[c,values,locale,fmt]);
 const groups=useMemo(()=>groupsOf(entries),[entries]);
 const colorOf=useMemo(()=>{const m=new Map(groups.map((g,i)=>[g,PALETTE[i%PALETTE.length]]));return (e:Entry)=>e.group&&m.get(e.group)||PALETTE[0];},[groups]);
 const maxAbs=useMemo(()=>values.reduce((m,v)=>Math.max(m,Math.abs(v)),0)||1,[values]);
 const inGroup=(e:Entry)=>!group||e.group===group;
 // Compare: the reader picks which entities the charts show (any number, from the whole ranking); empty = the
 // usual view (top N or the group). Kept in the address (?vs=a|b) so a comparison can be shared.
 const [picked,setPicked]=useState<string[]>(()=>{try{return (new URL(location.href).searchParams.get('vs')||'').split('|').filter(Boolean).slice(0,30);}catch{return [];}});
 const [pickQuery,setPickQuery]=useState('');
 const savePicked=(next:string[])=>{setPicked(next);try{const u=new URL(location.href);if(next.length)u.searchParams.set('vs',next.join('|'));else u.searchParams.delete('vs');history.replaceState(history.state,'',u);}catch{}};
 const addPick=(name:string)=>{const n=name.trim();if(!n||picked.includes(n)||!entries.some(e=>e.name===n))return;savePicked([...picked,n].slice(0,30));setPickQuery('');};
 const chartRanked=useMemo(()=>picked.length?ranked.filter(e=>picked.includes(e.name)):ranked.filter(e=>!group||e.group===group),[ranked,group,picked]);
 const noData=t('No data');
 // Every other criterion is a column too, so all the ranking's figures are in the page (and its HTML).
 const others=useMemo(()=>c?criteria.filter(x=>x.key!==c.key):[],[criteria,c]);
 const otherFmt=useMemo(()=>new Map(others.map(x=>[x.key,makeFormatter(x,entries.map(e=>parseNumber(e.row[x.key])).filter((v):v is number=>v!=null),locale)])),[others,entries,locale]);
 const cols=5+others.length;

 // Views under the leaderboard: the template's list (props.views) or one chosen from the data — bars always,
 // share views (treemap, donut) for quantities that add up, maps for countries or U.S. states, a scatter
 // against a second criterion. One shows at a time (tabs); the first is also rendered on the server.
 // props.geo names the map when the data alone cannot tell ("admin1:JP" for prefectures given by name).
 const geo=useMemo(()=>geoKind(entries,props.geo),[entries,props.geo]);
 const [geoDataRaw,setGeoData]=useState<GeoData|null>(null);
 const geoData=geo&&geoDataRaw?.kind===baseRegion(geo)?geoDataRaw:null;
 const keyOf=useMemo(()=>geo?geoKeyOf(geo,geoData):()=>null,[geo,geoData]);
 const additive=summary.aggregate==='sum'&&summary.min>=0&&ranked.length>1;
 const views=useMemo<RankingViewKind[]>(()=>{
  if(props.chart==='none')return [];
  const v=pickViews(props.views,autoViews({additive,geo,criteria:criteria.length,groups:groups.length,count:ranked.length,periods:periods.length}));
  return props.chart==='map'&&v.includes('map')?['map',...v.filter(x=>x!=='map')]:v;
 },[props.chart,props.views,additive,geo,criteria.length,groups.length,ranked.length,periods.length]);
 const [viewKind,setViewKind]=useState<RankingViewKind|null>(null);
 const active:RankingViewKind=viewKind&&views.includes(viewKind)?viewKind:views[0]??'bar';
 const mapView=active==='map'||active==='map3d';
 useEffect(()=>{
  if(!geo||!mapView)return;let dead=false;
  (active==='map3d'?loadGL():loadECharts()).then(e=>registerGeo(e,geo)).then(g=>!dead&&setGeoData(g)).catch(e=>!dead&&setGeoError(errMessage(e)));
  return ()=>{dead=true;};
 },[geo,mapView,active]);
 const [yKey,setYKey]=useState('');
 const yC=others.find(x=>x.key===yKey)??others[0];

 const pick=(e:Entry|undefined)=>{if(e)fire('select',e.row);};
 const choose=(key:string)=>{if(key===critKey)return;setCritKey(key);setValue(key);fire('change',key);view.onRank?.(key);try{const u=new URL(location.href);u.searchParams.set('rank',key);history.replaceState(history.state,'',u);}catch{}};

 // Bar chart: the top N, or every entity with a scroll window.
 const barShown=allBars||picked.length?chartRanked:chartRanked.slice(0,top);
 const windowSize=Math.max(8,Math.floor((height-24)/28));
 const barHeight=barChartHeight(allBars?BAR_WINDOW:barShown.length);
 const columnWindow=30;
 // One shared builder for every view (the server uses it too, for the SVG of the first view).
 const opt=useMemo(()=>c?viewOption({view:active,c,criteria,entries,ranked:chartRanked,missing,history:timeSeries,fmt,axisFmt,locale,top,allBars,window:columnWindow,other:yC,
  geo:geo&&geoData?{kind:geo,map:geoData.name,names:geoData.names,keyOf,pointOf:e=>pointOf(e.row),aspectScale:geoData.aspectScale}:null,
  labels:{others:t('Others'),noData,topHold:(k,pct)=>t('Top {k} hold {pct}',{k,pct}),entities:t('Entities by rank'),count:t('count'),median:t('Median')}}):null,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [active,c,criteria,chartRanked,missing,entries,timeSeries,allBars,top,fmt,axisFmt,geo,geoData,keyOf,yC,locale,noData]);
 const byKey=useMemo(()=>{const m=new Map<string,Entry>();for(const e of ranked){const k=keyOf(e);if(k&&!m.has(k))m.set(k,e);}return m;},[ranked,keyOf]);
 const hover=(e:Entry|null,on:boolean)=>{
  if(!e||e.value==null)return;const type=on?'highlight':'downplay';const ch=charts.current[active];
  if(!ch||ch.isDisposed())return;
  if(active==='bar'){const i=barShown.indexOf(e);if(i>=0)ch.dispatchAction({type,seriesIndex:0,dataIndex:i});}
  else if(active==='map'){const k=keyOf(e);if(k)ch.dispatchAction({type,seriesIndex:0,name:k});}
  else if(active==='treemap'||active==='donut'||active==='scatter')ch.dispatchAction({type,seriesIndex:0,name:e.name});
 };

 // Table: every entity; search and group filters keep the overall ranks.
 const q=query.trim().toLowerCase();
 // A new criterion or filter starts the list from the top.
 useEffect(()=>{setPage(0);},[critKey,group,q,period]);
 const match=(e:Entry)=>inGroup(e)&&(!q||e.name.toLowerCase().includes(q));
 const tRanked=ranked.filter(match),tMissing=missing.filter(match);
 // A ranking stops at ROW_CAP: the top 1,000 on the criterion in view, in pages of PAGE (50). Every row is in the
 // HTML (search engines read the whole ranking); only the current page is visible.
 const cap=ROW_CAP;
 const showRanked=tRanked.filter(e=>e.rank!=null&&e.rank<=cap).slice(0,cap),showMissing:typeof tMissing=[];// entities without data on this criterion are not ranked and not listed
 const listed=showRanked.length+showMissing.length,total=tRanked.length;
 const pages=Math.max(1,Math.ceil(listed/PAGE)),pg=Math.min(page,pages-1),from=pg*PAGE,to=Math.min(listed,from+PAGE);
 const goPage=(n:number)=>{setPage(Math.max(0,Math.min(pages-1,n)));tableWrap.current?.scrollIntoView({block:'start',behavior:'smooth'});};
 // Page numbers: the first, the last, and two on each side of the current one.
 const pageList=(()=>{const out:(number|'…')[]=[];for(let i=0;i<pages;i++){if(i===0||i===pages-1||Math.abs(i-pg)<=2)out.push(i);else if(out[out.length-1]!=='…')out.push('…');}return out;})();

 if(!c)return <figure className="wf-viz wf-rank"><div className="wf-rank-empty">{t('No criteria to rank by.')}</div></figure>;
 const title=typeof props.title==='string'?props.title:'',subtitle=typeof props.subtitle==='string'?props.subtitle:'',source=typeof props.source==='string'?props.source:'';
 const pills=criteria.length<=4;
 const groupColor=(g:string)=>PALETTE[groups.indexOf(g)%PALETTE.length];
 // The podium: the first three on the criterion in view (distinct ranks; ties leave it out).
 const podium=(()=>{const p=ranked.filter(e=>e.value!=null&&e.rank!=null&&e.rank<=3).slice(0,3);return p.length===3&&new Set(p.map(e=>e.rank)).size===3?p:[];})();

 const row=(e:Entry,i:number)=>{
  const share=shareOf(e,summary,locale);const medal=e.rank!=null&&e.rank<=3?e.rank:0;
  return <tr key={e.index} hidden={i<from||i>=to} className={(e.rank==null?'wf-rank-nodata ':'')+(medal?'wf-rank-top':'')} style={{['--d' as any]:Math.min(i,24)*18+'ms'}}
   onClick={()=>pick(e)} onMouseEnter={()=>hover(e,true)} onMouseLeave={()=>hover(e,false)}>
   <td className="wf-rank-pos">{e.rank==null?<span className="wf-rank-dash">—</span>:<span className={'wf-rank-badge'+(medal?' m'+medal:'')}>{e.rank}</span>}</td>
   <td className="wf-rank-name">
    <div className="wf-rank-entity">
     <Avatar e={e} color={colorOf(e)}/>
     {(()=>{const l=askLink(e.question);return l.href?<a href={l.href} rel={l.rel} onClick={ev=>ev.stopPropagation()}>{e.name}</a>:<span>{e.name}</span>;})()}
     {e.group&&<span className="wf-rank-chip" style={{['--c' as any]:colorOf(e)}}>{e.group}</span>}
    </div>
   </td>
   <td className="wf-rank-val">{e.value==null?<span className="wf-rank-dash">{noData}</span>:fmt(e.value)}</td>
   <td className="wf-rank-barcell" aria-hidden="true">{e.value!=null&&<span className="wf-rank-track"><i style={{width:Math.max(1.5,Math.abs(e.value)/maxAbs*100)+'%',background:e.value<0?`linear-gradient(90deg,${rgba(NEG,.45)},${NEG})`:`linear-gradient(90deg,${rgba(colorOf(e),.45)},${colorOf(e)})`}}/></span>}</td>
   <td className="wf-rank-share">{share?share.kind==='share'?share.text:t('Top {pct}',{pct:share.text}):''}</td>
   {others.map(x=>{const v=parseNumber(e.row[x.key]);return <td key={x.key} className="wf-rank-other">{v==null?'—':otherFmt.get(x.key)!(v)}</td>;})}
  </tr>;
 };

 return <figure className="wf-viz wf-rank">
  <header className="wf-rank-head">
   <div className="wf-rank-titles">
    {title&&<h3 className="wf-rank-title">{title}</h3>}
    {subtitle&&<p className="wf-rank-subtitle">{subtitle}</p>}
   </div>
   <div className="wf-rank-picker">
    {periods.length>1&&<label className="wf-rank-select wf-rank-period"><span>{t('Year')}</span><select value={period} onChange={ev=>choosePeriod(ev.target.value)}>
     {periods.map(p=><option key={p} value={p}>{p}</option>)}</select></label>}
    {criteria.length>1&&(pills
     ?<div className="wf-rank-pills" role="radiogroup" aria-label={t('Rank by')}>{criteria.map(x=><button key={x.key} type="button" role="radio" aria-checked={x.key===c.key} className={x.key===c.key?'on':''} onClick={()=>choose(x.key)}>{x.label}</button>)}</div>
     :<label className="wf-rank-select"><span>{t('Rank by')}</span><select value={c.key} onChange={ev=>choose(ev.target.value)}>{criteria.map(x=><option key={x.key} value={x.key}>{x.label}</option>)}</select></label>)}
   </div>
  </header>
  <div className="wf-rank-meta">
   <span className="wf-rank-crit">{c.label}{c.unit&&c.format!=='percent'&&c.format!=='currency'?<span className="wf-rank-unit"> · {c.unit}</span>:null}{period!==LATEST?<span className="wf-rank-unit"> · {period}</span>:c.year?<span className="wf-rank-unit"> · {c.year}</span>:null}</span>
   <span className="wf-rank-order">{c.order==='asc'?<ArrowUpNarrowWide size={13}/>:<ArrowDownWideNarrow size={13}/>}{c.order==='asc'?t('Lowest ranks first'):t('Highest ranks first')}</span>
   {c.description&&<span className="wf-rank-desc">{c.description}</span>}
  </div>

  {podium.length===3&&<ol className="wf-rank-podium" aria-label={t('Top 3')}>{podium.map(e=>{const share=shareOf(e,summary,locale);const l=askLink(e.question);return <li key={e.index} className={'p'+e.rank} onClick={()=>pick(e)}>
   <Medal place={e.rank as 1|2|3}/>
   <Avatar e={e} color={colorOf(e)}/>
   <span className="wf-rank-podium-name">{l.href?<a href={l.href} rel={l.rel} onClick={ev=>ev.stopPropagation()}>{e.name}</a>:e.name}</span>
   <span className="wf-rank-podium-val"><span className="full">{fmt(e.value!)}</span><span className="short">{shortFmt(e.value!)}</span></span>
   {share&&<span className="wf-rank-podium-share">{share.kind==='share'?share.text:t('Top {pct}',{pct:share.text})}</span>}
  </li>;})}</ol>}

  <div className="wf-rank-tools">
   <label className="wf-rank-search"><Search size={14}/><input type="search" value={query} placeholder={t('Search…')} aria-label={t('Search entities')} onChange={ev=>setQuery(ev.target.value)}/></label>
   <span className="wf-rank-count">{(q||group)?t('{count} matching',{count:tRanked.length.toLocaleString(locale)})+' · ':''}{t('{ranked} ranked',{ranked:summary.ranked.toLocaleString(locale)})}</span>
  </div>

  <div ref={tableWrap} className="wf-rank-tablewrap">
   <table className="wf-rank-table">
    <thead><tr>
     <th className="wf-rank-pos">{t('Rank')}</th><th className="wf-rank-name">{t('Name')}</th>
     <th className="wf-rank-val">{c.label}</th><th className="wf-rank-barcell" aria-hidden="true"/>
     <th className="wf-rank-share">{summary.aggregate==='sum'&&summary.min>=0?t('Share'):t('Percentile')}</th>
     {others.map(x=><th key={x.key} className="wf-rank-other" title={t('Rank by')+' '+x.label}>{view.rankHref
      ?<a href={view.rankHref(x.key)} onClick={ev=>{ev.preventDefault();choose(x.key);}}>{x.label}</a>
      :<button type="button" onClick={()=>choose(x.key)}>{x.label}</button>}</th>)}
    </tr></thead>
    <tbody key={c.key+'|'+(group??'')}>
     {showRanked.map(row)}
     {showMissing.length>0&&<tr className="wf-rank-sep"><td colSpan={cols}>{noData} · {tMissing.length.toLocaleString(locale)}</td></tr>}
     {showMissing.map((e,i)=>row(e,showRanked.length+i))}
     {!showRanked.length&&!showMissing.length&&<tr className="wf-rank-sep"><td colSpan={cols}>{t('No matches')}</td></tr>}
    </tbody>
   </table>
  </div>
  {(pages>1||total>listed)&&<nav className="wf-rank-pager" aria-label={t('Pages')}>
   {pages>1&&<>
    <span className="wf-rank-range">{t('{from}–{to} of {count}',{from:(from+1).toLocaleString(locale),to:to.toLocaleString(locale),count:listed.toLocaleString(locale)})}</span>
    <button type="button" disabled={pg===0} onClick={()=>goPage(pg-1)} aria-label={t('Previous page')}>‹</button>
    {pageList.map((n,k)=>n==='…'?<span key={'e'+k} className="wf-rank-gap">…</span>:<button key={n} type="button" className={n===pg?'on':''} aria-current={n===pg?'page':undefined} onClick={()=>goPage(n)}>{(n+1).toLocaleString(locale)}</button>)}
    <button type="button" disabled={pg>=pages-1} onClick={()=>goPage(pg+1)} aria-label={t('Next page')}>›</button>
   </>}
   {total>listed&&<span className="wf-rank-capnote">{t('Rankings list the top {n}.',{n:cap.toLocaleString(locale)})}</span>}
  </nav>}
  {views.length>0&&<div className={'wf-rank-chart '+active}>
   <div className="wf-rank-charttools">
    {views.length>1?<div className="wf-rank-viewbar"><span className="wf-rank-viewlabel">{t('Charts')}</span><div className="wf-rank-views" role="tablist" aria-label={t('Charts')}>{views.map(v=>{const Icon=VIEW_ICONS[v];return <button key={v} type="button" role="tab" aria-selected={v===active} className={v===active?'on':''} onClick={()=>setViewKind(v)}><Icon size={15} aria-hidden="true"/>{t(VIEW_LABELS[v])}</button>;})}</div></div>
     :<span className="wf-rank-charttitle">{c.label}{c.year?' · '+c.year:''}</span>}
    {active==='bar'&&!picked.length&&chartRanked.length>top&&<div className="wf-rank-seg" role="radiogroup" aria-label={t('Bars shown')}>
     <button type="button" role="radio" aria-checked={!allBars} className={!allBars?'on':''} onClick={()=>setAllBars(false)}>{t('Top {n}',{n:top})}</button>
     <button type="button" role="radio" aria-checked={allBars} className={allBars?'on':''} onClick={()=>setAllBars(true)}>{t('All {n}',{n:chartRanked.length})}</button>
    </div>}
    {(active==='scatter'||active==='slope')&&yC&&<label className="wf-rank-select wf-rank-vs"><span>{c.label} {t('vs')}</span><select value={yC.key} onChange={ev=>setYKey(ev.target.value)}>{others.map(x=><option key={x.key} value={x.key}>{x.label}</option>)}</select></label>}
   </div>
   <div className="wf-rank-compare" role="group" aria-label={t('Compare')}>
    <span className="wf-rank-viewlabel">{t('Compare')}</span>
    {picked.map(n=><span key={n} className="wf-rank-chip">{n}<button type="button" aria-label={t('Remove {name}',{name:n})} onClick={()=>savePicked(picked.filter(x=>x!==n))}>×</button></span>)}
    <input list={'wf-rank-names-'+critKey} value={pickQuery} placeholder={picked.length?t('Add another'):t('Choose entities to compare')}
     onChange={ev=>{const v=ev.target.value;setPickQuery(v);if(entries.some(e=>e.name===v))addPick(v);}}
     onKeyDown={ev=>{if(ev.key==='Enter'){ev.preventDefault();const v=pickQuery.trim().toLowerCase();const hit=entries.find(e=>e.name.toLowerCase()===v)??entries.find(e=>e.name.toLowerCase().startsWith(v));if(hit)addPick(hit.name);}}}/>
    <datalist id={'wf-rank-names-'+critKey}>{entries.filter(e=>!picked.includes(e.name)).slice(0,2000).map(e=><option key={e.name} value={e.name}/>)}</datalist>
    {picked.length>0&&<button type="button" className="wf-rank-clear" onClick={()=>savePicked([])}>{t('Clear')}</button>}
   </div>
   {views.length>1&&<div className="wf-rank-charttitle wf-rank-charttitle-sub">{active==='scatter'&&yC?c.label+' × '+yC.label:active==='slope'&&yC?c.label+' → '+yC.label:active==='heatmap'||active==='parallel'||active==='radar'?t('All criteria'):c.label}{c.year?' · '+c.year:''}</div>}
   {mapView&&geoError?<div className="wf-rank-notice">{t('The map could not load.')}</div>
    :active==='bar'&&!barShown.length?<div className="wf-rank-empty">{noData}</div>
    :<ChartBox key={active} gl={active==='map3d'} option={opt} label={c.label}
      height={active==='bar'?barHeight:active==='map'?height:VIEW_HEIGHT[active]??height}
      {...(active==='map'&&geo?{aspect:geoAspect(geo,geoData),extra:MAP_BOTTOM+6}:{})}
      svg={!allBars&&!group&&!picked.length&&active===views[0]?view.charts?.[chartKey(criteria.map(x=>x.key),c.key)+'|'+active]:undefined}
      onClick={p=>pick(active==='bar'?barShown[p.dataIndex]:mapView?byKey.get(p.name):chartRanked.find(e=>e.name===p.name))}
      onChart={ch=>{charts.current[active]=ch;}}/>}
  </div>}

  {source&&<figcaption className="wf-rank-source">{t('Source:')} {linkParts(source).map((p,i)=>p.href?<a key={i} href={p.href} target="_blank" rel="noopener noreferrer">{p.text}</a>:<span key={i}>{p.text}</span>)}</figcaption>}
 </figure>;
}
