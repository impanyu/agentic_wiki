'use client';
import {createContext,useContext,useEffect,useMemo,useState} from 'react';
import catalog from './catalog.json';
import zh from './zh-pairs.json';
import {translateUi} from './translate';
export type Translator=(text:string,values?:Record<string,string|number>)=>string;
const interpolate=(text:string,values?:Record<string,string|number>)=>text.replace(/\{(\w+)\}/g,(match,key)=>String(values?.[key]??match));
const defaultUi={locale:'en',t:((text,values)=>interpolate(text,values)) as Translator};
export const UiContext=createContext(defaultUi);
export function useUi(){return useContext(UiContext);}
const loaded=new Map<string,Record<string,string>>();const requests=new Map<string,Promise<Record<string,string>>>();
export function usePageUi(language:string){
 const locale=language==='und'?'en':language||'en';
 const [translations,setTranslations]=useState<{locale:string;data:Record<string,string>}>({locale,data:{}});
 useEffect(()=>{
  if(locale==='en'){setTranslations({locale,data:{}});return;}
  let active=true;setTranslations({locale,data:loaded.get(locale)||{}});
  if(!requests.has(locale))requests.set(locale,fetch('/api/ui-language',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({language:locale})}).then(async r=>{if(!r.ok)throw Error('UI translation unavailable');const data=await r.json() as Record<string,string>;loaded.set(locale,data);return data;}).catch(error=>{requests.delete(locale);throw error;}));
  void requests.get(locale)!.then(data=>{if(active)setTranslations({locale,data});}).catch(()=>{});
  return()=>{active=false;};
 },[locale]);
 return useMemo(()=>({locale,t:((text,values)=>{
  // Only registered UI text is translated; page content, names and inputs remain untouched.
  const dictionary=locale.startsWith('zh')?zh as Record<string,string>:{};
  return translateUi(text,catalog,{...dictionary,...(translations.locale===locale?translations.data:{})},values);
 }) as Translator}),[locale,translations]);
}
