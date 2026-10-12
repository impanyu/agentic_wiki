'use client';
import {Fragment,useCallback,useEffect,useRef,useState,type ReactNode} from 'react';
import {StorageProposal} from '@/app/storage/panel';
import {useUi} from '@/app/i18n/client';
import {resolve,bindingsIn} from './expressions';
import {isBinding,type Workflow,type WorkflowNode,type RunTrace} from './schema';
import {COMPONENTS,INPUT_TYPES} from './catalog';
import {runClientAction} from './client-run';
import {renderComponent,type Ctx} from './components';
import './style.css';
// Renders a workflow app with the site's own components. Actions run on the
// server (/api/pages/<id>/workflow); bindings are evaluated here for display.
type Resolved={props:Record<string,any>;visible:boolean};
function walk(nodes:WorkflowNode[],fn:(n:WorkflowNode)=>void){for(const n of nodes){fn(n);if(n.children)walk(n.children,fn);}}
function staticResolve(ui:WorkflowNode[]){const map=new Map<WorkflowNode,Resolved>();let dynamic=false;walk(ui,n=>{if(bindingsIn(n.props).length||n.visible!==undefined)dynamic=true;map.set(n,{props:(n.props||{}) as Record<string,any>,visible:true});});return dynamic?null:map;}
export function WorkflowApp({workflow,pageId,title,writable,draftId,snapshot,renderArticle,preloaded}:{workflow:Workflow;pageId:string;title:string;writable:boolean;draftId?:string;snapshot?:{state:Record<string,unknown>;values:Record<string,unknown>};renderArticle?:()=>ReactNode;preloaded?:Record<string,unknown>}){
 const {locale,t}=useUi();
 const [state,setState]=useState<Record<string,unknown>>(()=>({...workflow.state,...(preloaded||{})}));
 const [values,setValues]=useState<Record<string,unknown>>({});
 const [running,setRunning]=useState<Record<string,boolean>>({}),[errors,setErrors]=useState<Record<string,string>>({}),[traces,setTraces]=useState<Record<string,RunTrace[]>>({});
 const [proposals,setProposals]=useState<{actionId:string;request:unknown}[]>([]);
 // Binding-free pages (such as a plain wiki article) render on the first paint.
 const [resolved,setResolved]=useState<Map<WorkflowNode,Resolved>|null>(()=>staticResolve(workflow.ui)),[bindingErrors,setBindingErrors]=useState<string[]>([]);
 const synced=useRef<Record<string,string>>({});
 const live=useRef({state,values});live.current={state,values};
 // Input defaults become initial values (bindings in defaults are resolved once).
 useEffect(()=>{let cancelled=false;void (async()=>{const init:Record<string,unknown>={};const scope={state:workflow.state,values:{},page:{id:pageId,title}};const tasks:Promise<void>[]=[];walk(workflow.ui,n=>{const d=(n.props as any)?.default;if(n.id&&d!==undefined)tasks.push(resolve(d,scope).then(v=>{init[n.id!]=v;},()=>{}));if(n.id&&d===undefined&&['file_upload','resource_picker'].includes(n.type))init[n.id]=[];});await Promise.all(tasks);if(!cancelled){synced.current={};setState(snapshot?.state??{...workflow.state,...(preloaded||{})});setValues({...init,...(snapshot?.values||{})});}})();return()=>{cancelled=true;};},[workflow,pageId,title,snapshot]);
 useEffect(()=>{let cancelled=false;void (async()=>{
  const map=new Map<WorkflowNode,Resolved>(),problems:string[]=[],scope={state,values,running,errors,page:{id:pageId,title}};
  const safe=async(v:unknown,where:string)=>{try{return await resolve(v,scope);}catch(e){problems.push(where+': '+(e instanceof Error?e.message:'error'));return undefined;}};
  const visit=async(n:WorkflowNode,path:string)=>{const props=(await safe(n.props||{},path) as Record<string,any>)||{};const visible=n.visible===undefined?true:!!(isBinding(n.visible)?await safe(n.visible,path+'.visible'):n.visible);map.set(n,{props,visible});await Promise.all((n.children||[]).map((c,i)=>visit(c,path+'.'+i)));};
  await Promise.all(workflow.ui.map((n,i)=>visit(n,String(i))));
  if(cancelled)return;setResolved(map);setBindingErrors(problems.slice(0,8));
  // Inputs with a value binding follow it: a changed result replaces what the field shows.
  const updates:Record<string,unknown>={};for(const [n,r] of map){if(!n.id||!INPUT_TYPES.has(n.type)||!n.props||!('value' in n.props)||r.props.value==null)continue;const key=JSON.stringify(r.props.value);if(synced.current[n.id]===key)continue;synced.current[n.id]=key;updates[n.id]=r.props.value;}
  if(Object.keys(updates).length)setValues(v=>({...v,...updates}));
 })();return()=>{cancelled=true;};},[workflow,state,values,running,errors,pageId,title]);
 const run=useCallback(async(action:string,event:unknown)=>{
  setRunning(r=>({...r,[action]:true}));setErrors(e=>{const {[action]:_gone,...rest}=e;return rest;});
  try{
   // Pure calculations run here in the browser; everything else goes to the server executor.
   if(workflow.actions[action]?.client){const r=await runClientAction(workflow,action,{state:live.current.state,values:live.current.values,event},{id:pageId,title});setState(r.state);setTraces(t=>({...t,[action]:r.trace}));if(r.error)setErrors(e=>({...e,[action]:r.error!}));return;}
   const response=await fetch('/api/pages/'+encodeURIComponent(pageId)+'/workflow',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,state:live.current.state,values:live.current.values,event,...(draftId?{draftId}:{})})});
   const data=await response.json() as {state?:Record<string,unknown>;trace?:RunTrace[];proposals?:{actionId:string;request:unknown}[];error?:string};
   if(!response.ok&&!data.state)throw Error(data.error||t('The action could not run.'));
   if(data.state)setState(data.state);setTraces(t=>({...t,[action]:data.trace||[]}));
   if(data.proposals?.length)setProposals(p=>[...p,...data.proposals!.filter(x=>!p.some(y=>y.actionId===x.actionId))]);
   if(data.error)setErrors(e=>({...e,[action]:data.error!}));
  }catch(e){setErrors(x=>({...x,[action]:e instanceof Error?e.message:t('The action failed.')}));}
  finally{setRunning(r=>({...r,[action]:false}));}
 },[pageId,draftId,workflow,title,t]);
 const loaded=useRef<Workflow|null>(null);
 useEffect(()=>{if(snapshot||preloaded||loaded.current===workflow||!workflow.actions.load)return;loaded.current=workflow;const t=setTimeout(()=>void run('load',{type:'load'}),50);return()=>clearTimeout(t);},[workflow,run,snapshot]);
 const ctx:Ctx={pageId,writable,running,errors,traces,locale,t,state,renderArticle};
 const formValues=(n:WorkflowNode)=>{const out:Record<string,unknown>={};walk(n.children||[],c=>{if(c.id&&COMPONENTS[c.type]?.value)out[c.id]=live.current.values[c.id];});return out;};
 const render=(n:WorkflowNode,key:string):ReactNode=>{
  const r=resolved?.get(n);if(!r||!r.visible)return null;
  const value=n.id?(n.type==='form'?formValues(n):values[n.id]):undefined;
  const setValue=(v:unknown)=>{if(n.id)setValues(x=>({...x,[n.id!]:v}));};
  const fire=(event:string,payload?:unknown)=>{const action=n.on?.[event];if(!action)return;if(running[action])return;const body=n.type==='form'?formValues(n):payload;if(n.id&&payload!==undefined&&n.type!=='form')live.current={...live.current,values:{...live.current.values,[n.id]:payload}};void run(action,{type:event,source:n.id??n.type,value:body??null});};
  const children=(n.children||[]).map((c,i)=><Fragment key={i}>{render(c,key+'.'+i)}</Fragment>);
  return <Fragment key={key}>{renderComponent({node:n,props:r.props,raw:(n.props||{}) as Record<string,unknown>,value,setValue,fire,ctx,children})}</Fragment>;
 };
 const layout=workflow.layout||{};
 return <div className={'wf-app density-'+(layout.density||'normal')+(layout.plain?' plain':'')} style={layout.plain?undefined:{maxWidth:layout.maxWidth||1200,...(layout.accent?{['--wf-accent' as string]:layout.accent}:{})}}>
  {proposals.map(p=><StorageProposal key={p.actionId} {...p}/>)}
  {resolved?workflow.ui.map((n,i)=>render(n,String(i))):<p role="status" className="wf-muted">{t('Loading…')}</p>}
  {writable&&bindingErrors.length>0&&<details className="wf-binding-errors"><summary>{bindingErrors.length} display binding problem(s)</summary><ul>{bindingErrors.map((e,i)=><li key={i}><code>{e}</code></li>)}</ul></details>}
 </div>;
}
