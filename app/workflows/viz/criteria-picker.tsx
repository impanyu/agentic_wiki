'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {Search,Check,ChevronDown} from 'lucide-react';
import type {Criterion} from './ranking-data';

// "Rank by" for a long list of criteria: a searchable select, as large sites build it (GitHub's branch picker,
// Notion's property menus): a button showing the criterion in view opens a panel with the search box at its top and
// the criteria below, grouped by theme. Typing filters (every word must match the name, theme, unit or description);
// arrows move, Enter picks, Escape closes, a click outside closes. The options stay in the page while closed (hidden),
// so every criterion is in the HTML.
export function CriteriaPicker({criteria,value,onChange,label,placeholder,empty}:{criteria:Criterion[];value:string;onChange:(key:string)=>void;label:string;placeholder:string;empty:string}){
 const [open,setOpen]=useState(false);const [q,setQ]=useState('');const [active,setActive]=useState(0);
 const root=useRef<HTMLDivElement>(null);const input=useRef<HTMLInputElement>(null);const list=useRef<HTMLDivElement>(null);
 const id=useMemo(()=>'crit-'+Math.random().toString(36).slice(2,8),[]);
 const current=criteria.find(x=>x.key===value);
 const shown=useMemo(()=>{const words=q.toLowerCase().split(/\s+/).filter(Boolean);if(!words.length)return criteria;
  return criteria.filter(x=>{const hay=[x.label,x.theme,x.unit,x.key.replace(/_/g,' '),x.description].filter(Boolean).join(' ').toLowerCase();return words.every(w=>hay.includes(w));});},[criteria,q]);
 // Grouped by theme in the order themes first appear; the flat order is what the arrow keys walk.
 const groups=useMemo(()=>{const m=new Map<string,Criterion[]>();for(const x of shown){const t=x.theme||'';if(!m.has(t))m.set(t,[]);m.get(t)!.push(x);}return [...m.entries()];},[shown]);
 const flat=useMemo(()=>groups.flatMap(([,l])=>l),[groups]);
 useEffect(()=>{if(!open)return;const i=flat.findIndex(x=>x.key===value);setActive(q?0:Math.max(0,i));},[q,open]);// eslint-disable-line react-hooks/exhaustive-deps
 useEffect(()=>{if(!open)return;input.current?.focus();
  const away=(e:MouseEvent)=>{if(root.current&&!root.current.contains(e.target as Node))close();};
  document.addEventListener('mousedown',away);return ()=>document.removeEventListener('mousedown',away);},[open]);// eslint-disable-line react-hooks/exhaustive-deps
 useEffect(()=>{if(open)list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({block:'nearest'});},[active,open]);
 function close(){setOpen(false);setQ('');}
 function pick(key:string){close();if(key!==value)onChange(key);}
 const key=(e:React.KeyboardEvent)=>{
  if(e.key==='ArrowDown'){e.preventDefault();setActive(a=>Math.min(flat.length-1,a+1));}
  else if(e.key==='ArrowUp'){e.preventDefault();setActive(a=>Math.max(0,a-1));}
  else if(e.key==='Home'&&!q){e.preventDefault();setActive(0);}
  else if(e.key==='End'&&!q){e.preventDefault();setActive(flat.length-1);}
  else if(e.key==='Enter'){e.preventDefault();const x=flat[active];if(x)pick(x.key);}
  else if(e.key==='Escape'){e.preventDefault();close();root.current?.querySelector<HTMLButtonElement>('.wf-crit-button')?.focus();}
  else if(e.key==='Tab')close();};
 let i=-1;
 return <div className="wf-rank-select wf-crit" ref={root}>
  <span id={id+'-l'}>{label}</span>
  <button type="button" className="wf-crit-button" aria-haspopup="listbox" aria-expanded={open} aria-labelledby={id+'-l '+id+'-b'} id={id+'-b'}
   onClick={()=>open?close():setOpen(true)} onKeyDown={e=>{if(!open&&(e.key==='ArrowDown'||e.key==='ArrowUp')){e.preventDefault();setOpen(true);}}}>
   <span className="wf-crit-value">{current?.label||value}</span><ChevronDown size={14} aria-hidden/>
  </button>
  <div className="wf-crit-panel" hidden={!open}>
   <label className="wf-crit-search"><Search size={14} aria-hidden/>
    <input ref={input} type="text" value={q} placeholder={placeholder} role="combobox" aria-expanded={open} aria-controls={id+'-list'} aria-autocomplete="list"
     aria-activedescendant={flat[active]?id+'-o'+active:undefined} onChange={e=>setQ(e.target.value)} onKeyDown={key}/>
    {q&&<span className="wf-crit-count">{shown.length}</span>}
   </label>
   <div className="wf-crit-list" role="listbox" id={id+'-list'} aria-labelledby={id+'-l'} ref={list}>
    {groups.map(([theme,l])=><div key={theme||'-'} role="group" aria-label={theme||undefined}>
     {theme&&<div className="wf-crit-group" aria-hidden>{theme}</div>}
     {l.map(x=>{i++;const n=i;return <div key={x.key} id={id+'-o'+n} data-i={n} role="option" aria-selected={x.key===value}
      className={'wf-crit-option'+(n===active?' active':'')+(x.key===value?' on':'')} onMouseMove={()=>setActive(n)} onMouseDown={e=>e.preventDefault()} onClick={()=>pick(x.key)}>
      <span>{x.label}</span>{x.key===value&&<Check size={14} aria-hidden/>}</div>;})}
    </div>)}
    {!flat.length&&<div className="wf-crit-empty">{empty}</div>}
   </div>
  </div>
 </div>;
}
