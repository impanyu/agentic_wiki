'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import type {HLJSApi,LanguageFn} from 'highlight.js';
import type {VizProps} from './types';
import {lineSet,positiveNumber,splitHighlightedLines} from './rich-helpers';
import './rich.css';

// Each language is its own chunk; only the ones a page uses are fetched.
const LANGS:Record<string,()=>Promise<{default:LanguageFn}>>={
 javascript:()=>import('highlight.js/lib/languages/javascript'),typescript:()=>import('highlight.js/lib/languages/typescript'),
 python:()=>import('highlight.js/lib/languages/python'),json:()=>import('highlight.js/lib/languages/json'),
 bash:()=>import('highlight.js/lib/languages/bash'),sql:()=>import('highlight.js/lib/languages/sql'),
 xml:()=>import('highlight.js/lib/languages/xml'),css:()=>import('highlight.js/lib/languages/css'),
 java:()=>import('highlight.js/lib/languages/java'),go:()=>import('highlight.js/lib/languages/go'),
 rust:()=>import('highlight.js/lib/languages/rust'),c:()=>import('highlight.js/lib/languages/c'),
 cpp:()=>import('highlight.js/lib/languages/cpp'),r:()=>import('highlight.js/lib/languages/r'),
 yaml:()=>import('highlight.js/lib/languages/yaml'),markdown:()=>import('highlight.js/lib/languages/markdown'),
};
const ALIAS:Record<string,string>={js:'javascript',jsx:'javascript',mjs:'javascript',ts:'typescript',tsx:'typescript',py:'python',
 sh:'bash',shell:'bash',zsh:'bash',console:'bash',html:'xml',svg:'xml',htm:'xml',golang:'go',rs:'rust',h:'c','c++':'cpp',hpp:'cpp',cc:'cpp',
 yml:'yaml',md:'markdown',postgres:'sql',postgresql:'sql',mysql:'sql',sqlite:'sql',jsonc:'json'};
const LABEL:Record<string,string>={javascript:'JavaScript',typescript:'TypeScript',python:'Python',json:'JSON',bash:'Shell',sql:'SQL',xml:'HTML',
 css:'CSS',java:'Java',go:'Go',rust:'Rust',c:'C',cpp:'C++',r:'R',yaml:'YAML',markdown:'Markdown'};
const resolve=(l:unknown)=>{const k=typeof l==='string'?l.trim().toLowerCase():'';return LANGS[k]?k:ALIAS[k]||'';};

let core:Promise<HLJSApi>|null=null;const registered=new Map<string,Promise<void>>();
async function hljsWith(langs:string[]){
 const hljs=await (core??=import('highlight.js/lib/core').then(m=>m.default).catch(e=>{core=null;throw e;}));
 await Promise.all(langs.map(l=>{
  if(!registered.has(l))registered.set(l,LANGS[l]().then(m=>hljs.registerLanguage(l,m.default)).catch(e=>{registered.delete(l);throw e;}));
  return registered.get(l)!;
 }));
 return hljs;
}

export default function CodeBlock({props,ctx}:VizProps){
 const text=typeof props.text==='string'?props.text.replace(/\n$/,''):props.text==null?'':String(props.text);
 const asked=resolve(props.language);const rawLang=typeof props.language==='string'?props.language.trim():'';
 const title=typeof props.title==='string'?props.title:'';
 const wrap=props.wrap===true;const numbers=props.lineNumbers!==false;
 const maxHeight=props.maxHeight==null?0:positiveNumber(props.maxHeight,0);
 const marks=useMemo(()=>lineSet(props.highlight),[JSON.stringify(props.highlight??null)]);// eslint-disable-line react-hooks/exhaustive-deps
 const [hl,setHl]=useState<{html:string[];lang:string}|null>(null);
 const [copied,setCopied]=useState(false);const timer=useRef<ReturnType<typeof setTimeout>>(undefined);

 useEffect(()=>{
  let live=true;setHl(null);
  if(!text)return;
  // Unknown or missing language: auto-detect across every registered language.
  hljsWith(asked?[asked]:Object.keys(LANGS)).then(hljs=>{
   if(!live)return;
   const r=asked?hljs.highlight(text,{language:asked,ignoreIllegals:true}):hljs.highlightAuto(text,Object.keys(LANGS));
   setHl({html:splitHighlightedLines(r.value),lang:asked||r.language||''});
  }).catch(()=>{});
  return()=>{live=false;};
 },[text,asked]);
 useEffect(()=>()=>clearTimeout(timer.current),[]);

 const copy=async()=>{
  try{await navigator.clipboard.writeText(text);}catch{
   const ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.opacity='0';
   document.body.appendChild(ta);ta.select();try{document.execCommand('copy');}finally{ta.remove();}
  }
  setCopied(true);clearTimeout(timer.current);timer.current=setTimeout(()=>setCopied(false),1600);
 };

 const plain=useMemo(()=>text.split('\n'),[text]);
 const count=hl?hl.html.length:plain.length;
 const langLabel=LABEL[hl?.lang||asked]||rawLang;
 return <figure className={'wf-code'+(wrap?' is-wrap':'')+(numbers?' has-numbers':'')}>
  <div className="wf-code-head">
   {title?<span className="wf-code-tab">{title}</span>:<span className="wf-code-lang">{langLabel}</span>}
   {title&&langLabel&&<span className="wf-code-lang">{langLabel}</span>}
   <button type="button" className={'wf-viz-btn wf-code-copy'+(copied?' is-done':'')} onClick={copy} aria-live="polite">
    {copied?<><svg viewBox="0 0 16 16" aria-hidden><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>{ctx.t('Copied')}</>
     :<><svg viewBox="0 0 16 16" aria-hidden><rect x="5" y="5" width="8.5" height="8.5" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4"/><path d="M10.5 3.2A1.5 1.5 0 0 0 9 2H4a2 2 0 0 0-2 2v5a1.5 1.5 0 0 0 1.2 1.5" fill="none" stroke="currentColor" strokeWidth="1.4"/></svg>{ctx.t('Copy')}</>}
   </button>
  </div>
  <pre className="wf-code-pre" style={maxHeight?{maxHeight}:undefined} tabIndex={0}>
   <code className="hljs" style={{['--wf-ln-w' as string]:String(count).length+'ch'}}>
    {Array.from({length:count},(_,i)=><span key={i} className={'wf-code-line'+(marks.has(i+1)?' is-marked':'')}>
     {numbers&&<span className="wf-code-ln" aria-hidden>{i+1}</span>}
     {hl?<span className="wf-code-lc" dangerouslySetInnerHTML={{__html:hl.html[i]||'​'}}/>:<span className="wf-code-lc">{plain[i]||'​'}</span>}
    </span>)}
   </code>
  </pre>
 </figure>;
}
