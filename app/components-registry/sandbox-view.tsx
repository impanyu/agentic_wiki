 'use client';
import {useMemo,useEffect,useRef} from 'react';
import {sandboxDocument,type SandboxDefinition} from './sandbox-contracts';
export function SandboxView({app,title,pageId,preview}:{app:SandboxDefinition;title:string;pageId?:string;preview?:{pageId:string;draftId:string}}){
 const frame=useRef<HTMLIFrameElement>(null),document=useMemo(()=>sandboxDocument(app),[app]);
 useEffect(()=>{const controller=new AbortController();let inflight=0;const seen=new Set<string>();
 const receive=async(e:MessageEvent)=>{if(e.source!==frame.current?.contentWindow||e.data?.type!=='page-tool-call')return;
 const {id,name,args}=e.data;if(typeof id!=='string'||id.length>100||typeof name!=='string'||seen.has(id))return;seen.add(id);
 const send=(data:unknown)=>{if(!controller.signal.aborted)frame.current?.contentWindow?.postMessage({type:'page-tool-result',id,...data as object},'*');};
 // An unsaved proposal may run its own proposed backend (writes are skipped); other tools stay off.
 if(!pageId&&preview&&name==='run_page'){const a=(args&&typeof args==='object'?args:{}) as Record<string,unknown>;try{const response=await fetch('/api/pages/'+encodeURIComponent(preview.pageId)+'/preview-run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({draftId:preview.draftId,...(typeof a.query==='string'?{query:a.query}:{}),values:a.values&&typeof a.values==='object'?a.values:{},...(a.submitted===true?{submitted:true}:{}),...(typeof a.message==='string'&&a.message?{message:a.message}:{}),...(typeof a.parent==='string'?{parent:a.parent}:{}),...(typeof a.cursor==='string'?{cursor:a.cursor}:{})}),signal:controller.signal});const result=await response.json() as {error?:string};if(!response.ok)throw Error(result.error||'Preview failed.');send({result});}catch(error){send({error:error instanceof Error?error.message:'Preview failed.'});}return;}
 if(!pageId){send({error:'Tools are disabled in unsaved previews.'});return;}if(seen.size>5000){send({error:'This panel has made too many tool calls. Reload the page to continue.'});return;}
 // Extra calls wait for a free slot instead of failing, so a panel can request many at once.
 while(inflight>=6){await new Promise(resolve=>setTimeout(resolve,50));if(controller.signal.aborted)return;}
 inflight++;try{
 // run_page runs this page's own backend program, like the built-in view's refresh.
 if(name==='run_page'){const a=(args&&typeof args==='object'?args:{}) as Record<string,unknown>;const response=await fetch('/api/pages/'+encodeURIComponent(pageId)+'/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:typeof a.query==='string'?a.query:'',values:a.values&&typeof a.values==='object'?a.values:{},...(a.submitted===true?{submitted:true}:{}),...(typeof a.message==='string'&&a.message?{message:a.message}:{}),...(typeof a.parent==='string'?{parent:a.parent}:{}),...(typeof a.cursor==='string'?{cursor:a.cursor}:{})}),signal:controller.signal});const data=await response.json() as {page?:{view?:unknown;runtimeError?:string;proposals?:unknown};error?:string};if(!response.ok||!data.page)throw Error(data.error||'The page program could not run.');send({result:{view:data.page.view??null,runtimeError:data.page.runtimeError??null,proposals:data.page.proposals??[]}});return;}
 const response=await fetch('/api/pages/'+encodeURIComponent(pageId)+'/code-tools',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,args}),signal:controller.signal});const result=await response.json() as {error?:string};if(!response.ok)throw Error(result.error||'Tool failed.');send({result});}catch(error){send({error:error instanceof Error?error.message:'Tool failed.'});}finally{inflight--;}};
 window.addEventListener('message',receive);return()=>{controller.abort();window.removeEventListener('message',receive);};},[pageId,document,preview?.pageId,preview?.draftId]);
 return <iframe ref={frame} title={title} sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={document} style={{width:'100%',height:app.height,border:'1px solid #dce2ea',borderRadius:12,background:'white',margin:'24px 0'}}/>;
}
