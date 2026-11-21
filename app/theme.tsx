'use client';
import {useEffect,useState} from 'react';
import {Moon,Sun} from 'lucide-react';
// Light and dark themes. The reader's choice is kept in localStorage ('rw-theme': light | dark); without one
// the system setting decides. <html data-theme> carries the theme; a cookie (rw-theme) tells the server, so
// later pages are rendered in it from the first byte (and their server-drawn charts match).
export type Theme='light'|'dark';
const KEY='rw-theme';

// Runs in <head> before the first paint: no flash of the wrong theme.
export const THEME_SCRIPT=`(function(){try{var s=localStorage.getItem('${KEY}');var t=s==='light'||s==='dark'?s:(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t;document.cookie='${KEY}='+t+';path=/;max-age=31536000;samesite=lax'}catch(e){}})();`;

const current=():Theme=>typeof document!=='undefined'&&document.documentElement.dataset.theme==='dark'?'dark':'light';

function apply(t:Theme,remember:boolean){
 const el=document.documentElement;el.dataset.theme=t;el.style.colorScheme=t;
 try{if(remember)localStorage.setItem(KEY,t);}catch{}
 document.cookie=`${KEY}=${t};path=/;max-age=31536000;samesite=lax`;
}

// The theme in effect, following changes (the toggle, or the system setting when the reader chose none).
export function useTheme():Theme{
 const [theme,setTheme]=useState<Theme>('light');
 useEffect(()=>{
  setTheme(current());
  const mo=new MutationObserver(()=>setTheme(current()));
  mo.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  const mq=matchMedia('(prefers-color-scheme: dark)');
  const onSystem=()=>{let chosen:string|null=null;try{chosen=localStorage.getItem(KEY);}catch{}if(chosen!=='light'&&chosen!=='dark')apply(mq.matches?'dark':'light',false);};
  mq.addEventListener('change',onSystem);
  return ()=>{mo.disconnect();mq.removeEventListener('change',onSystem);};
 },[]);
 return theme;
}

export function ThemeToggle({label='Switch theme'}:{label?:string}){
 const theme=useTheme();const next:Theme=theme==='dark'?'light':'dark';
 return <button type="button" className="theme-toggle" aria-label={label} title={label} onClick={()=>apply(next,true)}>
  <span className="theme-toggle-icon sun"><Sun size={17} aria-hidden="true"/></span>
  <span className="theme-toggle-icon moon"><Moon size={17} aria-hidden="true"/></span>
 </button>;
}
