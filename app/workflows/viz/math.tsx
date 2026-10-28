'use client';
import {useEffect,useState} from 'react';
import type {VizProps} from './types';
import 'katex/dist/katex.min.css';
import './rich.css';

type Katex=typeof import('katex').default;
let loader:Promise<Katex>|null=null;
const loadKatex=()=>loader??=import('katex').then(m=>m.default).catch(e=>{loader=null;throw e;});

// KaTeX output is built from the TeX source with trust:false, so it carries no links/scripts.
function useKatex(tex:string,displayMode:boolean){
 const [html,setHtml]=useState<string|null>(null);
 useEffect(()=>{
  let live=true;setHtml(null);
  if(tex)loadKatex().then(k=>{if(live)setHtml(k.renderToString(tex,{displayMode,throwOnError:false,trust:false,strict:'ignore',output:'htmlAndMathml'}));}).catch(()=>{});
  return()=>{live=false;};
 },[tex,displayMode]);
 return html;
}

export function InlineMath({tex}:{tex:string}){
 const src=typeof tex==='string'?tex.trim():'';const html=useKatex(src,false);
 return html?<span className="wf-math-inline" dangerouslySetInnerHTML={{__html:html}}/>:<code className="wf-math-inline wf-math-pending">{src}</code>;
}

export default function MathBlock({props}:VizProps){
 const tex=typeof props.tex==='string'?props.tex.trim():'';
 const display=props.display!==false&&props.display!=='false';
 const caption=typeof props.caption==='string'?props.caption:'';
 const label=props.label==null||props.label===''?'':String(props.label).replace(/^\((.*)\)$/,'$1');
 const html=useKatex(tex,display);
 if(!display&&!caption&&!label)return <InlineMath tex={tex}/>;
 return <figure className={'wf-math'+(display?' is-display':'')}>
  <div className="wf-math-row">
   <div className="wf-math-body">{html?<div dangerouslySetInnerHTML={{__html:html}}/>:<code className="wf-math-pending">{tex}</code>}</div>
   {label&&<span className="wf-math-label">({label})</span>}
  </div>
  {caption&&<figcaption className="wf-viz-caption">{caption}</figcaption>}
 </figure>;
}
