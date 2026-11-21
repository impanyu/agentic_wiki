'use client';
// Entity-page components drawn with ECharts: trend, radar_profile, location_map, relation_graph.
// They render on the server too: the header, a summary and a plain SVG/HTML fallback are in the HTML;
// ECharts (the same prebuilt bundle the other charts use) loads in an effect and replaces the fallback.
import {useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {MapPin} from 'lucide-react';
import type {VizProps} from './types';
import {makeFormatter,parseNumber} from './ranking-data';
import {registerGeo,pointOf,type GeoData} from './ranking-geo';
import {normalizeSeries,periodsOf,normalizeAnnotations,trendPaths,radarProfile,radarPolygon,normalizeRelations,groupRelations,relationGraph,
 regionOf,albersUsa,mainBox,padBox,boxOfPoints,unionBox,latLonText,placeNameKey,asFormat,evList,safeHref,ordinal,EV_PALETTE,type RegionKindEv} from './entity-data';
import {trendOption,radarOption,graphOption,locationOption} from './entity-chart';
import {EvHead,EvSource,rankLabel} from './entity-viz';
import './viz.css';
import './entity-viz.css';

type ECharts=typeof import('echarts');
type Chart=ReturnType<ECharts['init']>;
let echartsP:Promise<ECharts>|null=null;
// @ts-ignore prebuilt bundle, shared with the echart and ranking components
const loadECharts=()=>echartsP??=import('echarts/dist/echarts.js').then(m=>((m as any).default??m) as ECharts).catch(e=>{echartsP=null;throw e;});
const errText=(e:unknown)=>e instanceof Error?e.message:String(e);
const str=(v:unknown)=>typeof v==='string'?v:typeof v==='number'?String(v):'';
const heightOf=(v:unknown,d:number)=>typeof v==='number'&&v>=160?Math.min(v,1000):d;
// Opens a link from a chart click: same-site in place, https in a new tab.
const follow=(href:string|null|undefined)=>{if(!href)return;if(href.startsWith('/'))window.location.assign(href);else window.open(href,'_blank','noopener,noreferrer');};

// One ECharts instance; `fallback` (server-rendered) shows until the chart has drawn.
function EvChart({option,height,label,fallback,onClick,onReady}:{option:Record<string,unknown>|null;height:number;label:string;fallback:ReactNode;onClick?:(p:any)=>void;onReady?:(e:ECharts)=>void}){
 const box=useRef<HTMLDivElement>(null);const chart=useRef<Chart|null>(null);
 const cb=useRef({onClick,onReady});cb.current={onClick,onReady};
 const [ready,setReady]=useState(false);const [drawn,setDrawn]=useState(false);const [error,setError]=useState('');
 useEffect(()=>{
  let dead=false,ro:ResizeObserver|null=null;
  loadECharts().then(echarts=>{
   if(dead||!box.current)return;
   const c=echarts.init(box.current,null,{renderer:'canvas'});chart.current=c;
   c.on('click',(p:any)=>cb.current.onClick?.(p));
   ro=new ResizeObserver(()=>c.resize());ro.observe(box.current);
   cb.current.onReady?.(echarts);setReady(true);
  }).catch(e=>!dead&&setError(errText(e)));
  return ()=>{dead=true;ro?.disconnect();chart.current?.dispose();chart.current=null;};
 },[]);
 useEffect(()=>{
  const c=chart.current;if(!c||c.isDisposed()||!option)return;
  try{c.setOption(option as any,{notMerge:true});setDrawn(true);setError('');}catch(e){setError(errText(e));}
 },[option,ready]);
 return <div className="wf-ev-chartbox" style={{height}}>
  <div ref={box} className="wf-echart-canvas" role="img" aria-label={label}/>
  {!drawn&&<div className="wf-ev-fallback">{fallback}</div>}
  {error&&<div className="wf-ev-notice" role="alert">{error}</div>}
 </div>;
}

// ───────────── trend ─────────────
export function Trend({props,ctx}:VizProps){
 const t=ctx.t,locale=ctx.locale||'en';
 const series=useMemo(()=>normalizeSeries(props.series,props.points),[props.series,props.points]);
 const periods=useMemo(()=>periodsOf(series),[series]);
 const annotations=useMemo(()=>normalizeAnnotations(props.annotations),[props.annotations]);
 const allPos=series.every(s=>s.points.every(p=>p.value>0));
 const log=allPos&&(props.log===true||props.log==='auto'&&(()=>{const v=series.flatMap(s=>s.points.map(p=>p.value));return Math.max(...v)/Math.min(...v)>=1000;})());
 const base={format:asFormat(props.format),decimals:typeof props.decimals==='number'?props.decimals:undefined,currency:str(props.currency)||undefined};
 const fmts=useMemo(()=>series.map(s=>makeFormatter({...base,unit:s.unit??(str(props.unit)||undefined)},s.points.map(p=>p.value),locale)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [series,locale,props.format,props.decimals,props.currency,props.unit]);
 const axisFmts=useMemo(()=>series.map(s=>makeFormatter({...base,unit:undefined},s.points.map(p=>p.value),locale,{unit:false,compact:true})),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [series,locale,props.format,props.decimals,props.currency]);
 const area=props.area!==false&&series.length<=2;
 const option=useMemo(()=>series.length?trendOption({series,periods,annotations,log,area,fmts,axisFmts}):null,[series,periods,annotations,log,area,fmts,axisFmts]);
 const height=heightOf(props.height,320);
 if(!series.length)return <figure className="wf-viz wf-ev"><EvHead props={props}/><div className="wf-ev-empty">{t('No data')}</div></figure>;
 const sw=640,sh=Math.max(120,height-40);const fb=trendPaths(series,sw,sh,log);
 return <figure className="wf-viz wf-ev wf-ev-trend">
  <EvHead props={props}/>
  <div className="wf-ev-summary">
   {series.map((s,i)=>{const a=s.points[0],b=s.points[s.points.length-1];const ch=a.value?(b.value-a.value)/Math.abs(a.value)*100:null;
    return <span key={i} className="wf-ev-sumitem"><i style={{background:EV_PALETTE[i%EV_PALETTE.length]}}/>{s.label&&<span className="wf-ev-muted">{s.label}</span>}
     <b>{fmts[i](b.value)}</b><span className="wf-ev-muted">{b.period}</span>
     {s.points.length>1&&ch!=null&&<span className="wf-ev-delta plain">{ch>0?'+':ch<0?'−':''}{Math.abs(ch).toLocaleString(locale,{maximumFractionDigits:Math.abs(ch)<10?1:0})}% {t('since {period}',{period:a.period})}</span>}
    </span>;})}
   {log&&<span className="wf-ev-muted">{t('log scale')}</span>}
  </div>
  <EvChart option={option} height={height} label={str(props.title)||series.map(s=>s.label).join(', ')}
   fallback={<svg viewBox={`0 0 ${sw} ${sh}`} preserveAspectRatio="none" className="wf-ev-fbsvg" aria-hidden="true">
    {fb.paths.map((d,i)=><path key={i} d={d} fill="none" stroke={EV_PALETTE[i%EV_PALETTE.length]} strokeWidth="2.2" vectorEffect="non-scaling-stroke"/>)}
   </svg>}/>
  <EvSource props={props} t={t}/>
 </figure>;
}

// ───────────── radar_profile ─────────────
export function RadarProfile({props,ctx}:VizProps){
 const t=ctx.t,locale=ctx.locale||'en';
 const prof=useMemo(()=>radarProfile(props.criteria,props.rows,props.highlight),[props.criteria,props.rows,props.highlight]);
 const fmts=useMemo(()=>prof.criteria.map(c=>makeFormatter(c,evList(props.rows).map(r=>parseNumber((r as any)?.[c.key])).filter((v):v is number=>v!=null),locale)),[prof.criteria,props.rows,locale]);
 const found=prof.entities.filter(e=>e.found);
 const option=useMemo(()=>prof.criteria.length>=3&&found.length?radarOption({...prof,fmts,medianLabel:t('Peer median'),rankText:(r,of)=>rankLabel(t,locale,r,of)}):null,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [prof,fmts,locale]);
 const height=heightOf(props.height,380);
 if(prof.criteria.length<3||!found.length)return <figure className="wf-viz wf-ev"><EvHead props={props}/><div className="wf-ev-empty">{prof.criteria.length<3?t('A profile needs at least three criteria.'):t('No data')}</div></figure>;
 const first=found[0];
 const scored=prof.criteria.map((c,i)=>({c,p:first.percentiles[i]})).filter(x=>x.p!=null) as {c:typeof prof.criteria[number];p:number}[];
 const best=[...scored].sort((a,b)=>b.p-a.p)[0],worst=[...scored].sort((a,b)=>a.p-b.p)[0];
 const S=300,R=110;
 return <figure className="wf-viz wf-ev wf-ev-radar">
  <EvHead props={props}/>
  <div className="wf-ev-summary">
   {found.map((e,i)=><span key={e.name} className="wf-ev-sumitem"><i style={{background:EV_PALETTE[i%EV_PALETTE.length]}}/><b>{e.name}</b></span>)}
   {best&&<span className="wf-ev-chip">{t('Strongest')}: {best.c.label} · {t('{p} percentile',{p:ordinal(Math.round(best.p),locale)})}</span>}
   {worst&&worst!==best&&<span className="wf-ev-chip soft">{t('Weakest')}: {worst.c.label} · {t('{p} percentile',{p:ordinal(Math.round(worst.p),locale)})}</span>}
  </div>
  <EvChart option={option} height={height} label={str(props.title)||t('Percentile profile')}
   fallback={<svg viewBox={`0 0 ${S} ${S}`} className="wf-ev-fbsvg square" aria-hidden="true">
    {[25,50,75,100].map(p=><polygon key={p} points={radarPolygon(prof.criteria.map(()=>p),S/2,S/2,R)} className={p===50?'wf-ev-median-ring':'wf-ev-ring'}/>)}
    {found.map((e,i)=><polygon key={e.name} points={radarPolygon(e.percentiles,S/2,S/2,R)} fill={EV_PALETTE[i%EV_PALETTE.length]} fillOpacity=".18" stroke={EV_PALETTE[i%EV_PALETTE.length]} strokeWidth="2"/>)}
   </svg>}/>
  <p className="wf-ev-note">{t('Each axis is a percentile among {count} peers: 100 is the best, the dashed ring the median.',{count:Math.max(...prof.counts).toLocaleString(locale)})}</p>
  <EvSource props={props} t={t}/>
 </figure>;
}

// ───────────── relation_graph ─────────────
export function RelationGraph({props,ctx}:VizProps){
 const t=ctx.t;
 const center=str((props.center as any)?.name??props.center)||str(props.name)||'';
 const rels=useMemo(()=>normalizeRelations(props.relations,typeof props.limit==='number'?Math.max(1,Math.min(150,props.limit)):80),[props.relations,props.limit]);
 const groups=useMemo(()=>groupRelations(rels),[rels]);
 const graph=useMemo(()=>relationGraph(center,rels),[center,rels]);
 const layout=props.layout==='circular'||props.layout!=='force'&&rels.length>45?'circular':'force';
 const option=useMemo(()=>rels.length?graphOption({...graph,layout}):null,[graph,layout,rels.length]);
 const height=heightOf(props.height,rels.length>30?520:420);
 if(!rels.length)return <figure className="wf-viz wf-ev"><EvHead props={props}/><div className="wf-ev-empty">{t('No relations')}</div></figure>;
 const color=(i:number)=>EV_PALETTE[(i+1)%EV_PALETTE.length];
 const list=<dl className="wf-ev-rels">
  {groups.map((g,i)=><div key={g.predicate} className="wf-ev-relgroup">
   <dt><i style={{background:color(i)}}/>{g.predicate}</dt>
   <dd>{g.items.map((r,j)=><span key={j} className="wf-ev-relitem">{r.href?<a href={r.href} {...(/^https:/i.test(r.href)?{target:'_blank',rel:'noopener noreferrer'}:{})}>{r.name}</a>:r.name}{r.type&&<span className="wf-ev-muted"> · {r.type}</span>}</span>)}</dd>
  </div>)}
 </dl>;
 return <figure className="wf-viz wf-ev wf-ev-graph">
  <EvHead props={props}/>
  <EvChart option={option} height={height} label={t('Relations of {name}',{name:center})}
   onClick={p=>{if(p.dataType!=='node')return;follow(graph.nodes[p.dataIndex]?.href);}}
   fallback={<div className="wf-viz-loading wf-ev-shimmer" aria-busy="true"/>}/>
  {list}
  <EvSource props={props} t={t}/>
 </figure>;
}

// ───────────── location_map ─────────────
type Nearby={name:string;p:[number,number];href:string|null};
export function LocationMap({props,ctx}:VizProps){
 const t=ctx.t;
 const name=str(props.name)||str(props.title)||'';
 const point=useMemo(()=>pointOf(props.point&&typeof props.point==='object'?props.point as Record<string,unknown>:props as Record<string,unknown>),[props]);
 const nearby=useMemo<Nearby[]>(()=>evList(props.nearby).flatMap(n=>{const o=n as Record<string,unknown>;const p=pointOf(o);const nm=str(o?.name);return p&&nm?[{name:nm,p,href:safeHref(o.href)}]:[];}).slice(0,40),[props.nearby]);
 const region=useMemo(()=>regionOf(props.region??props.code,props.regionType),[props.region,props.code,props.regionType]);
 const regionText=str(props.region??props.code);
 // Without a recognized code, a region given by name is looked up among the world map's country names.
 const kind:RegionKindEv=region?.kind??'world';
 const [geo,setGeo]=useState<GeoData|null>(null);const [err,setErr]=useState('');
 const [echarts,setEcharts]=useState<ECharts|null>(null);
 useEffect(()=>{if(!echarts)return;let dead=false;registerGeo(echarts,kind).then(g=>!dead&&setGeo(g)).catch(e=>!dead&&setErr(errText(e)));return ()=>{dead=true;};},[echarts,kind]);
 const option=useMemo(()=>{
  if(!geo||geo.kind!==kind)return null;
  let key=region?.key??null;
  if(!key&&regionText){const k=placeNameKey(regionText);for(const [id,label] of geo.names)if(placeNameKey(label)===k){key=id;break;}}
  const feature:any=key?geo.fc.features.find((f:any)=>f?.properties?.name===key):null;
  // U.S. maps are in Albers plane coordinates (y flipped up by ranking-geo); points are projected the same way.
  const at=(p:[number,number]):[number,number]=>{if(kind==='world')return p;const q=albersUsa(p[0],p[1]);return [q[0],-q[1]];};
  const pt=point?at(point):null;const near=nearby.map(n=>({name:n.name,at:at(n.p),href:n.href}));
  const rb=feature?mainBox(feature.geometry):null;
  const fit=kind==='world'?{pad:.25,min:8}:kind==='us'?{pad:.18,min:110}:{pad:1.2,min:70};
  let box=rb?padBox(rb,fit.pad,fit.min):null;
  const pb=boxOfPoints([...(pt?[pt]:[]),...near.map(n=>n.at)]);
  if(pb)box=unionBox(box,padBox(pb,.25,rb?0:kind==='world'?12:90));
  return locationOption({kind,map:geo.name,regionKey:key,box,point:pt,nearby:near,name:name||(key?geo.names.get(key)??'':'')});
 },[geo,kind,region,regionText,point,nearby,name]);
 const height=heightOf(props.height,360);
 if(!region&&!regionText&&!point)return <figure className="wf-viz wf-ev"><EvHead props={props}/><div className="wf-ev-empty">{t('No location')}</div></figure>;
 return <figure className="wf-viz wf-ev wf-ev-location">
  <EvHead props={props}/>
  <div className="wf-ev-summary">
   <span className="wf-ev-sumitem"><MapPin size={14} className="wf-ev-pin"/><b>{name||regionText}</b></span>
   {regionText&&name&&regionText!==name&&<span className="wf-ev-muted">{regionText}</span>}
   {point&&<span className="wf-ev-muted">{latLonText(point)}</span>}
  </div>
  {err?<div className="wf-ev-notice">{t('The map could not load.')}</div>
   :<EvChart option={option} height={height} label={t('Map of {name}',{name:name||regionText})} onReady={setEcharts}
     onClick={p=>{if(p.seriesType==='scatter')follow(p.data?.href);}}
     fallback={<div className="wf-viz-loading wf-ev-shimmer" aria-busy="true"/>}/>}
  {nearby.length>0&&<div className="wf-ev-nearby"><span className="wf-ev-muted">{t('Nearby')}:</span>{nearby.map((n,i)=><span key={i} className="wf-ev-relitem">{n.href?<a href={n.href} {...(/^https:/i.test(n.href)?{target:'_blank',rel:'noopener noreferrer'}:{})}>{n.name}</a>:n.name}</span>)}</div>}
  <EvSource props={props} t={t}/>
 </figure>;
}
