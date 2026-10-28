'use client';
import {useEffect,useRef,useState} from 'react';
import type {KeyboardEvent,PointerEvent} from 'react';
import type {VizProps} from './types';
import {clampPercent,positiveNumber,safeImageUrl} from './rich-helpers';
import './rich.css';

export default function Compare({props,setValue,fire,ctx}:VizProps){
 const before=safeImageUrl(props.before),after=safeImageUrl(props.after);
 const beforeLabel=typeof props.beforeLabel==='string'?props.beforeLabel:ctx.t('Before');
 const afterLabel=typeof props.afterLabel==='string'?props.afterLabel:ctx.t('After');
 const caption=typeof props.caption==='string'?props.caption:'';
 const height=props.height==null?0:positiveNumber(props.height,0);
 const start=clampPercent(props.start,50);
 const [pos,setPos]=useState(start);const [drag,setDrag]=useState(false);
 const stage=useRef<HTMLDivElement>(null);const posRef=useRef(pos);posRef.current=pos;
 useEffect(()=>setPos(start),[start]);

 const commit=(p:number)=>{const v=Math.round(p*10)/10;setValue(v);fire('change',v);};
 const fromX=(x:number)=>{const r=stage.current?.getBoundingClientRect();if(!r||!r.width)return posRef.current;return clampPercent((x-r.left)/r.width*100,50);};
 const down=(e:PointerEvent<HTMLDivElement>)=>{if(e.button!==0)return;e.currentTarget.setPointerCapture(e.pointerId);setDrag(true);setPos(fromX(e.clientX));};
 const move=(e:PointerEvent<HTMLDivElement>)=>{if(drag)setPos(fromX(e.clientX));};
 const up=()=>{if(drag){setDrag(false);commit(posRef.current);}};
 const key=(e:KeyboardEvent)=>{
  const step=e.shiftKey?10:2;
  const next=e.key==='ArrowLeft'||e.key==='ArrowDown'?pos-step:e.key==='ArrowRight'||e.key==='ArrowUp'?pos+step:e.key==='Home'?0:e.key==='End'?100:null;
  if(next==null)return;e.preventDefault();const v=clampPercent(next,pos);setPos(v);commit(v);
 };

 if(!before||!after)return <div className="wf-viz-error" role="alert">{ctx.t('Both images need an https:// or site address')}</div>;
 return <figure className="wf-viz-card wf-compare">
  <div ref={stage} className={'wf-compare-stage'+(drag?' is-dragging':'')+(height?' has-height':'')} style={height?{height}:undefined}
   onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
   <img className="wf-compare-img" src={after} alt={afterLabel} draggable={false} loading="lazy" decoding="async"/>
   <img className="wf-compare-img wf-compare-before" src={before} alt={beforeLabel} draggable={false} loading="lazy" decoding="async"
    style={{clipPath:`inset(0 ${100-pos}% 0 0)`}}/>
   {beforeLabel&&<span className="wf-viz-pill wf-compare-l" style={{opacity:pos<12?0:1}}>{beforeLabel}</span>}
   {afterLabel&&<span className="wf-viz-pill wf-compare-r" style={{opacity:pos>88?0:1}}>{afterLabel}</span>}
   <div className="wf-compare-divider" style={{left:pos+'%'}}>
    <div className="wf-compare-handle" role="slider" tabIndex={0} aria-label={ctx.t('Comparison position')}
     aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pos)} onKeyDown={key}>
     <svg viewBox="0 0 24 24" aria-hidden><path d="M9 7l-5 5 5 5M15 7l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
    </div>
   </div>
  </div>
  {caption&&<figcaption className="wf-viz-caption">{caption}</figcaption>}
 </figure>;
}
