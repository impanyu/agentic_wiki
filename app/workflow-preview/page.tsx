'use client';
import {useEffect,useMemo,useState} from 'react';
import {WorkflowApp} from '@/app/workflows/app';
import type {Workflow} from '@/app/workflows/schema';
import {demoWorkflow} from '@/app/workflows/demo';
// Renders a verification snapshot of a workflow app (see app/workflows/verify.ts) as the
// page owner sees it; nothing runs here, so upload and action controls are only drawn.
export default function WorkflowPreview(){
 const [data,setData]=useState<{workflow:Workflow;state:Record<string,unknown>;values:Record<string,unknown>;title:string;pageId:string}|null>(null),[error,setError]=useState('');
 useEffect(()=>{const q=new URLSearchParams(location.search);if(q.get('demo')&&process.env.NODE_ENV!=='production'){setData({workflow:demoWorkflow,state:demoWorkflow.state,values:{},title:'Component gallery',pageId:'demo'});return;}const token=q.get('token')||'';fetch('/api/workflow-preview/'+encodeURIComponent(token)).then(r=>r.ok?r.json():Promise.reject(Error('Preview expired.'))).then(d=>setData(d as typeof data),e=>setError(e.message));},[]);
 const snapshot=useMemo(()=>data?{state:data.state,values:data.values}:undefined,[data]);
 if(error)return <p role="alert">{error}</p>;
 if(!data)return <p role="status">Loading…</p>;
 return <main style={{padding:'16px',maxWidth:1280,margin:'0 auto'}}><h1 style={{fontSize:'1.6rem',margin:'0 0 8px'}}>{data.title}</h1><WorkflowApp workflow={data.workflow} pageId={data.pageId} title={data.title} writable snapshot={snapshot}/></main>;
}
