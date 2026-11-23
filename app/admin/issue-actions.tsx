'use client';
import {useState} from 'react';
// Resolve, ignore or reopen an issue, with a note that stays on its record.
export function IssueActions({id,status}:{id:number;status:string}){
 const [note,setNote]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const send=async(next:'resolved'|'ignored'|'open')=>{
  setBusy(true);setError('');
  try{const r=await fetch('/api/admin/issues',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,status:next,resolution:note})});
   if(!r.ok)throw Error(((await r.json().catch(()=>({}))) as {error?:string}).error||'Could not save.');location.reload();}
  catch(e){setError((e as Error).message);setBusy(false);}
 };
 return <div className="adm-actions">
  {status==='open'?<>
   <input value={note} onChange={e=>setNote(e.target.value)} placeholder="What was done (kept on the record)" maxLength={2000}/>
   <button type="button" disabled={busy} onClick={()=>send('resolved')}>Resolved</button>
   <button type="button" disabled={busy} className="quiet" onClick={()=>send('ignored')}>Ignore</button>
  </>:<button type="button" disabled={busy} className="quiet" onClick={()=>send('open')}>Reopen</button>}
  {error&&<span className="adm-error" role="alert">{error}</span>}
 </div>;
}
