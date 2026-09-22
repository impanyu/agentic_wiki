 'use client';
import {useMemo,useEffect,useRef} from 'react';
import {sandboxDocument,type SandboxDefinition} from './sandbox-contracts';
export function SandboxView({app,title,pageId}:{app:SandboxDefinition;title:string;pageId?:string}){
 const frame=useRef<HTMLIFrameElement>(null),document=useMemo(()=>sandboxDocument(app),[app]);
 useEffect(()=>{const controller=new AbortController();let inflight=0;const seen=new Set<string>();
 const receive=async(e:MessageEvent)=>{if(e.source!==frame.current?.contentWindow||e.data?.type!=='page-tool-call')return;
 const {id,name,args}=e.data;if(typeof id!=='string'||id.length>100||typeof name!=='string'||seen.has(id))return;seen.add(id);
 const send=(data:unknown)=>{if(!controller.signal.aborted)frame.current?.contentWindow?.postMessage({type:'page-tool-result',id,...data as object},'*');};
 if(!pageId){send({error:'Tools are disabled in unsaved previews.'});return;}if(inflight>=4||seen.size>500){send({error:'Too many tool calls. Wait for pending calls to finish.'});return;}
 inflight++;try{const response=await fetch('/api/pages/'+encodeURIComponent(pageId)+'/code-tools',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,args}),signal:controller.signal});const result=await response.json() as {error?:string};if(!response.ok)throw Error(result.error||'Tool failed.');send({result});}catch(error){send({error:error instanceof Error?error.message:'Tool failed.'});}finally{inflight--;}};
 window.addEventListener('message',receive);return()=>{controller.abort();window.removeEventListener('message',receive);};},[pageId,document]);
 return <iframe ref={frame} title={title} sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={document} style={{width:'100%',height:app.height,border:'1px solid #dce2ea',borderRadius:12,background:'white',margin:'24px 0'}}/>;
}
