'use client';
import {useUi} from '@/app/i18n/client';
import {useEffect,useState} from 'react';
import {FileBrowser} from '@/app/templates/file-browser';
type Folder={id:string;name:string;url:string;modifiedTime?:string;parents?:string[]};
export function DriveFolders({pageId,labels}:{pageId:string;labels:Record<string,string>}){
 const {t,locale}=useUi();

 const [origin,setOrigin]=useState('');
 const [status,setStatus]=useState<{configured:boolean;connected:boolean;signedIn:boolean}|null>(null),[folders,setFolders]=useState<Folder[]>([]),[cursor,setCursor]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[incomplete,setIncomplete]=useState(false);
 async function api(path:string,method='GET',body?:unknown){const r=await fetch(path,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});const data=await r.json() as any;if(!r.ok)throw Error(data.error||'Drive request failed');return data;}
 async function loadFolders(next?:string){const data=await api('/api/connections/google-drive/folders'+(next?'?pageToken='+encodeURIComponent(next):''));setFolders(old=>next?[...new Map([...old,...data.folders].map(f=>[f.id,f])).values()]:data.folders);setCursor(data.nextPageToken);setIncomplete(data.incomplete);}
 async function refresh(){setBusy(true);setError('');try{const data=await api('/api/connections/google-drive');setStatus(data);if(data.connected)await loadFolders();else{setFolders([]);setCursor(null);}}catch(e){setError(e instanceof Error?e.message:'Google Drive unavailable');}finally{setBusy(false);}}
 useEffect(()=>{setOrigin(window.location.origin);void refresh().then(()=>{const result=new URL(window.location.href).searchParams.get('drive');if(result==='denied'||result==='failed')setError(result==='denied'?'Google Drive authorization was cancelled.':'Google Drive could not connect. Check the server configuration and try again.');});},[pageId]);
 async function connect(){setBusy(true);setError('');try{const data=await api('/api/connections/google-drive/start','POST',{returnTo:'/?page='+encodeURIComponent(pageId)});window.location.assign(data.url);}catch(e){setError(String(e));setBusy(false);}}
 async function more(){setBusy(true);try{await loadFolders(cursor!);}catch(e){setError(String(e));}finally{setBusy(false);}}
 return <section className="drive-folders"><div className="drive-controls"><button disabled={busy} onClick={()=>void refresh()}>{labels.refresh}</button>{status?.configured&&status.signedIn&&<button disabled={busy} onClick={()=>status.connected?void (async()=>{try{await api('/api/connections/google-drive','DELETE');await refresh();}catch(e){setError(String(e));}})():void connect()}>{status.connected?labels.disconnect:labels.connect}</button>}</div>
 {error&&<p role="alert">{t(error)}</p>}{status&&!status.signedIn&&<p>{labels.signIn}</p>}{status&&!status.configured&&<div className="drive-setup"><p>{labels.setup}</p><details><summary>{t("Google OAuth setup")}</summary><p>{t("Enable the Google Drive API, configure a Web application OAuth client, and set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_TOKEN_ENCRYPTION_KEY on the server.")}</p><p>{t("Authorized redirect URI:")}</p><code>{origin}{"/api/connections/google-drive/callback"}</code><p>{t("Scope: drive.file. Add your Google account as a test user while the consent screen is in testing.")}</p></details></div>}
 {busy&&<p role="status">{labels.loading}</p>}{status?.connected&&!busy&&!folders.length&&!error&&<p>{labels.empty}</p>}{status?.connected&&<FileBrowser title={labels.title||t("Google Drive")} items={folders.map(f=>({...f,kind:'folder' as const}))}/>}{incomplete&&<p>{t("Google returned a partial search result.")}</p>}{cursor&&<button disabled={busy} onClick={()=>void more()}>{labels.more}</button>}
 </section>;
}
