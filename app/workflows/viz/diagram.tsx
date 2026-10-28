'use client';
import {useEffect,useRef,useState} from 'react';
import type {VizProps} from './types';
import './rich.css';

type Mermaid=typeof import('mermaid').default;
let loader:Promise<Mermaid>|null=null;let seq=0;
function loadMermaid(){
 return loader??=import('mermaid').then(m=>{
  const mermaid=m.default;
  mermaid.initialize({startOnLoad:false,securityLevel:'strict',theme:'base',
   fontFamily:'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
   themeVariables:{primaryColor:'#eef2ff',primaryBorderColor:'#6366f1',primaryTextColor:'#1e293b',lineColor:'#94a3b8',
    secondaryColor:'#ecfeff',tertiaryColor:'#fdf4ff',fontSize:'14px',fontFamily:'Inter, ui-sans-serif, system-ui, sans-serif'}});
  return mermaid;
 }).catch(e=>{loader=null;throw e;});
}

export default function Diagram({props,ctx}:VizProps){
 const code=typeof props.code==='string'?props.code.trim():'';
 const title=typeof props.title==='string'?props.title:'';const caption=typeof props.caption==='string'?props.caption:'';
 const box=useRef<HTMLDivElement>(null);const t=useRef(ctx.t);t.current=ctx.t;
 const [error,setError]=useState('');const [ready,setReady]=useState(false);
 const [actual,setActual]=useState(false);const [wide,setWide]=useState(false);const natural=useRef(0);

 useEffect(()=>{
  let live=true;const id='wf-mermaid-'+(++seq)+'-'+Math.random().toString(36).slice(2,8);
  setError('');setReady(false);
  if(!code){setError(t.current('No diagram source'));return;}
  loadMermaid().then(async mermaid=>{
   const {svg}=await mermaid.render(id,code);
   if(!live||!box.current)return;
   box.current.innerHTML=svg;// sanitized by mermaid (securityLevel: strict)
   const el=box.current.querySelector('svg');
   if(el){
    natural.current=el.viewBox?.baseVal?.width||el.getBoundingClientRect().width;
    el.removeAttribute('height');el.style.height='auto';
   }
   setReady(true);
  }).catch(e=>{
   document.getElementById('d'+id)?.remove();// mermaid leaves a temp node behind on failure
   if(live)setError(String(e?.message||e||'Diagram error').replace(/^Error:\s*/,''));
  });
  return()=>{live=false;};
 },[code]);

 // Size the SVG: "fit" shrinks to the card, "actual" uses its natural width and scrolls.
 useEffect(()=>{
  const el=box.current?.querySelector('svg');if(!ready||!el||!box.current)return;
  const w=natural.current;
  if(w){el.style.width=w+'px';el.style.maxWidth=actual?'none':'100%';}
  const measure=()=>setWide(!!w&&w>(box.current?.clientWidth||0)+1);
  measure();
  const ro=typeof ResizeObserver!=='undefined'?new ResizeObserver(measure):null;ro?.observe(box.current);
  return()=>ro?.disconnect();
 },[ready,actual]);

 return <figure className="wf-viz-card wf-diagram">
  {(title||(ready&&(wide||actual)))&&<div className="wf-diagram-head">
   {title&&<div className="wf-diagram-title">{title}</div>}
   {ready&&(wide||actual)&&<button type="button" className="wf-viz-btn" onClick={()=>setActual(a=>!a)} aria-pressed={actual}>
    {actual?ctx.t('Fit'):ctx.t('Actual size')}</button>}
  </div>}
  {error?<div className="wf-viz-error" role="alert">
   <strong>{ctx.t('Diagram could not be rendered')}</strong><div className="wf-viz-error-msg">{error}</div>
   {code&&<details><summary>{ctx.t('Source')}</summary><pre>{code}</pre></details>}
  </div>:<div className={'wf-diagram-scroll'+(actual?' is-actual':'')}>
   {!ready&&<div className="wf-viz-skeleton" aria-hidden/>}
   <div ref={box} className="wf-diagram-svg" role="img" aria-label={title||caption||ctx.t('Diagram')}/>
  </div>}
  {caption&&<figcaption className="wf-viz-caption">{caption}</figcaption>}
 </figure>;
}
