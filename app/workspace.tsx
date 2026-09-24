'use client';
import {MapPreference} from './geo/viewer';
import type {NavigationOrigin} from '@/app/routing/link-context';
import {ResourcePicker} from './resources/picker';
import {pageVisualProps} from './page-programs/visual-style';
import {usePageUi,UiContext} from '@/app/i18n/client';
import dynamic from 'next/dynamic';
const PageEditor=dynamic(()=>import('./page-editor/editor').then(m=>m.PageEditor),{ssr:false});
import {PageShare} from './page-share';
import {canWritePage,canUseConnectorsOn,pageAccess,type PageAccess} from './page-permissions';
import {DisambiguationIndex} from './disambiguation/view';
import {ProgramView} from './page-programs/view';
import {ConnectorPanel} from './connectors/panel';
import {ProcessingPanel} from './adma/processing-panel';
import {GeoViewer} from './geo/viewer';
import {ArcgisPublisher} from './arcgis-publisher/app';
import {Workbench} from './tools/workbench';
import {PaperWorkspace} from './papers/workspace';
import {nativePageSource} from './tools/sources';
import {AdmaApp} from './adma/app';
import {HccApp} from './hcc/app';
import {nativeWorkspaceApp,pageStorageProviders} from './storage/page-scope';
import {StoragePanel} from './storage/panel';
import {DriveFolders} from './connections/google-drive/view';
import {SandboxView} from './components-registry/sandbox-view';
import {Dashboard} from './templates/dashboard';
import {HistoryMenu,type HistoryEntry} from './history-menu';
import {ComponentForm} from './components-registry/form';
import {PageAgentChat} from './components-registry/page-chat';
import {VoiceInput} from './voice-input';
import {UnitConverter} from './dynamic/unit-converter';
import {pageAddress,inputQuery,type ConversionInput} from './dynamic/units';

import { useCallback, useEffect, useRef, useState } from 'react';
import { HomePage } from './home';
import { ArrowLeft, ArrowRight, Highlighter, Check, Globe2, Layers, LoaderCircle, LockKeyhole, GitFork, Trash2, Printer } from 'lucide-react';
import {ContextIndex} from './context-index/view';
import {ContextFiles} from './context-files/panel';
import type { AnswerPage } from './page-types';
import {AnswerText,type Highlight} from './answer-text';
import type {InternalLink} from './internal-links';
import {readEvents} from './event-stream';
import {navigationRequest,navigationError,waitForGenerationResult} from './navigation-request';

async function readResponse(response: Response) {
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('The server returned an unexpected response. Please try opening the page again.');
  }
  const result = await response.json() as {page:AnswerPage;reused?:boolean;question?:string;error?:string};
  if (!response.ok) throw new Error(result.error || 'Could not open this answer. Please try again.');
  return result;
}

export default function Workspace({ user, signIn, signOut }: {
  user: { name: string; id: string } | null;
  signIn: string;
  signOut: string;
}) {


  const [question, setQuestion] = useState('');
  const actorReady=useRef<Promise<void>|null>(null);
  function ensureActor(){return actorReady.current??=navigationRequest('/api/session').then(async response=>{if(!response.ok)throw new Error('Could not initialize the session.');await response.json();}).catch(error=>{actorReady.current=null;throw error;});}
  const [filesRevision,setFilesRevision]=useState(0);
  const [transferPage,setTransferPage]=useState<string|null>(null);
  const uploadInput=useRef<HTMLInputElement>(null);

  const [selected, setSelected] = useState<AnswerPage | null>(null);
  useEffect(()=>{setPending(null);},[selected?.id]);
  const [conceptStatus,setConceptStatus]=useState('');
  const [conceptAttempt,setConceptAttempt]=useState(0);
  const [concepts,setConcepts]=useState<Highlight[]>([]);
  useEffect(()=>{
    setConcepts([]);setConceptStatus('');if(!selected||selected.kind!=='static'||selected.labels.templateId==='disambiguation-v1')return;setConceptStatus('Preparing concept links…');
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
    async function load(attempt=0){try{const r=await fetch('/api/pages/'+selected!.id+'/concepts',{method:'POST',signal:controller.signal});if(!r.ok)throw Error('unavailable');const d=await r.json() as {concepts:Highlight[];retryAfter?:number};if(controller.signal.aborted)return;if(d.retryAfter&&attempt<25){timer=setTimeout(()=>void load(attempt+1),d.retryAfter*1000);return;}setConcepts(d.concepts||[]);setConceptStatus(d.concepts?.length?'Hover over concepts to see links.':d.retryAfter?'Concept links are still being prepared.':'No concept links detected.');}catch{if(!controller.signal.aborted)setConceptStatus('Concept links could not load.');}}
    void load();return()=>{controller.abort();clearTimeout(timer);};
  },[selected?.id,selected?.body,selected?.summary,conceptAttempt]);
  const [draft,setDraft]=useState<AnswerPage|null>(null);
  const [editing,setEditing]=useState(false);
  const ui=usePageUi((draft||selected)?.language||'en'),{t,locale}=ui;
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const article = useRef<HTMLDivElement>(null);
  const [highlights,setHighlights] = useState<Record<string,Highlight[]>>({});
  const [pending,setPending] = useState<Highlight|null>(null);
  const [historyPosition,setHistoryPosition] = useState(0);
  const [historyLength,setHistoryLength] = useState(1);
  const trail = useRef<{key:string;page:string|null;question:string;parameters?:import('./components-registry/contracts').Parameters}[]>([]);
  const position = useRef(0);
  const visitWrites=useRef<Promise<unknown>>(Promise.resolve());
  const [historySaveError,setHistorySaveError]=useState('');
  const failedVisits=useRef(new Map<string,{pageId:string;text:string;parameters?:import('./components-registry/contracts').Parameters;id:string;legacy:boolean}>());
  function saveVisit(pageId:string,text:string,parameters?:import('./components-registry/contracts').Parameters,id=crypto.randomUUID(),legacy=false){
    // Serialize writes so a guest receives one stable HttpOnly identity cookie.
    visitWrites.current=visitWrites.current.then(async()=>{
      await ensureActor();
      const response=await fetch('/api/history',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,pageId,question:text,parameters,legacy}),keepalive:true});
      // A visit the server rejects outright (deleted or private page, invalid entry) can never succeed; drop it.
      if(response.status>=400&&response.status<500){failedVisits.current.delete(id);if(!failedVisits.current.size)setHistorySaveError('');return;}
      if(!response.ok)throw new Error('Some visits could not be saved.');
      failedVisits.current.delete(id);if(!failedVisits.current.size)setHistorySaveError('');
    }).catch(()=>{if(!legacy){failedVisits.current.set(id,{pageId,text,parameters,id,legacy});setHistorySaveError('Some visits could not be saved.');}});
  }
  function recordHistory(page:string,text:string,parameters?:import('./components-registry/contracts').Parameters){
    const entry={key:crypto.randomUUID(),page,question:text,parameters};
    saveVisit(page,text,parameters,entry.key);
    trail.current=trail.current.slice(0,position.current+1).concat(entry);
    position.current=trail.current.length-1;
    setHistoryPosition(position.current);setHistoryLength(trail.current.length);
    history.pushState({question:text,samepageKey:entry.key},'', pageAddress(page,parameters));
    try{sessionStorage.setItem('samepage-navigation',JSON.stringify(trail.current));}catch{}
  }
  function captureSelection(){
    if(draft||selected?.kind==='resource'){setPending(null);return;}
    const selection=window.getSelection();if(!selection||!selection.rangeCount||selection.isCollapsed){setPending(null);return;}
    const range=selection.getRangeAt(0),root=article.current;
    if(!root?.contains(range.startContainer)||!root.contains(range.endContainer)){setPending(null);return;}
    const fragment=range.cloneContents();fragment.querySelectorAll('.citation,.sources,.wiki-contents,.internal-track').forEach(node=>node.remove());
    const quote=(fragment.textContent||'').trim();if(!quote||quote.length>4000){setPending(null);return;}
    const segments:Highlight['segments']=[];
    for(const span of root.querySelectorAll<HTMLElement>('[data-text-id]')){
      if(!range.intersectsNode(span))continue;
      let start=0,end=span.textContent?.length||0;
      if(span.contains(range.startContainer)){const prefix=document.createRange();prefix.selectNodeContents(span);prefix.setEnd(range.startContainer,range.startOffset);start=prefix.toString().length;}
      if(span.contains(range.endContainer)){const prefix=document.createRange();prefix.selectNodeContents(span);prefix.setEnd(range.endContainer,range.endOffset);end=prefix.toString().length;}
      if(end>start)segments.push({node:span.dataset.textId!,start,end});
    }
    setPending(segments.length?{quote,segments}:null);
  }
  function addHighlight(jump:boolean){
    if(!pending||!selected)return;
    const next=pending;
    setHighlights(all=>({...all,[selected.id]:[...(all[selected.id]||[]).filter(h=>JSON.stringify(h.segments)!==JSON.stringify(next.segments)),next]}));
    setPending(null);window.getSelection()?.removeAllRanges();
    if(jump)void navigate(next.quote,{pageId:selected.id,highlight:next});
  }
  const request = useRef<AbortController | null>(null);

  const captureRef=useRef(captureSelection);captureRef.current=captureSelection;
  useEffect(()=>{let timer:ReturnType<typeof setTimeout>;const update=()=>{clearTimeout(timer);timer=setTimeout(()=>captureRef.current(),80);};document.addEventListener('selectionchange',update);return()=>{clearTimeout(timer);document.removeEventListener('selectionchange',update);};},[]);

  const pendingRuntime=selected?.runtimePending?selected:undefined;
  useEffect(()=>{
    if(!pendingRuntime)return;
    const controller=new AbortController(),page=pendingRuntime;
    void fetch('/api/pages/'+encodeURIComponent(page.id)+'/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:page.parameters?.query,values:page.parameters||{}}),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(120000)])})
      .then(readResponse).then(result=>{if(!controller.signal.aborted)setSelected(current=>current===page?{...result.page,parameters:result.page.parameters||page.parameters,runtimePending:false}:current);})
      .catch(error=>{if(!controller.signal.aborted)setSelected(current=>current===page?{...current,runtimePending:false,runtimeError:navigationError(error,'Could not load application results. Use Refresh to retry.')}:current);});
    return ()=>controller.abort();
  },[pendingRuntime]);

  const restore = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const id = new URLSearchParams(location.search).get('page');
    setError('');
    setPending(null);
    const idx=trail.current.findIndex(entry=>entry.key===history.state?.samepageKey);
    if(idx>=0){position.current=idx;setHistoryPosition(idx);}
    setStatus('');
    setBusy(false);
    setSelected(null);setDraft(null);
    if (!id) { setQuestion('');void ensureActor().catch(()=>{}); return; }
    setBusy(true);
    try {
      await ensureActor();
      const result = await readResponse(await navigationRequest('/api/pages/' + encodeURIComponent(id)+'?defer=1&'+new URLSearchParams(location.search).toString(), {
        cache: 'no-store', signal: controller.signal,
      }));
      if (controller.signal.aborted) return;
      const text=typeof history.state?.question==='string'&&history.state.question.trim()?history.state.question:result.page.question||result.page.title;
      setSelected(result.page);setQuestion(text);
      saveVisit(result.page.id,text,(result.page.parameters||result.page.runtime?.input));
      if(result.page.id!==id){setStatus('Redirected to '+result.page.title);history.replaceState({...history.state,question:text},'', pageAddress(result.page.id,(result.page.parameters||result.page.runtime?.input)));}
    } catch (e) {
      if (!controller.signal.aborted) setError(navigationError(e,'Could not open this answer.'));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }, []);

  useEffect(() => {
    try{const stored=JSON.parse(sessionStorage.getItem('samepage-navigation')||'[]');if(Array.isArray(stored)&&stored.every(e=>typeof e.key==='string'&&typeof e.question==='string'))trail.current=stored;}catch{}
    for(const entry of trail.current){if(entry.page)saveVisit(entry.page,entry.question,entry.parameters,entry.key,true);}
    let idx=trail.current.findIndex(e=>e.key===history.state?.samepageKey);
    if(idx<0){const key=crypto.randomUUID(),entry={key,page:new URLSearchParams(location.search).get('page'),question:''};let previous=-1;try{const pending=JSON.parse(sessionStorage.getItem('samepage-link-navigation')||'null');sessionStorage.removeItem('samepage-link-navigation');if(pending&&Date.now()-pending.time<60000)previous=trail.current.findIndex(e=>e.key===pending.from);}catch{}trail.current=previous>=0?trail.current.slice(0,previous+1).concat(entry):[entry];history.replaceState({...history.state,samepageKey:key},'');idx=trail.current.length-1;}
    try{sessionStorage.setItem('samepage-navigation',JSON.stringify(trail.current));}catch{}
    position.current=idx;setHistoryPosition(idx);setHistoryLength(trail.current.length);
    const initialQuestion=new URLSearchParams(location.search).get('ask');if(initialQuestion&&!new URLSearchParams(location.search).has('page'))void navigate(initialQuestion);else void restore();
    const onHistory = () => { void restore(); };
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault(); input.current?.focus(); input.current?.select();
      }
    };
    const onPageLink=(event:MouseEvent)=>{if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;const anchor=(event.target as Element)?.closest?.('a[href]') as HTMLAnchorElement|null;if(!anchor||anchor.target&&anchor.target!=='_self'||anchor.hasAttribute('download'))return;const url=new URL(anchor.href,location.href);if(url.origin!==location.origin||!(['/maps','/tools'].includes(url.pathname)||url.pathname==='/'&&url.searchParams.has('page')))return;try{sessionStorage.setItem('samepage-link-navigation',JSON.stringify({from:history.state?.samepageKey,time:Date.now()}));}catch{}};
    window.addEventListener('click',onPageLink);
    window.addEventListener('popstate', onHistory);
    window.addEventListener('keydown', onShortcut);
    return () => {
      request.current?.abort();
      window.removeEventListener('click',onPageLink);
      window.removeEventListener('popstate', onHistory);
      window.removeEventListener('keydown', onShortcut);
    };
  }, [restore]);

  async function uploadFile(file:File){
    if(busy)return;if(file.size>10*1024*1024){setError('Choose a file up to 10 MB.');return;}
    setBusy(true);setError('');setStatus('Uploading '+file.name+'…');
    try{await ensureActor();await readResponse(await fetch('/api/components/upload',{method:'POST',headers:{'Content-Type':file.type||'application/octet-stream','X-File-Name':encodeURIComponent(file.name),...(!draft&&selected?{'X-Page-Id':selected.id}:{})},body:file}));setFilesRevision(n=>n+1);setStatus(file.name+(!draft&&selected?' added to this context.':' uploaded privately.'));}
    catch(error){setError(error instanceof Error?error.message:'Could not upload the file.');}finally{setBusy(false);if(uploadInput.current)uploadInput.current.value='';}
  }

  async function navigate(nextText = question,origin?:NavigationOrigin,fork?:{sourceId:string;requestId:string}) {
    const text = nextText.trim();
    if (!text || busy || editing) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    let cancelToken:string|undefined;
    const cancelGeneration=()=>{if(cancelToken)void fetch('/api/ask',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({cancelToken}),keepalive:true}).catch(()=>{});};
    controller.signal.addEventListener('abort',cancelGeneration,{once:true});
    setQuestion(text);setPending(null);setDraft(null);
    setBusy(true); setError(''); setStatus('Finding or creating your answer…');
    const generationId=crypto.randomUUID();let progressTimer:ReturnType<typeof setInterval>|undefined,readingProgress=false,progressFinished=false;
    try {
      await ensureActor();
      progressTimer=setInterval(()=>{if(readingProgress||controller.signal.aborted)return;readingProgress=true;
        void fetch('/api/ask?generationId='+generationId,{cache:'no-store',signal:controller.signal}).then(async response=>{
          if(!response.ok)return;const progress=await response.json() as Partial<AnswerPage>&{started?:boolean;cancelToken?:string;status?:string};if(controller.signal.aborted||progressFinished)return;
          if(progress.cancelToken)cancelToken=progress.cancelToken;
          if(progress.status)setStatus(progress.status);
          if(progress.started)setDraft({id:'draft',title:progress.title||text,summary:progress.summary||'',body:progress.body||'',language:progress.language||'en',labels:progress.labels||{},category:progress.category||'',visibility:'private',owned:false,createdAt:'',questionCount:0,sources:[]});
        }).catch(()=>{}).finally(()=>{readingProgress=false;});
      },800);
      let result:{page:AnswerPage;reused?:boolean;question?:string}|undefined;
      try{
      let response:Response;
      const waitingSince=Date.now();
      while(true){
        response=await fetch('/api/ask', {
          method:'POST',headers:{'Content-Type':'application/json','Accept':'text/event-stream'},
          body:JSON.stringify({question:text,fork,generationId,origin}),signal:controller.signal,
        });
        if(response.status!==409)break;
        const pending=await response.clone().json() as {retryAfter?:number};
        if(!pending.retryAfter||Date.now()-waitingSince>240000)break;
        await response.body?.cancel();
        setStatus('This question is being prepared. Opening it as soon as it is ready…');
        await new Promise<void>((resolve,reject)=>{
          const abort=()=>{clearTimeout(timer);reject(new DOMException('Aborted','AbortError'));};
          const timer=setTimeout(()=>{controller.signal.removeEventListener('abort',abort);resolve();},Math.min(pending.retryAfter!,5)*1000);
          if(controller.signal.aborted)abort();else controller.signal.addEventListener('abort',abort,{once:true});
        });
      }
      if(response.ok&&response.headers.get('content-type')?.includes('text/event-stream')){
        if(!response.body)throw new Error('The answer stream is unavailable. Please try again.');
        let body='',lastPaint=0;
        for await(const event of readEvents(response.body)){
          if(controller.signal.aborted)return;
          if(event.type==='start'){cancelToken=String(event.cancelToken);setDraft({id:'draft',title:text,summary:'',body:'',language:String(event.language),labels:{},category:'',visibility:'private',owned:false,createdAt:'',questionCount:0,sources:[]});}
          else if(event.type==='status'){setStatus(String(event.message));setDraft(page=>page?{...page,body}:page);}
          else if(event.type==='replace'&&typeof event.text==='string'){body=event.text;setDraft(page=>page?{...page,body}:page);}
          else if(event.type==='delta'&&typeof event.text==='string'){
            body+=event.text;
            if(performance.now()-lastPaint>60){const snapshot=body;setDraft(page=>page?{...page,body:snapshot}:page);lastPaint=performance.now();}
          }else if(event.type==='ping')setDraft(page=>page?{...page,body}:page);
          else if(event.type==='metadata')setDraft(page=>page?{...page,body,title:String(event.title),summary:String(event.summary),category:String(event.category),labels:event.labels as AnswerPage['labels']}:page);
          else if(event.type==='done'){result={page:event.page as AnswerPage,reused:!!event.reused,question:typeof event.question==='string'?event.question:undefined};break;}
          else if(event.type==='error'){if(!body.trim())setDraft(null);throw new Error(String(event.message));}
        }
        if(!result)throw new Error('The connection ended before the page was saved. Please try again.');
      }else result=await readResponse(response);
      }catch(error){
        if(controller.signal.aborted)throw error;
        // The stream dropped (for example a background tab); the server keeps generating.
        setStatus(t('Connection interrupted. Waiting for the page to finish generating…'));
        result=await waitForGenerationResult<AnswerPage>(generationId,controller.signal);
        if(!result)throw error;
      }
      progressFinished=true;if(progressTimer)clearInterval(progressTimer);
      if (controller.signal.aborted) return;
      let linkWarning='';
      if(origin&&'highlight' in origin&&canWritePage(visiblePage)){
        try{const saved=await navigationRequest('/api/links',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sourceId:origin.pageId,targetId:result.page.id,...origin.highlight,parameters:(result.page.parameters||result.page.runtime?.input)}),signal:controller.signal});const data=await saved.json() as {error?:string};if(!saved.ok)throw new Error(data.error||'Could not save the underline.');
          setHighlights(all=>({...all,[origin.pageId]:(all[origin.pageId]||[]).filter(h=>JSON.stringify(h.segments)!==JSON.stringify(origin.highlight.segments))}));
        }catch(e){if(controller.signal.aborted)return;linkWarning='The page opened, but its underline could not be saved. '+navigationError(e,'Please try again.');}
      }
      if(controller.signal.aborted)return;
      setError(linkWarning);
      setSelected(result.page);setDraft(null);
      if(fork)forkRequest.current=null;
      // A link routed with page context shows the routed question, not the bare link text.
      const shown=result.question?.trim()||text;
      setQuestion(shown);
      recordHistory(result.page.id,shown,(result.page.parameters||result.page.runtime?.input));
      setStatus(result.reused ? 'Redirected to ' + result.page.title : 'Created a new answer');
      return {pageId:result.page.id,reused:!!result.reused};
    } catch (e) {
      if (!controller.signal.aborted) { setStatus(''); setError(navigationError(e,'Could not answer this question.')); }
    } finally {
      progressFinished=true;if(progressTimer)clearInterval(progressTimer); controller.signal.removeEventListener('abort',cancelGeneration);if (!controller.signal.aborted) setBusy(false); }
  }

  async function openInternal(link:InternalLink){
    if(busy)return;
    request.current?.abort();const controller=new AbortController();request.current=controller;
    setBusy(true);setError('');setStatus('Opening saved page…');setPending(null);window.getSelection()?.removeAllRanges();
    try{
      await ensureActor();
      const result=await readResponse(await navigationRequest('/api/pages/'+encodeURIComponent(link.targetId)+'?defer=1&'+inputQuery(link.parameters).replace(/^&/,''),{cache:'no-store',signal:controller.signal}));
      if(controller.signal.aborted)return;
      setSelected(result.page);setDraft(null);setQuestion(link.quote);recordHistory(result.page.id,link.quote,(result.page.parameters||result.page.runtime?.input));setStatus('Opened '+result.page.title);
    }catch(e){if(!controller.signal.aborted){setStatus('');setError(navigationError(e,'Could not open this page.'));}}
    finally{if(!controller.signal.aborted)setBusy(false);}
  }

  const navigateRef=useRef(navigate);
  navigateRef.current=navigate;
  useEffect(()=>{
    const context=(document as Document & {modelContext?:{registerTool:(tool:unknown,options:{signal:AbortSignal})=>void|Promise<void>}}).modelContext;
    if(!context?.registerTool)return;
    const lifecycle=new AbortController();
    try{void Promise.resolve(context.registerTool({
      name:'open_or_create_answer',title:'Open or create an answer',
      description:'Navigate to the saved answer for a question, or research and save a new answer when no equivalent page exists. New answers start private. Their owner can choose to publish them.',
      inputSchema:{type:'object',properties:{question:{type:'string',minLength:1,maxLength:4000}},required:['question'],additionalProperties:false},
      annotations:{readOnlyHint:false,untrustedContentHint:true},
      execute:async(value:unknown)=>{const q=(value as {question?:unknown})?.question;if(typeof q!=='string'||!q.trim()||q.length>4000)throw new Error('Enter a question between 1 and 4000 characters.');const result=await navigateRef.current(q);if(!result)throw new Error('Navigation did not complete. Check the visible status.');return result;}
    },{signal:lifecycle.signal})).catch(()=>{});}catch{}
    return()=>lifecycle.abort();
  },[]);

  async function changeVisibility(value: PageAccess) {
    if (!selected?.owned || saving) return false;
    const pageId = selected.id;
    setSaving(true); setError('');
    try {
      await ensureActor();
      const result = await readResponse(await fetch('/api/pages/' + encodeURIComponent(pageId), {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access: value }),
      }));
      setSelected(current => current?.id === pageId ? {...result.page,runtime:current.runtime,parameters:current.parameters,applicationResult:current.applicationResult,runtimeError:current.runtimeError} : current);
      return true;
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save visibility.'); return false; }
    finally { setSaving(false); }
  }

  const forkRequest=useRef<{sourceId:string;id:string}|null>(null);
  // Print report: the browser's print-to-PDF renders the page as a report.
  // Collapsed sections open and the page chrome hides through print styles;
  // sandboxed panels, charts and maps print as rendered at that moment.
  function printReport(){
    const root=document.documentElement,opened=[...document.querySelectorAll<HTMLDetailsElement>('article.answer details:not([open])')];
    for(const d of opened)d.open=true;
    root.dataset.print='report';
    const done=()=>{delete root.dataset.print;for(const d of opened)d.open=false;window.removeEventListener('afterprint',done);};
    window.addEventListener('afterprint',done);
    setTimeout(()=>{window.print();setTimeout(()=>{if(root.dataset.print)done();},60000);},150);
  }
  async function createFork(){
    if(!selected||busy)return;const sourceId=selected.id;
    if(forkRequest.current?.sourceId!==sourceId)forkRequest.current={sourceId,id:crypto.randomUUID()};
    await navigate(question||selected.question||selected.title,undefined,{sourceId,requestId:forkRequest.current.id});
  }

  async function removePageFork(id:string){
    if(!selected||busy)return;setBusy(true);setError('');
    try{await ensureActor();const response=await fetch('/api/pages/'+encodeURIComponent(id)+'/fork',{method:'DELETE'}),result=await response.json() as {removed?:boolean;nextPageId?:string|null;error?:string};if(!response.ok)throw Error(result.error||'Could not remove fork.');
      const target=selected.id===id?result.nextPageId:selected.id;
      if(target){const next=await readResponse(await fetch('/api/pages/'+encodeURIComponent(target)));setSelected(next.page);if(selected.id===id)recordHistory(next.page.id,question);}
      else{setSelected(null);history.replaceState({},'','/');}
      setStatus('Fork removed.');
    }catch(e){setError(e instanceof Error?e.message:'Could not remove fork.');}finally{setBusy(false);}
  }

  const visiblePage=draft||selected;
  const nativeApp=!draft&&visiblePage?nativeWorkspaceApp(visiblePage):null;
  const articleView=visiblePage?<AnswerText concepts={!draft?concepts:[]} sources={visiblePage.sources} labels={visiblePage.labels} title={visiblePage.title} summary={visiblePage.summary} body={visiblePage.labels.templateId==='disambiguation-v1'&&!visiblePage.labels.richContent?'':visiblePage.body} highlights={highlights[visiblePage.id]||[]} links={visiblePage.links||[]} onOpen={link=>void openInternal(link)} onJump={highlight=>{window.getSelection()?.removeAllRanges();void navigate(highlight.quote,{pageId:visiblePage.id,highlight})}}>{visiblePage.labels.templateId==='disambiguation-v1'&&!visiblePage.labels.richContent&&visiblePage.labels.indexEntries&&<DisambiguationIndex entries={visiblePage.labels.indexEntries} onOpen={text=>void navigate(text,{pageId:visiblePage.id,kind:'index'})} disabled={busy}/>} {visiblePage.contextIndex&&<ContextIndex page={visiblePage} onResult={setSelected} onOpen={(id,title)=>void openInternal({id,targetId:id,targetTitle:title,quote:title,segments:[],parameters:{}})}/>} {(visiblePage.view||visiblePage.runtimePending||visiblePage.dynamic?.template==='page-program-v1')&&<ProgramView page={visiblePage} onResult={setSelected}/>} {visiblePage.dynamic?.chart&&visiblePage.dynamic.dataset&&<Dashboard tableFirst={visiblePage.labels.templateId==='table-v1'} key={'chart:'+visiblePage.id} chart={visiblePage.dynamic.chart} dataset={visiblePage.dynamic.dataset}/>}{visiblePage.dynamic?.sandbox&&<SandboxView key={'sandbox:'+visiblePage.id} title={visiblePage.title} app={visiblePage.dynamic.sandbox}/>}</AnswerText>:null;
  return <UiContext.Provider value={ui}><div className="browser-shell" lang={locale}>
    <header className="browser-toolbar">
      <a className="browser-brand" href="/" title={t("Home")} aria-label="AgenticWiKi"><Layers size={22} aria-hidden="true"/><span>AgenticWiKi</span></a>
      <div className="history-controls">
        <button type="button" aria-label={t("Back")} title={t("Back")} disabled={(historyPosition===0&&!busy&&!draft)||saving} onClick={()=>{if(busy||draft)void restore();else history.back();}}><ArrowLeft size={19}/></button>
        <button type="button" aria-label={t("Forward")} title={t("Forward")} disabled={historyPosition>=historyLength-1||saving} onClick={()=>history.forward()}><ArrowRight size={19}/></button>
        <HistoryMenu disabled={busy||saving} saveError={historySaveError} beforeLoad={()=>{for(const visit of [...failedVisits.current.values()])saveVisit(visit.pageId,visit.text,visit.parameters,visit.id,visit.legacy);return visitWrites.current;}} onOpen={(entry:HistoryEntry)=>void openInternal({id:entry.id,targetId:entry.pageId,targetTitle:entry.title,quote:entry.question||entry.title,segments:[],parameters:entry.parameters})}/>
      </div>
      <form className="address-bar" onSubmit={event => { event.preventDefault(); void navigate(); }} aria-label={t("Open an answer")}>
        <label htmlFor="address" className="sr-only">{t("Question or context")}</label>
        <input ref={input} id="address" type="text" value={question} onChange={event => setQuestion(event.target.value)}
          placeholder={t("Enter a question or context")} maxLength={4000} autoComplete="off" autoFocus
          enterKeyHint="go" spellCheck={false} aria-describedby="address-help"/>
        <VoiceInput disabled={busy} onText={text=>{setQuestion(old=>old.trim()?old.replace(/\s+$/,'')+' '+text:text);input.current?.focus();}}/>
        <button type="submit" className="go-button" disabled={busy || !question.trim()}
          aria-label={busy ? t("Opening answer") : t("Open answer")} title={t("Open answer · Enter")}>
          {busy ? <LoaderCircle className="spinner" size={18}/> : <ArrowRight size={18}/>}
        </button>
      </form>
      <input type="file" ref={uploadInput} hidden onChange={e=>{const file=e.target.files?.[0];if(file)void uploadFile(file);}}/>
      <ConnectorPanel/>
      <a className="account-link" href={user ? signOut : signIn} target="_top" title={user ? t("Signed in as ") + user.name : t("Sign in with Google")}>
        {user ? t("Sign out") : t("Sign in")}
      </a>
    </header>
    <p className="sr-only" id="address-help">{t("Type a question and press Enter to open its answer below. Press Control K or Command K to select the address bar.")}</p>
    <main className="browser-content" aria-busy={busy}>
      {error && <div className="request-error" role="alert">{t(error)}</div>}
      {status && <div className="navigation-status" role="status">{busy ? <LoaderCircle size={15} className="spinner"/> : <Check size={15}/>} {t(status)}</div>}
      {visiblePage ? <MapPreference.Provider value={visiblePage.dynamic?.ui?.mapBasemap}><article {...pageVisualProps(visiblePage)} className={'answer '+(visiblePage.kind==='dynamic'?'dynamic-answer ':'')+'template-'+(visiblePage.labels.templateId||'wiki-v1')+(nativeApp?' connector-page connector-page-'+nativeApp:'')} lang={visiblePage.language==='und'?undefined:visiblePage.language} dir={['ar','he','fa','ur','ps','dv','yi'].includes(visiblePage.language)?'rtl':'ltr'}>
        {!draft&&visiblePage.forks&&visiblePage.forks.length>0&&<details className="page-forks-disclosure" open={nativeApp?undefined:true}><summary>{t("Context forks")}</summary><nav className="page-forks" aria-label={t("Context forks")}><span>{t("Context forks")}</span><div>{visiblePage.forks.map((fork,i)=><div className="fork-choice" key={fork.id}><button aria-current={fork.id===visiblePage.id?'page':undefined} disabled={busy||fork.id===visiblePage.id} onClick={()=>void openInternal({id:'fork:'+fork.id,targetId:fork.id,targetTitle:fork.title,quote:question||fork.title,segments:[],parameters:{}})}><strong>{fork.isOriginal?(t("Original")):(t("Fork"))+' '+(i+1)}</strong> {fork.title}<small>{pageAccess(fork)==='private'?t("Private"):pageAccess(fork)==='public-write'?t("Public read & write"):t("Public read only")}</small></button>{fork.removable&&<button className="remove-fork" disabled={busy} onClick={()=>void removePageFork(fork.id)} aria-label={t("Remove fork: ")+fork.title}><Trash2 size={13}/>{t("Remove")}</button>}</div>)}</div></nav></details>}
        {!draft&&<div className="context-actions">{nativeApp&&<h1 className="connector-page-title">{visiblePage.title}</h1>}<div className="context-action-buttons"><button onClick={()=>void createFork()} disabled={busy||saving}><GitFork size={15}/>{t("Fork")}</button>{canWritePage(visiblePage)&&<button disabled={busy||saving} onClick={()=>{setEditing(true);setSaving(true);}}>{t('Edit page')}</button>}<PageShare key={visiblePage.id} page={visiblePage} disabled={busy||saving} onAccess={changeVisibility}/><button type="button" onClick={printReport} disabled={busy||saving} title={t("Print this page as a PDF report")}><Printer size={15}/>{t("Print report")}</button></div><span>{t("Generate a fresh private fork from this question")}</span></div>}
        {editing&&!draft&&<PageEditor metadataOnly={visiblePage.kind==='dynamic'} page={visiblePage} onFiles={()=>setFilesRevision(n=>n+1)} onClose={()=>{setEditing(false);setSaving(false);}} onSave={page=>{setSelected({...visiblePage,...page});setEditing(false);setSaving(false);setPending(null);setHighlights(all=>({...all,[page.id]:[]}));}}/>}
        <div hidden={editing&&visiblePage.kind!=='dynamic'}>
        <header className="print-report-header" aria-hidden="true"><span>AgenticWiKi · {t("Report")}</span><span>{visiblePage.question&&visiblePage.question!==visiblePage.title?visiblePage.question:""}</span><span>{new Date().toLocaleString(locale)} · {typeof location!=="undefined"?location.origin+"/?page="+visiblePage.id:""}</span></header>
        <div className="page-meta"><span>{visiblePage.category}</span><div className="page-visibility">
          {visiblePage.visibility === 'public' ? <Globe2 size={14}/> : <LockKeyhole size={14}/>}
          {visiblePage.owned?<select aria-label={t("Page access")} value={pageAccess(visiblePage)} disabled={saving||busy} onChange={e=>void changeVisibility(e.target.value as PageAccess)}>
            <option value="private">{t("Private")}</option><option value="public-read">{t("Public read only")}</option><option value="public-write">{t("Public read & write")}</option>
          </select>:<span>{pageAccess(visiblePage)==='private'?t("Private"):pageAccess(visiblePage)==='public-write'?t("Public read & write"):t("Public read only")}</span>}
        </div></div>
        <div className="selection-tools" hidden={!!nativeApp} aria-live="polite">
          {draft ? <span>{busy?t("Generating… You can read the page as it appears."):t("Incomplete draft — retry the question to generate a saved page.")}</span> : pending ? <><span className="selection-quote">“{pending.quote}”</span><button type="button" onMouseDown={e=>e.preventDefault()} onClick={()=>addHighlight(false)} disabled={busy}><Highlighter size={14}/>{t("Highlight")}</button><button type="button" onMouseDown={e=>e.preventDefault()} onClick={()=>addHighlight(true)} disabled={busy}>{t("Highlight & open")}<ArrowRight size={14}/></button></> : <span>{visiblePage.labels.templateId==='disambiguation-v1'?t("Choose the meaning or topic you want to explore."):t(conceptStatus)||t("Select text to highlight it or open it as a question.")}{(conceptStatus.includes('could not')||conceptStatus.includes('still'))&&<button onClick={()=>setConceptAttempt(n=>n+1)}>{t("Retry")}</button>}</span>}
        </div>
        {!draft&&visiblePage.kind==='dynamic'&&<section className="repository-transfer" aria-label={t('Data transfer')}><div><strong>{t('Data transfer')}</strong><p>{t('Copy or move files and folders between connected repositories and this page.')}</p></div><button type="button" onClick={()=>setTransferPage(visiblePage.id)}>{t('Transfer files')}</button></section>}
        {visiblePage.dynamic?.pageCode&&visiblePage.dynamic.pageCode.placement!=='after'&&<SandboxView app={visiblePage.dynamic.pageCode.frontend} title={visiblePage.title} pageId={visiblePage.id}/>}
        <div hidden={visiblePage.dynamic?.pageCode?.placement==='replace'}>
        <div hidden={!!nativeApp} ref={article} onMouseUp={captureSelection} onKeyUp={captureSelection} onTouchEnd={()=>setTimeout(captureSelection,0)}>
          {articleView}
        </div>
        {visiblePage.kind==='dynamic'&&visiblePage.dynamic?.template==='unit-converter-v1'&&<UnitConverter key={visiblePage.id+JSON.stringify(visiblePage.runtime?.input)} page={visiblePage} onResult={page=>{const text=page.runtime?`${page.runtime.input.value} ${page.runtime.fromSymbol} → ${page.runtime.toSymbol}`:question;setSelected(page);setQuestion(text);recordHistory(page.id,text,page.runtime?.input);setStatus('');}}/>}
        {visiblePage.dynamic?.template==='google-drive-folders-v1'&&visiblePage.dynamic.driveLabels&&<DriveFolders key={'drive:'+visiblePage.id} pageId={visiblePage.id} labels={visiblePage.dynamic.driveLabels}/>}
        {visiblePage.dynamic?.template==='component-form-v1'&&<ComponentForm key={'form:'+visiblePage.id} page={visiblePage} onResult={page=>{setSelected(page);recordHistory(page.id,question,page.parameters);}}/>}
        {visiblePage.runtimeError&&visiblePage.dynamic?.template!=='page-program-v1'&&<p role="alert">{t(visiblePage.runtimeError)}</p>}
        {visiblePage.dynamic?.template==='native-app-v1'&&(visiblePage.dynamic.nativeApp==='arcgis-publisher'?<ArcgisPublisher key={visiblePage.id} source={nativePageSource(visiblePage)}/>:visiblePage.dynamic.nativeApp==='adma-tools'?<ProcessingPanel key={visiblePage.id+JSON.stringify(visiblePage.parameters||{})} pageId={visiblePage.id} writable={canUseConnectorsOn(visiblePage)} initialTool={String(visiblePage.parameters?.tool||'')} onFork={()=>void createFork()}/>:visiblePage.dynamic.nativeApp==='unl-hcc'?<HccApp key={visiblePage.id} pageId={visiblePage.id} writable={canWritePage(visiblePage)}/>:visiblePage.dynamic.nativeApp==='map'?<GeoViewer key={visiblePage.id+JSON.stringify(visiblePage.parameters||{})} embedded revision={filesRevision} source={nativePageSource(visiblePage)} initialBasemap={visiblePage.dynamic.ui?.mapBasemap}/>:<Workbench key={visiblePage.id+JSON.stringify(visiblePage.parameters||{})} embedded revision={filesRevision} app={visiblePage.dynamic.nativeApp||'hub'} source={nativePageSource(visiblePage)}/>)}
        {nativeApp==='adma'&&<AdmaApp key={visiblePage.id+String(visiblePage.parameters?.tool||'')} pageId={visiblePage.id} writable={canWritePage(visiblePage)} tool={String(visiblePage.parameters?.tool||'')}/>}
        {visiblePage.kind==='dynamic'&&visiblePage.dynamic?.template==='file-browser-v1'&&pageStorageProviders(visiblePage.question||visiblePage.title,visiblePage.parameters).length>0&&<StoragePanel writable={canWritePage(visiblePage)} question={visiblePage.question} key={visiblePage.id+JSON.stringify(visiblePage.parameters||{})} parameters={visiblePage.parameters} pageId={visiblePage.id} language={visiblePage.language} expanded={visiblePage.labels.templateId==='files-v1'||!!visiblePage.runtimeError}/>} 
        </div>
        {visiblePage.dynamic?.pageCode?.placement==='after'&&<SandboxView app={visiblePage.dynamic.pageCode.frontend} title={visiblePage.title} pageId={visiblePage.id}/>}
        <div className={nativeApp?'connector-support':undefined}>
        {!draft&&visiblePage.labels.templateId==='paper-v1'&&<PaperWorkspace pageId={visiblePage.id} sources={visiblePage.sources} revision={filesRevision}/>} 
        {!draft&&<ContextFiles key={'files:'+visiblePage.id} page={visiblePage} revision={filesRevision} busy={busy} onChanged={()=>setFilesRevision(n=>n+1)} onUpload={()=>uploadInput.current?.click()}/>} 
        {transferPage===visiblePage.id&&<ResourcePicker pageId={visiblePage.id} copyMode onClose={()=>setTransferPage(null)}/>}
        {!draft&&<PageAgentChat key={'chat:'+visiblePage.id} page={visiblePage} onResult={setSelected} onOpenQuestion={(text,passage)=>void navigate(text,{pageId:visiblePage.id,kind:'chat',passage:passage.slice(0,6000)})}/>}
        </div>

        <div className="saved-note">{draft ? t(busy?'Draft · Not saved yet':'Incomplete draft · Not saved') : t('Saved {date} · {count} questions linked',{date:new Date(visiblePage.createdAt).toLocaleDateString(locale),count:visiblePage.questionCount})}</div>
        </div>
      </article></MapPreference.Provider> : !busy && <HomePage onOpen={card=>void openInternal({id:'home:'+card.id,targetId:card.id,targetTitle:card.title,quote:card.title,segments:[]})}/>}
    </main>
  </div></UiContext.Provider>;
}
