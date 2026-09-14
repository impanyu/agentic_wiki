'use client';
import {useEffect,useState,useRef} from 'react';
import type {AnswerPage} from '@/app/page-types';
import type {Parameters} from './contracts';
export function ComponentForm({page,onResult}:{page:AnswerPage;onResult:(page:AnswerPage)=>void}){
 const request=useRef<AbortController|null>(null);useEffect(()=>()=>request.current?.abort(),[]);
 const form=page.dynamic!.form!;
 const [input,setInput]=useState<Parameters>(page.parameters||{}),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{setInput(page.parameters||{});},[page.parameters]);
 async function submit(event:React.FormEvent){event.preventDefault();setBusy(true);setError('');const controller=new AbortController();request.current=controller;try{const r=await fetch('/api/pages/'+page.id+'/run',{signal:controller.signal,method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});const d=await r.json() as {error?:string;page:AnswerPage};if(!r.ok)throw new Error(d.error);if(!controller.signal.aborted)onResult(d.page);}catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:page.dynamic!.labels.invalid);}finally{setBusy(false);}}
 return <section className="component-form"><form onSubmit={submit}>{form.fields.map(f=><label key={f.name}>{f.label}<input required type={f.type==='number'?'number':'text'} step="any" value={String(input[f.name]??'')} onChange={e=>setInput({...input,[f.name]:f.type==='number'&&e.target.value!==''?Number(e.target.value):e.target.value})}/></label>)}<button disabled={busy} type="submit">{busy?'…':form.submit}</button></form>{error&&<p role="alert">{error}</p>}{page.applicationResult&&<dl className="component-results">{form.outputs.map(o=><div key={o.name}><dt>{o.label}</dt><dd>{typeof page.applicationResult![o.name]==='number'?new Intl.NumberFormat(page.language,{maximumSignificantDigits:12}).format(Number(page.applicationResult![o.name])):String(page.applicationResult![o.name]??'')}</dd></div>)}</dl>}</section>;
}
