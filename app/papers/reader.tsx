'use client';
import {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {Highlighter,Minus,Plus,MessageSquareText,NotebookPen,Trash2,X,Maximize2} from 'lucide-react';
import {useUi} from '@/app/i18n/client';
import type {PDFDocumentProxy,PDFPageProxy} from 'pdfjs-dist';

// The paper reader: pdf.js renders each page with a transparent text layer, so readers can
// select text, highlight it in a color and attach a note. Highlights are stored per reader,
// page and document and are drawn back on the page (as page-relative rectangles) next time.
type Rect={x:number;y:number;w:number;h:number};
type Note={id:string;page:number;color:string;quote:string;note:string;rects:Rect[];createdAt:number;updatedAt:number};
type Pending={page:number;rects:Rect[];quote:string;x:number;y:number};
export const COLORS:[string,string][]=[['yellow','#ffe066'],['green','#8ce99a'],['blue','#91c8ff'],['pink','#ffa8d2'],['orange','#ffc078']];
const colorOf=(name:string)=>COLORS.find(c=>c[0]===name)?.[1]||COLORS[0][1];
const WORKER='/pdfjs/pdf.worker-4.10.38.min.js';

// Selection rectangles in page coordinates (0–1), without pdf.js's page-sized helper boxes,
// merged into one box per line piece.
function pageRects(range:Range,page:HTMLElement):Rect[]{
 const box=page.getBoundingClientRect(),out:Rect[]=[];
 for(const r of range.getClientRects()){
  const x=Math.max(r.left,box.left),y=Math.max(r.top,box.top),right=Math.min(r.right,box.right),bottom=Math.min(r.bottom,box.bottom);
  if(right-x<1||bottom-y<2||bottom-y>box.height*0.2||right-x>box.width*0.98)continue;
  out.push({x:(x-box.left)/box.width,y:(y-box.top)/box.height,w:(right-x)/box.width,h:(bottom-y)/box.height});
 }
 out.sort((a,b)=>a.y-b.y||a.x-b.x);
 const merged:Rect[]=[];
 for(const r of out){const last=merged[merged.length-1];
  if(last&&Math.abs((last.y+last.h/2)-(r.y+r.h/2))<Math.max(last.h,r.h)*0.5&&r.x<=last.x+last.w+0.012){const right=Math.max(last.x+last.w,r.x+r.w),top=Math.min(last.y,r.y),bottom=Math.max(last.y+last.h,r.y+r.h);last.x=Math.min(last.x,r.x);last.w=right-last.x;last.y=top;last.h=bottom-top;}
  else merged.push({...r});}
 return merged.slice(0,200).map(r=>({x:+r.x.toFixed(5),y:+r.y.toFixed(5),w:+r.w.toFixed(5),h:+r.h.toFixed(5)}));
}

export function PdfNotesReader({pageId,documentKey,src,title}:{pageId:string;documentKey:string;src:string;title:string}){
 const {t}=useUi();
 const scroller=useRef<HTMLDivElement>(null),wrap=useRef<HTMLDivElement>(null),pageEls=useRef(new Map<number,HTMLDivElement>());
 const [pdf,setPdf]=useState<PDFDocumentProxy|null>(null),[base,setBase]=useState<{w:number;h:number}|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 const [fit,setFit]=useState(true),[zoom,setZoom]=useState(1),[width,setWidth]=useState(800);
 const [notes,setNotes]=useState<Note[]>([]),[color,setColor]=useState('yellow'),[pending,setPending]=useState<Pending|null>(null),[active,setActive]=useState<{id:string;x:number;y:number}|null>(null),[panel,setPanel]=useState(false),[saveError,setSaveError]=useState(''),[flash,setFlash]=useState('');
 const api='/api/pages/'+encodeURIComponent(pageId)+'/paper-notes';

 useEffect(()=>{let cancelled=false,doc:PDFDocumentProxy|null=null;setPdf(null);setBase(null);setError('');setLoading(true);
  (async()=>{const pdfjs=await import('pdfjs-dist');pdfjs.GlobalWorkerOptions.workerSrc=WORKER;
   const task=pdfjs.getDocument({url:src,cMapUrl:'/pdfjs/cmaps/',cMapPacked:true,standardFontDataUrl:'/pdfjs/standard_fonts/',isEvalSupported:false});
   doc=await task.promise;if(cancelled){void doc.destroy();return;}
   const first=await doc.getPage(1),v=first.getViewport({scale:1});setBase({w:v.width,h:v.height});setPdf(doc);
  })().catch(e=>{if(!cancelled)setError(e instanceof Error&&/Missing PDF|Invalid PDF/i.test(e.message)?'This file is not a readable PDF.':'The PDF could not be opened.');}).finally(()=>{if(!cancelled)setLoading(false);});
  return ()=>{cancelled=true;void doc?.destroy();};
 },[src]);
 useEffect(()=>{let live=true;setNotes([]);fetch(api+'?document='+encodeURIComponent(documentKey),{cache:'no-store'}).then(r=>r.ok?r.json() as Promise<{notes?:Note[]}>:{notes:[]}).then(d=>{if(live)setNotes(d.notes||[]);}).catch(()=>{});return ()=>{live=false;};},[api,documentKey]);
 useLayoutEffect(()=>{const el=scroller.current;if(!el)return;const measure=()=>setWidth(el.clientWidth);measure();const ro=new ResizeObserver(measure);ro.observe(el);return ()=>ro.disconnect();},[]);
 const scale=useMemo(()=>base?(fit?Math.max(0.4,Math.min(3,(width-32)/base.w)):zoom):1,[base,fit,width,zoom]);
 const setScale=(next:number)=>{setFit(false);setZoom(Math.max(0.4,Math.min(4,+next.toFixed(2))));};

 const send=async(method:'POST'|'PATCH'|'DELETE',body:unknown)=>{setSaveError('');const r=await fetch(api,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json().catch(()=>({})) as {result?:unknown;error?:string};if(!r.ok)throw Error(d.error||t('The note could not be saved.'));return d.result;};
 const create=async(p:Pending,c:string,openNote=false)=>{window.getSelection()?.removeAllRanges();setPending(null);
  try{const n=await send('POST',{document:documentKey,page:p.page,color:c,quote:p.quote,note:'',rects:p.rects}) as Note;setNotes(list=>[...list,n].sort((a,b)=>a.page-b.page||a.createdAt-b.createdAt));if(openNote)setActive({id:n.id,x:p.x,y:p.y});}
  catch(e){setSaveError(e instanceof Error?e.message:t('The note could not be saved.'));}};
 const update=async(id:string,change:{color?:string;note?:string})=>{const before=notes;setNotes(list=>list.map(n=>n.id===id?{...n,...change}:n));try{await send('PATCH',{id,...change});}catch(e){setNotes(before);setSaveError(e instanceof Error?e.message:t('The note could not be saved.'));}};
 const remove=async(id:string)=>{const before=notes;setNotes(list=>list.filter(n=>n.id!==id));setActive(null);try{await send('DELETE',{id});}catch(e){setNotes(before);setSaveError(e instanceof Error?e.message:t('The note could not be deleted.'));}};

 // A finished selection inside the pages offers colors; a plain click on a highlight opens it.
 const onPointerUp=useCallback((e:React.PointerEvent)=>{
  if((e.target as Element).closest('.pdf-float'))return;
  const box=wrap.current?.getBoundingClientRect();if(!box)return;
  const sel=window.getSelection();
  if(sel&&!sel.isCollapsed&&sel.rangeCount){
   const range=sel.getRangeAt(0),quote=sel.toString().replace(/\s+/g,' ').trim();
   const pageEl=(range.startContainer.parentElement||null)?.closest<HTMLDivElement>('.pdf-page');
   if(!quote||!pageEl||!scroller.current?.contains(pageEl))return;
   const rects=pageRects(range,pageEl);if(!rects.length)return;
   const last=range.getClientRects();const end=last[last.length-1];
   setActive(null);setPending({page:Number(pageEl.dataset.page),rects,quote:quote.slice(0,4000),x:(end?end.right:e.clientX)-box.left,y:(end?end.bottom:e.clientY)-box.top});return;
  }
  setPending(null);
  const pageEl=(e.target as Element).closest<HTMLDivElement>('.pdf-page');if(!pageEl)return;
  const pb=pageEl.getBoundingClientRect(),px=(e.clientX-pb.left)/pb.width,py=(e.clientY-pb.top)/pb.height,page=Number(pageEl.dataset.page);
  const hit=[...notes].reverse().find(n=>n.page===page&&n.rects.some(r=>px>=r.x&&px<=r.x+r.w&&py>=r.y&&py<=r.y+r.h));
  setActive(hit?{id:hit.id,x:e.clientX-box.left,y:e.clientY-box.top}:null);
 },[notes]);
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){setPending(null);setActive(null);}};window.addEventListener('keydown',key);return ()=>window.removeEventListener('keydown',key);},[]);

 const goTo=(n:Note)=>{const el=pageEls.current.get(n.page),sc=scroller.current;if(!el||!sc)return;const r=n.rects[0];sc.scrollTo({top:el.offsetTop+(r?r.y*el.offsetHeight:0)-80,behavior:'smooth'});setFlash(n.id);setTimeout(()=>setFlash(f=>f===n.id?'':f),1600);};
 const current=active?notes.find(n=>n.id===active.id):null;
 const floatPos=(x:number,y:number)=>({left:Math.max(8,Math.min(x-120,(wrap.current?.clientWidth||600)-(panel?560:300))),top:y+10});
 const pages=pdf?Array.from({length:pdf.numPages},(_,i)=>i+1):[];

 return <div className={'pdf-reader'+(panel?' with-panel':'')} ref={wrap}>
  <div className="pdf-reader-bar">
   <div className="pdf-colors" role="radiogroup" aria-label={t('Highlight color')}>{COLORS.map(([name,hex])=><button key={name} type="button" role="radio" aria-checked={color===name} aria-label={t('Highlight color')+': '+t(name)} title={t(name)} style={{background:hex}} onClick={()=>{setColor(name);if(pending)void create(pending,name);}}/>)}</div>
   <span className="pdf-hint"><Highlighter size={14}/>{t('Select text to highlight it or add a note.')}</span>
   <div className="pdf-zoom"><button type="button" onClick={()=>setScale(scale/1.2)} aria-label={t('Zoom out')} title={t('Zoom out')}><Minus size={15}/></button><span>{Math.round(scale*100)}%</span><button type="button" onClick={()=>setScale(scale*1.2)} aria-label={t('Zoom in')} title={t('Zoom in')}><Plus size={15}/></button><button type="button" onClick={()=>setFit(true)} aria-pressed={fit} title={t('Fit width')}><Maximize2 size={14}/>{t('Fit width')}</button></div>
   <button type="button" className="pdf-notes-toggle" aria-pressed={panel} onClick={()=>setPanel(!panel)}><NotebookPen size={15}/>{t('Notes')}{notes.length?' ('+notes.length+')':''}</button>
  </div>
  <div className="pdf-reader-body">
   <div className="pdf-scroller" ref={scroller} onPointerUp={onPointerUp} aria-label={title}>
    {loading&&<p className="pdf-status" role="status">{t('Loading…')}</p>}
    {error&&<p className="pdf-status pdf-error" role="alert">{t(error)}</p>}
    {pdf&&base&&pages.map(n=><PdfPage key={n} pdf={pdf} number={n} scale={scale} estimate={base} notes={notes.filter(x=>x.page===n)} flash={flash} activeId={active?.id||''} register={el=>{if(el)pageEls.current.set(n,el);else pageEls.current.delete(n);}} root={scroller}/>)}
   </div>
   {panel&&<aside className="pdf-notes" aria-label={t('Notes')}>
    <header><strong>{t('Notes')}</strong><button type="button" onClick={()=>setPanel(false)} aria-label={t('Close')}><X size={15}/></button></header>
    {notes.length?<ol>{notes.map(n=><li key={n.id}><button type="button" className="pdf-note-item" onClick={()=>goTo(n)} style={{borderLeftColor:colorOf(n.color)}}><small>{t('Page')} {n.page}</small><q>{n.quote}</q>{n.note&&<p><MessageSquareText size={12}/> {n.note}</p>}</button></li>)}</ol>:<p className="pdf-notes-empty">{t('No highlights yet. Select text in the paper to highlight it or add a note.')}</p>}
   </aside>}
  </div>
  {pending&&<div className="pdf-float pdf-pick" style={floatPos(pending.x,pending.y)} role="toolbar" aria-label={t('Highlight selection')}>
   {COLORS.map(([name,hex])=><button key={name} type="button" style={{background:hex}} aria-label={t('Highlight')+': '+t(name)} title={t(name)} onClick={()=>{setColor(name);void create(pending,name);}}/>)}
   <button type="button" className="pdf-add-note" onClick={()=>void create(pending,color,true)}><MessageSquareText size={14}/>{t('Add note')}</button>
  </div>}
  {current&&active&&<NoteEditor key={current.id} note={current} style={floatPos(active.x,active.y)} onColor={c=>void update(current.id,{color:c})} onSave={text=>void update(current.id,{note:text})} onDelete={()=>void remove(current.id)} onClose={()=>setActive(null)}/>}
  {saveError&&<p className="pdf-save-error" role="alert">{saveError}</p>}
 </div>;
}

function NoteEditor({note,style,onColor,onSave,onDelete,onClose}:{note:Note;style:React.CSSProperties;onColor:(c:string)=>void;onSave:(text:string)=>void;onDelete:()=>void;onClose:()=>void}){
 const {t}=useUi(),[text,setText]=useState(note.note),box=useRef<HTMLTextAreaElement>(null),saved=useRef(note.note),latest=useRef(note.note),save=useRef(onSave);save.current=onSave;
 useEffect(()=>{box.current?.focus();},[]);
 const commit=useCallback(()=>{const value=latest.current.slice(0,8000);if(value!==saved.current){saved.current=value;save.current(value);}},[]);
 // Notes save while typing (after a pause) and whenever the editor closes, however it closes.
 useEffect(()=>{const timer=setTimeout(commit,800);return ()=>clearTimeout(timer);},[text,commit]);
 useEffect(()=>commit,[commit]);
 return <div className="pdf-float pdf-note-editor" style={style} role="dialog" aria-label={t('Highlight note')}>
  <div className="pdf-note-head">{COLORS.map(([name,hex])=><button key={name} type="button" style={{background:hex}} aria-pressed={note.color===name} aria-label={t('Highlight color')+': '+t(name)} title={t(name)} onClick={()=>onColor(name)}/>)}<button type="button" className="pdf-note-delete" onClick={()=>{saved.current=latest.current;onDelete();}} aria-label={t('Delete highlight')} title={t('Delete highlight')}><Trash2 size={15}/></button><button type="button" onClick={()=>{commit();onClose();}} aria-label={t('Close')}><X size={15}/></button></div>
  <q>{note.quote}</q>
  <textarea ref={box} value={text} rows={3} maxLength={8000} placeholder={t('Write a note…')} onChange={e=>{latest.current=e.target.value;setText(e.target.value);}} onBlur={commit} onKeyDown={e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){commit();onClose();}}}/>
  <small>{t('Saved to your account for this paper.')}</small>
 </div>;
}

function PdfPage({pdf,number,scale,estimate,notes,flash,activeId,register,root}:{pdf:PDFDocumentProxy;number:number;scale:number;estimate:{w:number;h:number};notes:Note[];flash:string;activeId:string;register:(el:HTMLDivElement|null)=>void;root:React.RefObject<HTMLDivElement|null>}){
 const el=useRef<HTMLDivElement>(null),canvas=useRef<HTMLDivElement>(null),text=useRef<HTMLDivElement>(null);
 const [page,setPage]=useState<PDFPageProxy|null>(null),[visible,setVisible]=useState(false),[size,setSize]=useState(estimate);
 useEffect(()=>{const node=el.current;register(node);return ()=>register(null);},[register]);
 useEffect(()=>{const node=el.current;if(!node)return;const io=new IntersectionObserver(([e])=>{if(e.isIntersecting)setVisible(true);},{root:root.current,rootMargin:'800px 0px'});io.observe(node);return ()=>io.disconnect();},[root]);
 useEffect(()=>{if(!visible||page)return;let live=true;pdf.getPage(number).then(p=>{if(!live)return;const v=p.getViewport({scale:1});setSize({w:v.width,h:v.height});setPage(p);}).catch(()=>{});return ()=>{live=false;};},[visible,page,pdf,number]);
 // Each draw gets a fresh canvas that replaces the old one when finished: pdf.js refuses to draw
 // on a canvas a cancelled draw may still hold, and the old image stays visible while zooming.
 useEffect(()=>{const holder=canvas.current,layer=text.current;if(!page||!holder||!layer)return;let cancelled=false;
  const viewport=page.getViewport({scale}),ratio=Math.min(window.devicePixelRatio||1,2),c=document.createElement('canvas');
  c.width=Math.floor(viewport.width*ratio);c.height=Math.floor(viewport.height*ratio);c.setAttribute('aria-hidden','true');
  const task=page.render({canvasContext:c.getContext('2d')!,viewport,transform:ratio!==1?[ratio,0,0,ratio,0,0]:undefined});
  task.promise.then(()=>{if(!cancelled)holder.replaceChildren(c);}).catch(e=>{if(!cancelled&&(e as Error)?.name!=='RenderingCancelledException')console.warn('PDF page render failed',number,e);});
  layer.replaceChildren();
  let textLayer:{render:()=>Promise<void>;cancel:()=>void}|null=null;
  import('pdfjs-dist').then(({TextLayer})=>{if(cancelled)return;textLayer=new TextLayer({textContentSource:page.streamTextContent(),container:layer,viewport});return textLayer.render();}).catch(()=>{});
  return ()=>{cancelled=true;task.cancel();textLayer?.cancel();};
 },[page,scale,number]);
 const w=size.w*scale,h=size.h*scale;
 return <div ref={el} className="pdf-page" data-page={number} style={{width:w,height:h,['--scale-factor' as string]:scale}}>
  <div ref={canvas} className="pdf-canvas"/>
  <div className="pdf-marks" aria-hidden="true">{notes.flatMap(n=>n.rects.map((r,i)=><span key={n.id+i} className={(n.id===flash?'flash ':'')+(n.id===activeId?'active':'')} style={{left:r.x*100+'%',top:r.y*100+'%',width:r.w*100+'%',height:r.h*100+'%',background:colorOf(n.color)}}/>))}{notes.filter(n=>n.note).map(n=><i key={n.id} className="pdf-note-pin" style={{left:Math.min(97,(n.rects[n.rects.length-1].x+n.rects[n.rects.length-1].w)*100)+'%',top:n.rects[n.rects.length-1].y*100+'%'}}/>)}</div>
  <div ref={text} className="textLayer"/>
  {!page&&<span className="pdf-page-number">{number}</span>}
 </div>;
}
