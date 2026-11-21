'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {Search,ArrowDownWideNarrow,ArrowUpNarrowWide} from 'lucide-react';
import type {VizProps} from './types';
import {type Criterion,type Entry,type Summary,normalizeCriteria,toEntries,rankEntries,summarize,makeFormatter,shareOf,chartMode,colorScale,groupsOf,equalEarth,equalEarthInvert,escapeHtml,linkParts,fixAntimeridian,parseNumber} from './ranking-data';
import {useAskLink,useRankingView} from '@/app/seo/link-context';
import {countryKey} from './world-codes';
import './viz.css';
import './ranking.css';

type ECharts=typeof import('echarts');
type Chart=ReturnType<ECharts['init']>;
import {FONT,PALETTE,MAP_COLORS,MAP_BOTTOM,MAP_ASPECT,MEDAL,errMessage,rgba,gradient,NEG,clip,tooltipHtml,TOOLTIP,barOption,columnOption,chartKey,type Fmt} from './ranking-chart';

// Same prebuilt bundle as the echart component, so the page shares one echarts instance.
let echartsP:Promise<ECharts>|null=null;
// @ts-ignore
const loadECharts=()=>echartsP??=import('echarts/dist/echarts.js').then(m=>((m as any).default??m) as ECharts).catch(e=>{echartsP=null;throw e;});
// World geometry (world-atlas 110m, ~100 KB) loads only when a ranking draws a map.
const MAP='wiki-rank-world';
let worldP:Promise<Map<string,string>>|null=null;
const loadWorld=()=>worldP??=Promise.all([
 loadECharts(),
 // @ts-ignore topojson-client ships no types
 import('topojson-client'),
 import('world-atlas/countries-110m.json'),
]).then(([echarts,topo,atlasModule])=>{
 const atlas=(atlasModule as any).default??atlasModule;
 const fc=(topo as any).feature(atlas,atlas.objects.countries);
 const names=new Map<string,string>();
 fc.features=fc.features.filter((f:any)=>f.id!=='010').map((f:any)=>{
  const label=String(f.properties?.name??'');
  const key=f.id?String(f.id):label==='Kosovo'?'XKX':'x-'+label;names.set(key,label);
  return {...f,geometry:f.geometry&&fixAntimeridian(f.geometry),properties:{name:key}};
 });
 echarts.registerMap(MAP,fc);
 return names;
}).catch(e=>{worldP=null;throw e;});

function mapOption(o:{ranked:Entry[];c:Criterion;fmt:Fmt;names:Map<string,string>;noData:string}){
 const {c,fmt}=o;const seen=new Set<string>();const data:any[]=[];
 const scale=colorScale(o.ranked.map(e=>e.value!));
 for(const e of o.ranked){const k=countryKey(e.code);if(!k||seen.has(k))continue;seen.add(k);data.push({name:k,value:scale.log?Math.log10(e.value!):e.value,entry:e});}
 const real=(v:number)=>scale.log?10**v:v;
 return {
  textStyle:{fontFamily:FONT},animationDurationUpdate:700,animationEasingUpdate:'cubicInOut',aria:{enabled:true},
  tooltip:{...TOOLTIP,formatter:(p:any)=>{const e:Entry|undefined=p.data?.entry;if(e)return tooltipHtml(e,c,fmt,o.noData);
   return `<div style="font-family:${FONT}"><div style="font-weight:600;color:#0f172a">${escapeHtml(o.names.get(p.name)??p.name)}</div><div style="color:#94a3b8;font-size:11px;margin-top:2px">${escapeHtml(o.noData)}</div></div>`;}},
  visualMap:[{type:'continuous',min:scale.min,max:scale.max,orient:'horizontal',left:8,bottom:4,itemWidth:10,itemHeight:160,calculable:true,realtime:true,
textStyle:{color:'#64748b',fontSize:11},formatter:(v:number)=>fmt(real(v)),
   inRange:{color:c.order==='asc'?[...MAP_COLORS].reverse():MAP_COLORS},handleStyle:{borderColor:'#fff',shadowBlur:4,shadowColor:'rgba(15,23,42,.2)'},indicatorStyle:{borderColor:'#fff'}}],
  series:[{id:'world',type:'map',map:MAP,roam:true,projection:{project:equalEarth,unproject:equalEarthInvert},scaleLimit:{min:1,max:12},
   left:'center',top:6,bottom:MAP_BOTTOM,selectedMode:false,
   label:{show:false},itemStyle:{areaColor:'#eceff5',borderColor:'#fff',borderWidth:.6},
   emphasis:{label:{show:false},itemStyle:{areaColor:'#ff8a4c',borderColor:'#fff',borderWidth:1,shadowBlur:12,shadowColor:'rgba(15,23,42,.25)'}},
   data}],
 };
}

// One ECharts instance in a resizable box; the shimmer shows until the chart has an option.
// With aspect (width/height), the box is never taller than the drawing needs (the world map).
// svg: the same chart rendered on the server, shown until the interactive chart is ready.
function ChartBox({option,height,label,aspect,extra=0,onClick,onChart,svg}:{option:Record<string,unknown>|null;height:number;label:string;aspect?:number;extra?:number;onClick?:(p:any)=>void;onChart?:(c:Chart|null)=>void;svg?:string}){
 const box=useRef<HTMLDivElement>(null);const chart=useRef<Chart|null>(null);const outer=useRef<HTMLDivElement>(null);
 const [width,setWidth]=useState(0);
 useEffect(()=>{if(!aspect||!outer.current)return;const el=outer.current;const ro=new ResizeObserver(()=>setWidth(el.clientWidth));ro.observe(el);setWidth(el.clientWidth);return ()=>ro.disconnect();},[aspect]);
 const h=aspect&&width?Math.max(180,Math.min(height,Math.round(width/aspect)+extra)):height;
 const cb=useRef({onClick,onChart});cb.current={onClick,onChart};
 const [ready,setReady]=useState(false);const [error,setError]=useState('');
 useEffect(()=>{
  let dead=false,ro:ResizeObserver|null=null;
  loadECharts().then(echarts=>{
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
  try{c.setOption(option as any,{replaceMerge:['series','dataZoom','visualMap']});setError('');}catch(e){setError(errMessage(e));}
 },[option,ready]);
 return <div ref={outer} className="wf-rank-chartbox" style={{height:h}}>
  <div ref={box} className="wf-echart-canvas" role="img" aria-label={label}/>
  {(!ready||!option)&&!error&&(svg?<div className="wf-rank-svg" role="img" aria-label={label} dangerouslySetInnerHTML={{__html:svg}}/>:<div className="wf-viz-loading wf-rank-shimmer" aria-busy="true"/>)}
  {error&&<div className="wf-rank-notice" role="alert">{error}</div>}
 </div>;
}

// A small round image (flag, logo) or, without one or when it fails, the initial.
function Avatar({e,color}:{e:Entry;color:string}){
 const [broken,setBroken]=useState(false);
 return e.image&&!broken?<img className="wf-rank-avatar" src={e.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={()=>setBroken(true)}/>
  :<span className="wf-rank-avatar wf-rank-initial" style={{background:rgba(color,.14),color}}>{Array.from(e.name)[0]?.toUpperCase()}</span>;
}

const PAGE=50,ROW_CAP=1000;

export default function Ranking({props,setValue,fire,ctx}:VizProps){
 const t=ctx.t,locale=ctx.locale||'en';
 const askLink=useAskLink();
 const criteria=useMemo(()=>normalizeCriteria(props.criteria),[props.criteria]);
 const nameKey=typeof props.nameKey==='string'&&props.nameKey?props.nameKey:'name';
 const groupKey=typeof props.groupKey==='string'&&props.groupKey?props.groupKey:undefined;
 const entries=useMemo(()=>toEntries(props.rows,nameKey,groupKey),[props.rows,nameKey,groupKey]);
 // ?rank=<criterion key> opens the ranking on that criterion (one ranking page per scope;
 // "countries by GDP" and "countries by population" are the same page on different criteria).
 // On the crawlable page the server passes it (view.rank) so the HTML is sorted by it; in the app view
 // it is read after mount, so the server-rendered HTML and the first browser render agree.
 const view=useRankingView();
 const initial=criteria.find(c=>c.key===view.rank)?.key??criteria.find(c=>c.key===props.default)?.key??criteria[0]?.key??'';
 const [critKey,setCritKey]=useState(initial);
 useEffect(()=>{const fromUrl=new URLSearchParams(location.search).get('rank');if(fromUrl&&criteria.some(c=>c.key===fromUrl))setCritKey(fromUrl);},[criteria]);
 const c=criteria.find(x=>x.key===critKey)??criteria.find(x=>x.key===initial)??criteria[0];
 const height=typeof props.height==='number'&&props.height>=200?Math.min(props.height,1200):420;
 const top=typeof props.top==='number'&&props.top>=1?Math.floor(props.top):20;
 const [allBars,setAllBars]=useState(false);
 const [query,setQuery]=useState('');
 const [group,setGroup]=useState<string|null>(null);
 const [expanded,setExpanded]=useState(false);
 const [names,setNames]=useState<Map<string,string>|null>(null);
 const [mapError,setMapError]=useState('');
 const charts=useRef<Record<string,Chart|null>>({});
 const tableWrap=useRef<HTMLDivElement>(null);

 // One plot under the leaderboard: vertical bars of the current criterion; a world map only when asked for.
 const requested=props.chart==='none'?'none':props.chart==='map'&&chartMode('map',entries)==='map'?'map':'column';
 const mode=requested==='map'&&mapError?'column':requested;
 useEffect(()=>{
  if(requested!=='map')return;let dead=false;
  loadWorld().then(n=>!dead&&setNames(n)).catch(e=>!dead&&setMapError(errMessage(e)));
  return ()=>{dead=true;};
 },[requested]);

 const {ranked,missing}=useMemo(()=>c?rankEntries(entries,c.key,c.order):{ranked:[],missing:[]},[entries,c]);
 const summary:Summary=useMemo(()=>summarize(ranked,missing,c??{format:'number'}),[ranked,missing,c]);
 const values=useMemo(()=>ranked.map(e=>e.value!),[ranked]);
 const fmt=useMemo(()=>c?makeFormatter(c,values,locale):(n:number|null)=>String(n??'—'),[c,values,locale]);
 const axisFmt=useMemo(()=>c?makeFormatter(c,values,locale,{unit:false,compact:true}):fmt,[c,values,locale,fmt]);
 const groups=useMemo(()=>groupsOf(entries),[entries]);
 const colorOf=useMemo(()=>{const m=new Map(groups.map((g,i)=>[g,PALETTE[i%PALETTE.length]]));return (e:Entry)=>e.group&&m.get(e.group)||PALETTE[0];},[groups]);
 const maxAbs=useMemo(()=>values.reduce((m,v)=>Math.max(m,Math.abs(v)),0)||1,[values]);
 const inGroup=(e:Entry)=>!group||e.group===group;
 const chartRanked=useMemo(()=>ranked.filter(e=>!group||e.group===group),[ranked,group]);
 const noData=t('No data');
 // Every other criterion is a column too, so all the ranking's figures are in the page (and its HTML).
 const others=useMemo(()=>c?criteria.filter(x=>x.key!==c.key):[],[criteria,c]);
 const otherFmt=useMemo(()=>new Map(others.map(x=>[x.key,makeFormatter(x,entries.map(e=>parseNumber(e.row[x.key])).filter((v):v is number=>v!=null),locale)])),[others,entries,locale]);
 const cols=5+others.length;

 const pick=(e:Entry|undefined)=>{if(e)fire('select',e.row);};
 const choose=(key:string)=>{if(key===critKey)return;setCritKey(key);setValue(key);fire('change',key);view.onRank?.(key);try{const u=new URL(location.href);u.searchParams.set('rank',key);history.replaceState(history.state,'',u);}catch{}};

 // Bar chart: the top N, or every entity with a scroll window.
 const barShown=allBars?chartRanked:chartRanked.slice(0,top);
 const windowSize=Math.max(8,Math.floor((height-24)/28));
 const barHeight=Math.min(height,380);
 const columnWindow=30;
 const barOpt=useMemo(()=>c&&mode==='column'&&barShown.length?columnOption({shown:barShown,c,fmt,axisFmt,window:allBars?columnWindow:undefined,noData}):null,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [c,mode,chartRanked,allBars,top,fmt,axisFmt,colorOf,windowSize,noData]);
 const mapOpt=useMemo(()=>c&&mode==='map'&&names?mapOption({ranked,c,fmt,names,noData}):null,[c,mode,names,ranked,fmt,noData]);
 const miniShown=chartRanked.slice(0,10);
 const miniOpt=useMemo(()=>c&&mode==='map'&&miniShown.length?barOption({shown:miniShown,c,fmt,axisFmt,colorOf,compact:true,noData}):null,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [c,mode,chartRanked,fmt,axisFmt,colorOf,noData]);

  const byKey=useMemo(()=>{const m=new Map<string,Entry>();for(const e of ranked){const k=countryKey(e.code);if(k&&!m.has(k))m.set(k,e);}return m;},[ranked]);
 const hover=(e:Entry|null,on:boolean)=>{
  if(!e||e.value==null)return;const k=countryKey(e.code);const type=on?'highlight':'downplay';
  for(const [id,ch] of Object.entries(charts.current)){
   if(!ch||ch.isDisposed())continue;
   if(id==='map'){if(k)ch.dispatchAction({type,seriesIndex:0,name:k});continue;}
   const i=(id==='bar'?barShown:miniShown).indexOf(e);if(i>=0)ch.dispatchAction({type,seriesIndex:0,dataIndex:i});
  }
 };

 // Table: every entity; search and group filters keep the overall ranks.
 const q=query.trim().toLowerCase();
 // A new criterion or filter starts the list from the top.
 useEffect(()=>{if(tableWrap.current)tableWrap.current.scrollTop=0;},[critKey,group,q]);
 const match=(e:Entry)=>inGroup(e)&&(!q||e.name.toLowerCase().includes(q));
 const tRanked=ranked.filter(match),tMissing=missing.filter(match);
 // The first PAGE rows show; up to ROW_CAP more are in the page but hidden until "Show all".
 const limit=expanded?Infinity:PAGE,cap=expanded?Infinity:ROW_CAP;
 const showRanked=tRanked.slice(0,cap),showMissing=tMissing.slice(0,Math.max(0,cap-showRanked.length));
 const hidden=Math.max(0,tRanked.length+tMissing.length-limit);

 if(!c)return <figure className="wf-viz wf-rank"><div className="wf-rank-empty">{t('No criteria to rank by.')}</div></figure>;
 const title=typeof props.title==='string'?props.title:'',subtitle=typeof props.subtitle==='string'?props.subtitle:'',source=typeof props.source==='string'?props.source:'';
 const pills=criteria.length<=4;
 const groupColor=(g:string)=>PALETTE[groups.indexOf(g)%PALETTE.length];

 const row=(e:Entry,i:number)=>{
  const share=shareOf(e,summary,locale);const medal=e.rank!=null&&e.rank<=3?e.rank:0;
  return <tr key={e.index} hidden={i>=limit} className={(e.rank==null?'wf-rank-nodata ':'')+(medal?'wf-rank-top':'')} style={{['--d' as any]:Math.min(i,24)*18+'ms'}}
   onClick={()=>pick(e)} onMouseEnter={()=>hover(e,true)} onMouseLeave={()=>hover(e,false)}>
   <td className="wf-rank-pos">{e.rank==null?<span className="wf-rank-dash">—</span>:<span className={'wf-rank-badge'+(medal?' m'+medal:'')}>{e.rank}</span>}</td>
   <td className="wf-rank-name">
    <div className="wf-rank-entity">
     <Avatar e={e} color={colorOf(e)}/>
     <a href={askLink(e.question).href} rel={askLink(e.question).rel} onClick={ev=>ev.stopPropagation()}>{e.name}</a>
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
    {criteria.length>1&&(pills
     ?<div className="wf-rank-pills" role="radiogroup" aria-label={t('Rank by')}>{criteria.map(x=><button key={x.key} type="button" role="radio" aria-checked={x.key===c.key} className={x.key===c.key?'on':''} onClick={()=>choose(x.key)}>{x.label}</button>)}</div>
     :<label className="wf-rank-select"><span>{t('Rank by')}</span><select value={c.key} onChange={ev=>choose(ev.target.value)}>{criteria.map(x=><option key={x.key} value={x.key}>{x.label}</option>)}</select></label>)}
   </div>
  </header>
  <div className="wf-rank-meta">
   <span className="wf-rank-crit">{c.label}{c.unit&&c.format!=='percent'&&c.format!=='currency'?<span className="wf-rank-unit"> · {c.unit}</span>:null}{c.year?<span className="wf-rank-unit"> · {c.year}</span>:null}</span>
   <span className="wf-rank-order">{c.order==='asc'?<ArrowUpNarrowWide size={13}/>:<ArrowDownWideNarrow size={13}/>}{c.order==='asc'?t('Lowest ranks first'):t('Highest ranks first')}</span>
   {c.description&&<span className="wf-rank-desc">{c.description}</span>}
  </div>

  <div className="wf-rank-tools">
   <label className="wf-rank-search"><Search size={14}/><input type="search" value={query} placeholder={t('Search…')} aria-label={t('Search entities')} onChange={ev=>setQuery(ev.target.value)}/></label>
   <span className="wf-rank-count">{(q||group)?t('{count} matching',{count:(tRanked.length+tMissing.length).toLocaleString(locale)})+' · ':''}{t('{ranked} ranked',{ranked:summary.ranked.toLocaleString(locale)})}{missing.length?' · '+t('{count} without data',{count:missing.length.toLocaleString(locale)}):''}</span>
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
  {(hidden>0||expanded&&tRanked.length+tMissing.length>PAGE)&&<div className="wf-rank-more">
   <button type="button" onClick={()=>setExpanded(x=>!x)}>{hidden>0?t('Show all {count}',{count:(tRanked.length+tMissing.length).toLocaleString(locale)}):t('Show fewer')}</button>
  </div>}
  {mode!=='none'&&<div className={'wf-rank-chart '+mode}>
   {mapError&&requested==='map'&&<div className="wf-rank-notice">{t('The map could not load; showing a bar chart instead.')}</div>}
   {mode==='column'&&<>
    <div className="wf-rank-charttools"><span className="wf-rank-charttitle">{c.label}{c.year?' · '+c.year:''}</span>{chartRanked.length>top&&<div className="wf-rank-seg" role="radiogroup" aria-label={t('Bars shown')}>
     <button type="button" role="radio" aria-checked={!allBars} className={!allBars?'on':''} onClick={()=>setAllBars(false)}>{t('Top {n}',{n:top})}</button>
     <button type="button" role="radio" aria-checked={allBars} className={allBars?'on':''} onClick={()=>setAllBars(true)}>{t('All {n}',{n:chartRanked.length})}</button>
    </div>}</div>
    {barShown.length?<ChartBox option={barOpt} height={barHeight} label={c.label} svg={!allBars&&!group?view.charts?.[chartKey(criteria.map(x=>x.key),c.key)]:undefined} onClick={p=>pick(barShown[p.dataIndex])} onChart={ch=>{charts.current.bar=ch;}}/>:<div className="wf-rank-empty">{noData}</div>}
   </>}
   {mode==='map'&&<div className="wf-rank-mapgrid">
    <ChartBox option={mapOpt} height={height} aspect={MAP_ASPECT} extra={MAP_BOTTOM+6} label={c.label} onClick={p=>pick(byKey.get(p.name))} onChart={ch=>{charts.current.map=ch;}}/>
    <div className="wf-rank-mini">
     <div className="wf-rank-minititle">{t('Top {n}',{n:miniShown.length})}</div>
     <ChartBox option={miniOpt} height={Math.max(220,miniShown.length*30+16)} label={c.label} onClick={p=>pick(miniShown[p.dataIndex])} onChart={ch=>{charts.current.mini=ch;}}/>
    </div>
   </div>}
  </div>}

  {source&&<figcaption className="wf-rank-source">{t('Source:')} {linkParts(source).map((p,i)=>p.href?<a key={i} href={p.href} target="_blank" rel="noopener noreferrer">{p.text}</a>:<span key={i}>{p.text}</span>)}</figcaption>}
 </figure>;
}
