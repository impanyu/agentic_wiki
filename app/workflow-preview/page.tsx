'use client';
import {useEffect,useMemo,useState} from 'react';
import {WorkflowApp} from '@/app/workflows/app';
import type {Workflow} from '@/app/workflows/schema';
import {demoWorkflow} from '@/app/workflows/demo';
import {usePageUi,UiContext} from '@/app/i18n/client';
// Renders a verification snapshot of a workflow app (see app/workflows/verify.ts) as the
// page owner sees it; nothing runs here, so upload and action controls are only drawn.
export default function WorkflowPreview(){
 const [data,setData]=useState<{workflow:Workflow;state:Record<string,unknown>;values:Record<string,unknown>;title:string;pageId:string;language?:string}|null>(null),[error,setError]=useState('');
 useEffect(()=>{const q=new URLSearchParams(location.search);if(q.get('demo')&&process.env.NODE_ENV!=='production'){setData({workflow:demoWorkflow,state:demoWorkflow.state,values:{},title:'Component gallery',pageId:'demo',language:q.get('lang')||'en'});return;}const token=q.get('token')||'';fetch('/api/workflow-preview/'+encodeURIComponent(token)).then(r=>r.ok?r.json():Promise.reject(Error('Preview expired.'))).then(d=>setData(d as typeof data),e=>setError(e.message));},[]);
 // Shown in the page's language, as readers of the page see it.
 const ui=usePageUi(data?.language||'en');
 // The development gallery runs like a live page (its load action runs); verification snapshots do not.
 const snapshot=useMemo(()=>data&&data.pageId!=='demo'?{state:data.state,values:data.values}:undefined,[data]);
 if(error)return <p role="alert">{error}</p>;
 if(!data)return <p role="status">Loading…</p>;
 return <UiContext.Provider value={ui}><main lang={ui.locale} style={{padding:'16px',maxWidth:1280,margin:'0 auto'}}><h1 style={{fontSize:'1.6rem',margin:'0 0 8px'}}>{data.title}</h1><WorkflowApp workflow={data.workflow} pageId={data.pageId} title={data.title} writable snapshot={snapshot}/></main></UiContext.Provider>;
}
