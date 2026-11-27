'use client';
import {useState} from 'react';
// Readers report a wrong value, a missing entry or a page problem (or ask for something to be taken down). The report
// goes to the work queue: the collectors check data, the editors fix pages, takedowns go to the operators.
export default function ReportProblem({labels}:{labels:{open:string;placeholder:string;send:string;sent:string;takedown:string;failed:string}}){
 const [open,setOpen]=useState(false),[text,setText]=useState(''),[takedown,setTakedown]=useState(false),[state,setState]=useState<'idle'|'sending'|'sent'|'failed'>('idle');
 if(state==='sent')return <p className="report-problem report-problem-sent">{labels.sent}</p>;
 if(!open)return <p className="report-problem"><button type="button" className="report-problem-open" onClick={()=>setOpen(true)}>{labels.open}</button></p>;
 const send=async()=>{
  if(text.trim().length<5)return;setState('sending');
  const r=await fetch('/api/report',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({path:location.pathname,kind:takedown?'takedown':'error',text:text.trim().slice(0,4000)})}).catch(()=>null);
  setState(r?.ok?'sent':'failed');
 };
 return <form className="report-problem report-problem-form" onSubmit={e=>{e.preventDefault();void send();}}>
  <textarea value={text} onChange={e=>setText(e.target.value)} placeholder={labels.placeholder} rows={3} maxLength={4000} required/>
  <label className="report-problem-takedown"><input type="checkbox" checked={takedown} onChange={e=>setTakedown(e.target.checked)}/> {labels.takedown}</label>
  <button type="submit" disabled={state==='sending'||text.trim().length<5}>{labels.send}</button>
  {state==='failed'&&<span className="report-problem-error">{labels.failed}</span>}
 </form>;
}
