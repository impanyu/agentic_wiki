'use client';
import {useEffect,useRef,useState} from 'react';
import {Languages,Check} from 'lucide-react';
import {useUi} from './client';
import {LOCALES,localePath,splitLocale} from './locales';
// The language menu: the same page in another language (its /<code>/ address). The choice is remembered
// (rw-lang cookie) for the visitor's next arrival at the home page.
export function LanguageSwitcher(){
 const {t,locale}=useUi();
 const [open,setOpen]=useState(false);const [here,setHere]=useState('/');
 const box=useRef<HTMLDivElement>(null);
 useEffect(()=>{setHere(splitLocale(location.pathname+location.search).path);},[]);
 useEffect(()=>{if(!open)return;
  const close=(e:MouseEvent|KeyboardEvent)=>{if(e instanceof KeyboardEvent?e.key==='Escape':!box.current?.contains(e.target as Node))setOpen(false);};
  document.addEventListener('mousedown',close);document.addEventListener('keydown',close);
  return ()=>{document.removeEventListener('mousedown',close);document.removeEventListener('keydown',close);};},[open]);
 const current=LOCALES.find(l=>l.code===locale)??LOCALES[0];
 return <div className="lang-menu" ref={box}>
  <button type="button" className="lang-toggle" aria-haspopup="menu" aria-expanded={open} aria-label={t('Language')+': '+current.name} title={t('Language')} onClick={()=>setOpen(o=>!o)}>
   <Languages size={17} aria-hidden="true"/><span>{current.code.toUpperCase()}</span>
  </button>
  {open&&<div className="lang-panel" role="menu">
   {LOCALES.map(l=><a key={l.code} role="menuitem" href={localePath(here,l.code)} hrefLang={l.code} lang={l.code} aria-current={l.code===locale?'true':undefined}
    onClick={()=>{document.cookie=`rw-lang=${l.code};path=/;max-age=31536000;samesite=lax`;}}>
    <span>{l.name}</span>{l.code===locale&&<Check size={15} aria-hidden="true"/>}
   </a>)}
  </div>}
 </div>;
}
