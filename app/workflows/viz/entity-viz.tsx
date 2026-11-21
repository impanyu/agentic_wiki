'use client';
// Entity-page components drawn entirely in React/SVG, so the server ships them complete in the HTML:
// stat_cards (key figures), position (one entity among all its peers), peer_compare (its neighbours by
// rank) and timeline (dated events). Charts that need ECharts live in entity-charts.tsx.
import {useId,useMemo} from 'react';
import {ArrowDownWideNarrow,ArrowUpNarrowWide,ExternalLink} from 'lucide-react';
import type {VizProps} from './types';
import {makeFormatter,linkParts,median} from './ranking-data';
import {useAskLink} from '@/app/seo/link-context';
import {normalizeStats,changeText,sparkSeries,sparkPath,ordinal,topPercent,rankPeers,positionOf,scaleOf,scaleX,ticksOf,beeswarm,dotRadius,
 findPeer,neighbours,normalizeEvents,formatDate,asFormat,asOrder,EV_MEDAL,type StatCard,type Peer} from './entity-data';
import './viz.css';
import './entity-viz.css';

const str=(v:unknown)=>typeof v==='string'?v:typeof v==='number'?String(v):'';
type T=VizProps['ctx']['t'];

export function EvHead({props}:{props:Record<string,unknown>}){
 const title=str(props.title),subtitle=str(props.subtitle);
 if(!title&&!subtitle)return null;
 return <header className="wf-ev-head">{title&&<h3 className="wf-ev-title">{title}</h3>}{subtitle&&<p className="wf-ev-subtitle">{subtitle}</p>}</header>;
}
export function EvSource({props,t}:{props:Record<string,unknown>;t:T}){
 const source=str(props.source);if(!source)return null;
 return <figcaption className="wf-ev-source">{t('Source:')} {linkParts(source).map((p,i)=>p.href?<a key={i} href={p.href} target="_blank" rel="noopener noreferrer">{p.text}</a>:<span key={i}>{p.text}</span>)}</figcaption>;
}
export const rankLabel=(t:T,locale:string,rank:number,of:number|null)=>of?t('{rank} of {of}',{rank:ordinal(rank,locale),of:of.toLocaleString(locale)}):ordinal(rank,locale);
const medal=(rank:number|null)=>rank!=null&&rank>=1&&rank<=3?' m'+rank:'';
// A link to an entity: its own href, else the question that opens its page (as the ranking leaderboard links names).
function EntityLink({name,href}:{name:string;href?:string|null}){
 const ask=useAskLink();
 if(href)return /^https:/i.test(href)?<a href={href} target="_blank" rel="noopener noreferrer">{name}</a>:<a href={href}>{name}</a>;
 const l=ask(name);return l.href?<a href={l.href} rel={l.rel}>{name}</a>:<span>{name}</span>;
}

// ───────────── stat_cards ─────────────
function Spark({card,good}:{card:StatCard;good:boolean|null}){
 const id=useId().replace(/:/g,'');
 const pts=sparkSeries(card);const p=sparkPath(pts.map(x=>x.value),160,40,3);
 if(!p)return null;
 const color=good===false?'#f43f5e':'#4f7cff';
 // Stretched to the card's width (non-scaling strokes); the end dot and the period range are HTML so they keep their shape.
 return <div className="wf-ev-sparkwrap">
  <div className="wf-ev-sparkbox">
   <svg className="wf-ev-spark" viewBox="0 0 160 40" preserveAspectRatio="none" role="img" aria-label={pts.map(x=>x.period+': '+x.value).join(', ')}>
    <defs><linearGradient id={'g'+id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".26"/><stop offset="1" stopColor={color} stopOpacity="0"/></linearGradient></defs>
    <path d={p.area} fill={`url(#g${id})`}/>
    <path d={p.line} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke"/>
   </svg>
   <i className="wf-ev-spark-end" style={{left:p.end[0]/160*100+'%',top:p.end[1]/40*100+'%',background:color}}/>
  </div>
  <span className="wf-ev-spark-lbl">{pts[0].period}–{pts[pts.length-1].period}</span>
 </div>;
}
export function StatCards({props,ctx}:VizProps){
 const t=ctx.t,locale=ctx.locale||'en';
 const cards=useMemo(()=>normalizeStats(props.items??props.cards),[props.items,props.cards]);
 if(!cards.length)return <figure className="wf-viz wf-ev"><div className="wf-ev-empty">{t('No data')}</div></figure>;
 return <figure className="wf-viz wf-ev wf-ev-cards">
  <EvHead props={props}/>
  <div className="wf-ev-cardgrid">
   {cards.map((c,i)=>{
    const fmt=makeFormatter(c,c.value==null?[]:[c.value],locale,{unit:false});
    const unit=c.unit&&c.format!=='percent'&&c.format!=='currency'?c.unit:'';
    const body=<>
     <div className="wf-ev-card-top">
      <span className="wf-ev-card-lbl">{c.label}</span>
      {c.rank!=null&&<span className={'wf-ev-rank'+medal(c.rank)} title={c.of?t('Top {pct}',{pct:topPercent(c.rank,c.of)+'%'}):undefined}>{rankLabel(t,locale,c.rank,c.of)}</span>}
     </div>
     <div className="wf-ev-card-val">{c.value==null?c.text:fmt(c.value)}{unit&&<span className="wf-ev-card-unit">{unit}</span>}</div>
     <div className="wf-ev-card-meta">
      {c.change&&<span className={'wf-ev-delta'+(c.change.good==null?'':c.change.good?' up':' down')} title={t('Change since {period}',{period:c.change.from})}>
       {c.change.delta>0?'▲':c.change.delta<0?'▼':'■'} {changeText(c.change,c,locale)}<span className="wf-ev-delta-from"> {t('vs {period}',{period:c.change.from})}</span></span>}
      {c.year&&<span className="wf-ev-card-year">{c.year}</span>}
      {c.order==='asc'&&<span className="wf-ev-card-year">{t('lower is better')}</span>}
     </div>
     {c.note&&<div className="wf-ev-card-note">{c.note}</div>}
     <Spark card={c} good={c.change?.good??null}/>
    </>;
    return c.href?<a key={i} className="wf-ev-card link" href={c.href} style={{['--d' as any]:i*40+'ms'}}>{body}</a>
     :<div key={i} className="wf-ev-card" style={{['--d' as any]:i*40+'ms'}}>{body}</div>;
   })}
  </div>
  <EvSource props={props} t={t}/>
 </figure>;
}

// ───────────── position ─────────────
const W=720,PAD=28;
export function Position({props,ctx}:VizProps){
 const t=ctx.t,locale=ctx.locale||'en';
 const order=asOrder(props.order);
 const peers=useMemo(()=>rankPeers(props.values??props.rows,order),[props.values,props.rows,order]);
 const pos=useMemo(()=>positionOf(peers,props.highlight,order),[peers,props.highlight,order]);
 const values=useMemo(()=>peers.map(p=>p.value),[peers]);
 const c={format:asFormat(props.format),unit:str(props.unit)||undefined,decimals:typeof props.decimals==='number'?props.decimals:undefined,currency:str(props.currency)||undefined};
 const fmt=makeFormatter(c,values,locale);
 const axisFmt=makeFormatter(c,values,locale,{unit:false,compact:true});
 const scale=useMemo(()=>scaleOf(values,props.log===true?true:props.log===false?false:'auto'),[values,props.log]);
 const r=dotRadius(peers.length);
 const band=Math.min(150,Math.max(44,Math.ceil(Math.sqrt(peers.length))*r*2.6));
 const H=band+104,axisY=46+band/2;
 const xs=useMemo(()=>peers.map(p=>scaleX(scale,p.value,PAD,W-PAD)),[peers,scale]);
 const ys=useMemo(()=>beeswarm(xs,r+.6,band/2-r),[xs,r,band]);
 if(!peers.length)return <figure className="wf-viz wf-ev"><EvHead props={props}/><div className="wf-ev-empty">{t('No data')}</div></figure>;
 const label=str(props.label);
 const hi=pos.peer?peers.indexOf(pos.peer):-1;
 const hx=hi>=0?xs[hi]:0;
 const med=pos.median;const mx=med!=null?scaleX(scale,med,PAD,W-PAD):null;
 const ticks=ticksOf(scale,5);
 // The label stays inside the strip, also at the larger type of narrow screens.
 const calloutX=Math.max(150,Math.min(W-150,hx));
 return <figure className="wf-viz wf-ev wf-ev-position">
  <EvHead props={props}/>
  <div className="wf-ev-posline">
   {pos.peer&&pos.rank!=null?<>
    <span className={'wf-ev-rank big'+medal(pos.rank)}>{rankLabel(t,locale,pos.rank,pos.n)}</span>
    <span className="wf-ev-pos-name">{pos.peer.name}</span>
    <span className="wf-ev-pos-val">{fmt(pos.peer.value)}</span>
    <span className="wf-ev-chip">{t('Top {pct}',{pct:pos.top+'%'})}</span>
    <span className="wf-ev-chip soft">{t('{p} percentile',{p:ordinal(Math.round(pos.percentile!),locale)})}</span>
   </>:<span className="wf-ev-muted">{t('{name} has no value here.',{name:str(props.highlight)||'—'})}</span>}
  </div>
  <div className="wf-ev-meta">
   {label&&<span className="wf-ev-crit">{label}{c.unit&&c.format!=='percent'&&c.format!=='currency'?<span className="wf-ev-muted"> · {c.unit}</span>:null}{props.year?<span className="wf-ev-muted"> · {str(props.year)}</span>:null}</span>}
   <span className="wf-ev-order">{order==='asc'?<ArrowUpNarrowWide size={13}/>:<ArrowDownWideNarrow size={13}/>}{order==='asc'?t('Lowest ranks first'):t('Highest ranks first')}</span>
   {med!=null&&<span>{t('Median')} <b>{fmt(med)}</b></span>}
   {scale.log&&<span className="wf-ev-muted">{t('log scale')}</span>}
  </div>
  <svg className="wf-ev-strip" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={(label||t('Value'))+': '+(pos.peer?pos.peer.name+' '+fmt(pos.peer.value)+', '+rankLabel(t,locale,pos.rank!,pos.n):'')}>
   <rect x={PAD-8} y={axisY-band/2-6} width={W-2*PAD+16} height={band+12} rx="12" className="wf-ev-strip-band"/>
   {/* Tick labels near the median give way to its label (same row). */}
   {ticks.map(v=>{const x=scaleX(scale,v,PAD,W-PAD);return <g key={v}><line x1={x} x2={x} y1={axisY-band/2-6} y2={axisY+band/2+6} className="wf-ev-grid"/>{(mx==null||Math.abs(x-mx)>70)&&<text x={x} y={H-30} textAnchor="middle" className="wf-ev-tick">{axisFmt(v)}</text>}</g>;})}
   {mx!=null&&<g><line x1={mx} x2={mx} y1={axisY-band/2-10} y2={axisY+band/2+10} className="wf-ev-median"/><text x={mx} y={H-30} textAnchor="middle" className="wf-ev-median-lbl">{t('Median')}</text></g>}
   {peers.map((p,i)=>i===hi?null:<circle key={p.index} cx={Math.round(xs[i]*10)/10} cy={Math.round((axisY+ys[i])*10)/10} r={r} className={'wf-ev-dot'+(p.rank<=3?' top':'')} style={p.rank<=3?{fill:EV_MEDAL[p.rank-1]}:undefined}><title>{`${p.rank}. ${p.name}: ${fmt(p.value)}`}</title></circle>)}
   {hi>=0&&<g className="wf-ev-hi">
    <line x1={hx} x2={calloutX} y1={axisY+ys[hi]-r-2} y2={30} className="wf-ev-hi-line"/>
    <circle cx={hx} cy={axisY+ys[hi]} r={Math.max(r+3,7)} className="wf-ev-hi-ring"/>
    <circle cx={hx} cy={axisY+ys[hi]} r={Math.max(r+1,5)} className="wf-ev-hi-dot"><title>{`${pos.rank}. ${pos.peer!.name}: ${fmt(pos.peer!.value)}`}</title></circle>
    <text x={calloutX} y={22} textAnchor="middle" className="wf-ev-hi-lbl">{pos.peer!.name} · {fmt(pos.peer!.value)}</text>
   </g>}
   {pos.min&&<text x={PAD-6} y={H-6} className="wf-ev-end">{t('Lowest')}: {pos.min.name}</text>}
   {pos.max&&<text x={W-PAD+6} y={H-6} textAnchor="end" className="wf-ev-end">{t('Highest')}: {pos.max.name}</text>}
  </svg>
  <EvSource props={props} t={t}/>
 </figure>;
}

// ───────────── peer_compare ─────────────
export function PeerCompare({props,ctx}:VizProps){
 const t=ctx.t,locale=ctx.locale||'en';
 const order=asOrder(props.order);
 const peers=useMemo(()=>rankPeers(props.values??props.rows,order),[props.values,props.rows,order]);
 const around=typeof props.around==='number'&&props.around>=1?Math.min(25,Math.floor(props.around)):4;
 const top=props.top===false?0:typeof props.top==='number'?Math.max(0,Math.min(10,Math.floor(props.top))):3;
 const at=findPeer(peers,props.highlight);
 const rows=useMemo(()=>neighbours(peers,at,around,top),[peers,at,around,top]);
 const c={format:asFormat(props.format),unit:str(props.unit)||undefined,decimals:typeof props.decimals==='number'?props.decimals:undefined,currency:str(props.currency)||undefined};
 const values=peers.map(p=>p.value);
 const fmt=makeFormatter(c,values,locale);
 const maxAbs=values.reduce((m,v)=>Math.max(m,Math.abs(v)),0)||1;
 if(!peers.length)return <figure className="wf-viz wf-ev"><EvHead props={props}/><div className="wf-ev-empty">{t('No data')}</div></figure>;
 const label=str(props.label);const med=median(values);
 const row=(p:Peer,hl:boolean)=><li key={p.index} className={'wf-ev-peer'+(hl?' hl':'')+(p.rank<=3?' top':'')}>
  <span className={'wf-ev-rank'+medal(p.rank)}>{p.rank}</span>
  <span className="wf-ev-peer-name"><EntityLink name={p.name} href={p.href}/></span>
  <span className="wf-ev-peer-bar" aria-hidden="true"><i style={{width:Math.max(1.5,Math.abs(p.value)/maxAbs*100)+'%'}}/></span>
  <span className="wf-ev-peer-val">{fmt(p.value)}</span>
 </li>;
 return <figure className="wf-viz wf-ev wf-ev-peers">
  <EvHead props={props}/>
  <div className="wf-ev-meta">
   {label&&<span className="wf-ev-crit">{label}{props.year?<span className="wf-ev-muted"> · {str(props.year)}</span>:null}</span>}
   <span className="wf-ev-order">{order==='asc'?<ArrowUpNarrowWide size={13}/>:<ArrowDownWideNarrow size={13}/>}{order==='asc'?t('Lowest ranks first'):t('Highest ranks first')}</span>
   <span>{t('{count} ranked',{count:peers.length.toLocaleString(locale)})}{med!=null?' · '+t('Median')+' '+fmt(med):''}</span>
  </div>
  <ol className="wf-ev-peerlist">
   {rows.map((x,i)=>x.kind==='gap'?<li key={'g'+i} className="wf-ev-gap" aria-label={t('{count} more',{count:x.skipped})}><span>⋯</span>{t('{count} more',{count:x.skipped.toLocaleString(locale)})}</li>:row(x.peer,x.highlight))}
  </ol>
  {at<0&&props.highlight?<p className="wf-ev-note">{t('{name} has no value here.',{name:str(props.highlight)})}</p>:null}
  <EvSource props={props} t={t}/>
 </figure>;
}

// ───────────── timeline ─────────────
export function Timeline({props,ctx}:VizProps){
 const t=ctx.t,locale=ctx.locale||'en';
 const events=useMemo(()=>normalizeEvents(props.events??props.items,props.order??'asc'),[props.events,props.items,props.order]);
 if(!events.length)return <figure className="wf-viz wf-ev"><EvHead props={props}/><div className="wf-ev-empty">{t('No events')}</div></figure>;
 return <figure className="wf-viz wf-ev wf-ev-timeline">
  <EvHead props={props}/>
  <ol className="wf-ev-tl">
   {events.map((e,i)=><li key={i} className={'wf-ev-tl-item'+(e.tone?' tone-'+e.tone:'')} style={{['--d' as any]:Math.min(i,20)*35+'ms'}}>
    <time className="wf-ev-tl-date" dateTime={/^-?\d{1,4}(-\d{2}){0,2}$/.test(e.date)?e.date:undefined}>{formatDate(e.date,locale)}</time>
    <span className="wf-ev-tl-dot" aria-hidden="true"/>
    <div className="wf-ev-tl-body">
     <div className="wf-ev-tl-label">{e.href?(/^https:/i.test(e.href)?<a href={e.href} target="_blank" rel="noopener noreferrer">{e.label}<ExternalLink size={12}/></a>:<a href={e.href}>{e.label}</a>):e.label}</div>
     {e.detail&&<p className="wf-ev-tl-detail">{e.detail}</p>}
    </div>
   </li>)}
  </ol>
  <EvSource props={props} t={t}/>
 </figure>;
}
