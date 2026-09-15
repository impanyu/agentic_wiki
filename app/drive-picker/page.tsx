'use client';
import {useEffect,useState} from 'react';
import {usePageUi} from '@/app/i18n/client';
let loader:Promise<void>|undefined;
function loadPicker(){
 return loader??=(new Promise<void>((resolve,reject)=>{
  const script=document.createElement('script');script.src='https://apis.google.com/js/api.js';script.async=true;
  script.onerror=()=>reject(Error('Could not load Google file picker.'));
  script.onload=()=>{(window as any).gapi.load('picker',{callback:resolve,onerror:()=>reject(Error('Could not load Google file picker.')),timeout:20000,ontimeout:()=>reject(Error('Could not load Google file picker.'))});};
  document.head.appendChild(script);
 }).catch(error=>{loader=undefined;throw error;}));
}
export default function DrivePickerPage(){
 const [lang,setLang]=useState('en'),[returnTo,setReturnTo]=useState('/');
 useEffect(()=>{const q=new URLSearchParams(location.search);setLang(q.get('language')||'en');const back=q.get('returnTo');if(back?.startsWith('/?'))setReturnTo(back);},[]);
 const {t,locale}=usePageUi(lang),[busy,setBusy]=useState(false),[error,setError]=useState(''),[selected,setSelected]=useState<string[]>([]);
 async function choose(){setBusy(true);setError('');try{
  await loadPicker();const r=await fetch('/api/storage/google/picker',{method:'POST'}),data=await r.json() as {token:string;developerKey:string;appId:string;error?:string};if(!r.ok)throw Error(data.error);
  const p=(window as any).google.picker;
  const picker=new p.PickerBuilder().addView(new p.DocsView(p.ViewId.DOCS).setIncludeFolders(true).setSelectFolderEnabled(false)).setOAuthToken(data.token).setDeveloperKey(data.developerKey).setAppId(data.appId).setOrigin(location.origin).setLocale(locale).enableFeature(p.Feature.MULTISELECT_ENABLED).setCallback((result:any)=>{
   if(result.action===p.Action.PICKED){setSelected((result.docs||[]).map((doc:any)=>String(doc.name||doc.id)));picker.dispose();setBusy(false);}
   else if(result.action===p.Action.CANCEL){picker.dispose();setBusy(false);}
  }).build();picker.setVisible(true);
 }catch(e){setError(e instanceof Error?e.message:'Could not open Google file picker.');setBusy(false);}}
 return <main style={{maxWidth:720,margin:'60px auto',padding:24}}><h1>{t('Choose Google Drive files to edit')}</h1><p>{t('The agent can read all your Google Drive files. Select files here to allow changes, which still require your confirmation. Selecting a file does not grant write access to its folder or other files.')}</p><button disabled={busy} onClick={()=>void choose()}>{t(busy?'Loading…':'Choose files')}</button>{error&&<p role="alert">{t(error)}</p>}{selected.length>0&&<><p>{t('Selected files can now be changed with your confirmation. Return to your page to continue.')}</p><ul>{selected.map((name,i)=><li key={i}>{name}</li>)}</ul></>}<p><a href={returnTo}>{t('Back to page')}</a></p></main>;
}
