'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Bot} from 'lucide-react';
import {useUi} from '@/app/i18n/client';

type Status={enabled:boolean;intervalHours:number;focus:string;running:boolean;lastRunAt:number|null;nextRunAt:number|null;lastStatus:string;lastSummary:string;canRevert:boolean;canEdit:boolean;runs:number};
const INTERVALS:[number,string][]=[[1,'Every hour'],[6,'Every 6 hours'],[12,'Every 12 hours'],[24,'Daily'],[72,'Every 3 days'],[168,'Weekly']];
const OUTCOMES:Record<string,string>={updated:'Updated the page',checked:'Checked, no changes needed',postponed:'Postponed',failed:'Run failed','not saved':'Change not saved',reverted:'Last change undone',stopped:'Stopped'};

// The page's long-running live agent: a switch, a frequency menu and a status line in the page
// toolbar. Readers see only whether the page is under live maintenance.
export function LiveAgentControl({pageId,disabled}:{pageId:string;disabled?:boolean}){
 const {t,locale}=useUi();
 const [status,setStatus]=useState<Status|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[open,setOpen]=useState(false),[focus,setFocus]=useState(''),[changed,setChanged]=useState(false);
 const wasRunning=useRef(false);
 const load=useCallback(async()=>{try{const r=await fetch('/api/pages/'+encodeURIComponent(pageId)+'/live-agent',{cache:'no-store'}),d=await r.json() as {liveAgent?:Status};if(d.liveAgent){if(wasRunning.current&&!d.liveAgent.running&&d.liveAgent.lastStatus==='updated')setChanged(true);wasRunning.current=d.liveAgent.running;setStatus(d.liveAgent);setFocus(d.liveAgent.focus);}}catch{}},[pageId]);
 useEffect(()=>{setStatus(null);setChanged(false);void load();},[load]);
 useEffect(()=>{if(!status?.enabled&&!status?.running)return;const timer=setInterval(()=>void load(),status.running?8000:60000);return ()=>clearInterval(timer);},[status?.enabled,status?.running,load]);
 const send=async(method:'PUT'|'POST',body:Record<string,unknown>)=>{setBusy(true);setError('');try{const r=await fetch('/api/pages/'+encodeURIComponent(pageId)+'/live-agent',{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),d=await r.json() as {liveAgent?:Status;error?:string};if(!r.ok||!d.liveAgent)throw Error(d.error||'Live agent update failed.');wasRunning.current=d.liveAgent.running;setStatus(d.liveAgent);if(body.action==='revert')setChanged(true);}catch(e){setError(e instanceof Error?e.message:'Live agent update failed.');}finally{setBusy(false);}};
 if(!status||(!status.canEdit&&!status.enabled))return null;
 const ago=(ms:number)=>{const m=Math.round((Date.now()-ms)/60000);return m<1?t('just now'):m<60?m+' '+t('min ago'):m<1440?Math.round(m/60)+' '+t('h ago'):Math.round(m/1440)+' '+t('d ago');};
 const until=(ms:number)=>{const m=Math.max(0,Math.round((ms-Date.now())/60000));return m<1?t('in under a minute'):m<60?t('in')+' '+m+' '+t('min'):m<1440?t('in')+' '+Math.round(m/60)+' '+t('h'):t('in')+' '+Math.round(m/1440)+' '+t('d');};
 const line=status.running?t('Live agent is working on this page now…'):status.enabled?[t('Under live agent maintenance'),status.lastRunAt?t('last run')+' '+ago(status.lastRunAt)+(status.lastStatus?' · '+t(OUTCOMES[status.lastStatus]||status.lastStatus):''):'',status.nextRunAt?t('next run')+' '+until(status.nextRunAt):''].filter(Boolean).join(' · '):t('Live agent off');
 return <div className={'live-agent'+(status.enabled?' on':'')+(status.running?' running':'')}>
  <div className="live-agent-row">
   {status.canEdit?<button type="button" role="switch" aria-checked={status.enabled} className="live-agent-switch" disabled={disabled||busy} onClick={()=>void send('PUT',{enabled:!status.enabled})} title={t('Turn the long-running live agent for this page on or off')}><Bot size={15}/><span>{t('Live agent')}</span><i aria-hidden="true"/></button>:<span className="live-agent-badge"><Bot size={15}/>{t('Live agent')}</span>}
   {status.canEdit&&<select aria-label={t('Live agent frequency')} value={status.intervalHours} disabled={disabled||busy} onChange={e=>void send('PUT',{intervalHours:Number(e.target.value)})}>{INTERVALS.map(([h,label])=><option key={h} value={h}>{t(label)}</option>)}</select>}
   <span className="live-agent-status" role="status">{line}</span>
   {status.canEdit&&<button type="button" className="live-agent-more" aria-expanded={open} onClick={()=>setOpen(!open)}>{open?t('Hide details'):t('Details')}</button>}
  </div>
  {changed&&<p className="live-agent-note">{t('The live agent changed this page.')} <button type="button" onClick={()=>location.reload()}>{t('Reload to see it')}</button></p>}
  {open&&status.canEdit&&<div className="live-agent-details">
   <div className="live-agent-actions"><button type="button" disabled={disabled||busy||status.running} onClick={()=>void send('POST',{action:'run'})}>{status.running?t('Running…'):t('Run now')}</button>{status.canRevert&&<button type="button" disabled={disabled||busy||status.running} onClick={()=>void send('POST',{action:'revert'})}>{t('Undo last change')}</button>}</div>
   <label>{t('Maintenance focus (optional)')}<textarea value={focus} maxLength={600} rows={2} placeholder={t('For example: keep prices current, check the ADAPT folders still load')} onChange={e=>setFocus(e.target.value)} onBlur={()=>{if(focus!==status.focus)void send('PUT',{focus});}}/></label>
   {status.lastSummary&&<div className="live-agent-summary"><strong>{t('Last run')}{status.lastRunAt?' · '+new Date(status.lastRunAt).toLocaleString(locale):''}</strong><p>{status.lastSummary}</p></div>}
   <small>{t('Each run uses this page’s agent with all its tools, appears in the page chat, and saves only changes that pass verification. You can undo the latest change.')}</small>
  </div>}
  {error&&<p role="alert" className="live-agent-error">{error}</p>}
 </div>;
}
