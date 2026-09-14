'use client';
import {useEffect,useRef,useState} from 'react';
import {ArrowRightLeft,ArrowRight,LoaderCircle} from 'lucide-react';
import type {AnswerPage} from '@/app/page-types';
import {units,defaultInput,type UnitId} from './units';
export function UnitConverter({page,onResult}:{page:AnswerPage;onResult:(page:AnswerPage)=>void}){
 const labels=page.dynamic!.labels,initial=page.runtime?.input||defaultInput;
 const [value,setValue]=useState(String(initial.value)),[from,setFrom]=useState<UnitId>(initial.from),[to,setTo]=useState<UnitId>(initial.to);
 const [pending,setPending]=useState(false),[error,setError]=useState(page.runtimeError||'');
 const controller=useRef<AbortController|null>(null);
 useEffect(()=>()=>controller.current?.abort(),[]);
 const group=units.find(u=>u.id===from)!.group;
 function changeFrom(id:UnitId){setFrom(id);const nextGroup=units.find(u=>u.id===id)!.group;if(units.find(u=>u.id===to)!.group!==nextGroup)setTo(units.find(u=>u.group===nextGroup&&u.id!==id)!.id);}
 async function calculate(){
  if(!value.trim()||!Number.isFinite(Number(value))){setError(labels.invalid);return;}
  controller.current?.abort();const request=new AbortController();controller.current=request;setPending(true);setError('');
  try{const response=await fetch('/api/pages/'+encodeURIComponent(page.id)+'/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({value:Number(value),from,to}),signal:request.signal});const data=await response.json() as {page?:AnswerPage;error?:string};if(!response.ok||!data.page)throw new Error(data.error||labels.unavailable);if(!request.signal.aborted)onResult(data.page);
  }catch(e){if(!request.signal.aborted)setError(e instanceof Error?e.message:labels.unavailable);}finally{if(!request.signal.aborted)setPending(false);}
 }
 const groups=[...new Set(units.map(u=>u.group))];
 const result=page.runtime,formatted=(n:number)=>new Intl.NumberFormat(page.language==='und'?'en':page.language,{maximumSignificantDigits:12}).format(n);
 const unchanged=result&&Number(value)===result.input.value&&from===result.input.from&&to===result.input.to;
 return <section className="converter" aria-label={page.title}>
  <form onSubmit={e=>{e.preventDefault();void calculate();}}>
   <label className="converter-value">{labels.value}<input type="number" step="any" required value={value} onChange={e=>setValue(e.target.value)} /></label>
   <div className="converter-units"><label>{labels.from}<select value={from} onChange={e=>changeFrom(e.target.value as UnitId)}>{groups.map(category=><optgroup key={category} label={labels[category]}>{units.filter(u=>u.group===category).map(unit=><option key={unit.id} value={unit.id}>{unit.symbol}</option>)}</optgroup>)}</select></label>
    <button type="button" className="converter-swap" aria-label={labels.swap} title={labels.swap} onClick={()=>{setFrom(to);setTo(from);}}><ArrowRightLeft size={18}/></button>
    <label>{labels.to}<select value={to} onChange={e=>setTo(e.target.value as UnitId)}>{units.filter(u=>u.group===group).map(unit=><option key={unit.id} value={unit.id}>{unit.symbol}</option>)}</select></label></div>
   <button type="submit" className="converter-submit" disabled={pending}>{pending?<LoaderCircle className="spinner" size={17}/>:<ArrowRight size={17}/>} {pending?labels.working:labels.convert}</button>
  </form>
  {error&&<p className="converter-error" role="alert">{error}</p>}
  <div className="converter-result" aria-live="polite">{unchanged?<><span>{labels.result}</span><p><span dir="ltr">{formatted(result.input.value)} {result.fromSymbol}</span><span aria-hidden="true"> = </span><strong dir="ltr">{formatted(result.value)} {result.toSymbol}</strong></p></>:<p className="converter-placeholder">{labels.choose}</p>}</div>
 </section>;
}
