'use client';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import type {KeyboardEvent,PointerEvent} from 'react';
import {createPortal} from 'react-dom';
import type {VizProps} from './types';
import {normalizeSlides,positiveNumber,wrapIndex} from './rich-helpers';
import './rich.css';

const Chevron=({dir}:{dir:'l'|'r'})=><svg viewBox="0 0 24 24" aria-hidden><path d={dir==='l'?'M15 5l-7 7 7 7':'M9 5l7 7-7 7'} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>;

export default function Carousel({props,setValue,fire,ctx}:VizProps){
 const slides=useMemo(()=>normalizeSlides(props.items),[JSON.stringify(props.items??null)]);// eslint-disable-line react-hooks/exhaustive-deps
 const n=slides.length;
 const autoplay=props.autoplay===true;const interval=Math.max(1500,positiveNumber(props.interval,5000));
 const height=positiveNumber(props.height,420);const fit=props.fit==='contain'?'contain':'cover';
 const [index,setIndex]=useState(0);const [hover,setHover]=useState(false);const [box,setBox]=useState(false);
 const [seen,setSeen]=useState<Set<number>>(()=>new Set([0]));
 const [dx,setDx]=useState(0);const drag=useRef<{x:number;y:number;id:number;moved:boolean}|null>(null);
 const track=useRef<HTMLDivElement>(null);const first=useRef(true);

 const go=useCallback((i:number)=>setIndex(wrapIndex(i,n)),[n]);
 useEffect(()=>{if(index>=n&&n)setIndex(0);},[n,index]);
 // Load the current slide and its neighbours; the rest wait until they are close.
 useEffect(()=>{setSeen(s=>{const t=new Set(s);[index-1,index,index+1].forEach(i=>t.add(wrapIndex(i,n)));return t.size===s.size?s:t;});},[index,n]);
 useEffect(()=>{if(first.current){first.current=false;return;}setValue(index);fire('change',index);},[index]);// eslint-disable-line react-hooks/exhaustive-deps
 useEffect(()=>{
  if(!autoplay||hover||box||n<2)return;
  const reduce=typeof matchMedia!=='undefined'&&matchMedia('(prefers-reduced-motion: reduce)').matches;if(reduce)return;
  const id=setInterval(()=>{if(!document.hidden)setIndex(i=>wrapIndex(i+1,n));},interval);
  return()=>clearInterval(id);
 },[autoplay,hover,box,n,interval]);
 useEffect(()=>{
  if(!box)return;
  const onKey=(e:globalThis.KeyboardEvent)=>{if(e.key==='Escape')setBox(false);else if(e.key==='ArrowLeft')go(index-1);else if(e.key==='ArrowRight')go(index+1);};
  const prev=document.body.style.overflow;document.body.style.overflow='hidden';
  window.addEventListener('keydown',onKey);
  return()=>{window.removeEventListener('keydown',onKey);document.body.style.overflow=prev;};
 },[box,index,go]);

 const down=(e:PointerEvent)=>{if(e.button!==0||n<1)return;drag.current={x:e.clientX,y:e.clientY,id:e.pointerId,moved:false};};
 const move=(e:PointerEvent)=>{
  const d=drag.current;if(!d||d.id!==e.pointerId)return;const ox=e.clientX-d.x;
  if(!d.moved&&Math.abs(ox)>6&&Math.abs(ox)>Math.abs(e.clientY-d.y)){d.moved=true;track.current?.setPointerCapture(e.pointerId);}
  if(d.moved)setDx(ox);
 };
 const up=(e:PointerEvent)=>{
  const d=drag.current;drag.current=null;if(!d)return;
  if(!d.moved){if((e.target as HTMLElement).closest('.wf-carousel-img'))setBox(true);return;}
  const w=track.current?.clientWidth||1;const ox=e.clientX-d.x;setDx(0);
  if(Math.abs(ox)>Math.min(80,w*.18))go(index+(ox<0?1:-1));
 };
 const key=(e:KeyboardEvent)=>{
  if(e.key==='ArrowLeft'){e.preventDefault();go(index-1);}else if(e.key==='ArrowRight'){e.preventDefault();go(index+1);}
  else if(e.key==='Enter'&&e.target===e.currentTarget)setBox(true);
 };

 if(!n)return <div className="wf-viz-error" role="alert">{ctx.t('No images to show')}</div>;
 const cur=slides[Math.min(index,n-1)];
 return <figure className="wf-viz-card wf-carousel" onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}>
  <div className="wf-carousel-viewport" style={{height}} tabIndex={0} role="region" aria-roledescription="carousel"
   aria-label={ctx.t('Image carousel')} onKeyDown={key}>
   <div ref={track} className={'wf-carousel-track'+(dx?' is-dragging':'')} style={{transform:`translate3d(calc(${-index*100}% + ${dx}px),0,0)`}}
    onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={()=>{drag.current=null;setDx(0);}}>
    {slides.map((s,i)=><div key={i} className="wf-carousel-slide" role="group" aria-roledescription="slide"
     aria-label={`${i+1} / ${n}`} aria-hidden={i!==index}>
     {seen.has(i)&&<img className="wf-carousel-img" src={s.src} alt={s.caption||''} draggable={false} loading={i===0?'eager':'lazy'} decoding="async" style={{objectFit:fit}}/>}
     {(s.caption||s.credit)&&<div className="wf-carousel-cap">
      {s.caption&&<div className="wf-carousel-cap-text">{s.caption}</div>}
      {s.credit&&<div className="wf-carousel-credit">{s.credit}</div>}
     </div>}
    </div>)}
   </div>
   {n>1&&<>
    <button type="button" className="wf-carousel-arrow is-prev" onClick={()=>go(index-1)} aria-label={ctx.t('Previous')}><Chevron dir="l"/></button>
    <button type="button" className="wf-carousel-arrow is-next" onClick={()=>go(index+1)} aria-label={ctx.t('Next')}><Chevron dir="r"/></button>
    <span className="wf-viz-pill wf-carousel-count">{index+1} / {n}</span>
   </>}
  </div>
  {n>1&&<div className="wf-carousel-dots" role="tablist">
   {slides.map((_,i)=><button key={i} type="button" role="tab" aria-selected={i===index} aria-label={`${i+1} / ${n}`}
    className={'wf-carousel-dot'+(i===index?' is-active':'')} onClick={()=>go(i)}/>)}
  </div>}
  {box&&typeof document!=='undefined'&&createPortal(<div className="wf-lightbox" role="dialog" aria-modal="true" aria-label={cur.caption||ctx.t('Image')}
   onClick={e=>{if(e.target===e.currentTarget)setBox(false);}}>
   <button type="button" className="wf-lightbox-close" onClick={()=>setBox(false)} aria-label={ctx.t('Close')} autoFocus>
    <svg viewBox="0 0 24 24" aria-hidden><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg></button>
   {n>1&&<button type="button" className="wf-lightbox-nav is-prev" onClick={()=>go(index-1)} aria-label={ctx.t('Previous')}><Chevron dir="l"/></button>}
   <img key={cur.src} className="wf-lightbox-img" src={cur.src} alt={cur.caption||''}/>
   {n>1&&<button type="button" className="wf-lightbox-nav is-next" onClick={()=>go(index+1)} aria-label={ctx.t('Next')}><Chevron dir="r"/></button>}
   {(cur.caption||cur.credit)&&<div className="wf-lightbox-cap">{cur.caption}{cur.credit&&<span className="wf-carousel-credit"> {cur.credit}</span>}</div>}
  </div>,document.body)}
 </figure>;
}
