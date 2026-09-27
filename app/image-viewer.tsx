'use client';
import {useCallback,useEffect,useRef,useState,type ReactNode,type MouseEvent,type KeyboardEvent,type PointerEvent,type WheelEvent} from 'react';
import {createPortal} from 'react-dom';
import {X,ZoomIn,ZoomOut,RotateCcw,ChevronLeft,ChevronRight,ExternalLink} from 'lucide-react';
import {useUi} from '@/app/i18n/client';

// The viewer renders on document.body, clear of article styles and stacking contexts.
// Click (or Enter on) any image in the wrapped article to open it in a floating viewer: wheel,
// pinch, buttons or double-click zoom, drag to pan, arrow keys step through the page's images.
type Shot={src:string;alt:string;caption:string};
const MIN=1,MAX=8;
const zoomable=(el:Element|null):el is HTMLImageElement=>el instanceof HTMLImageElement&&!el.closest('a,button,.image-viewer')&&(el.naturalWidth===0||el.naturalWidth>=48);
const shotOf=(img:HTMLImageElement):Shot=>({src:img.currentSrc||img.src,alt:img.alt,caption:(img.closest('figure')?.querySelector('figcaption')?.textContent||'').trim()});

export function ImageZoomArea({className,children}:{className?:string;children:ReactNode}){
 const area=useRef<HTMLDivElement>(null),[shots,setShots]=useState<Shot[]>([]),[index,setIndex]=useState(-1),opener=useRef<HTMLElement|null>(null);
 // Images become keyboard reachable and announce that they open larger.
 useEffect(()=>{area.current?.querySelectorAll('img').forEach(img=>{if(zoomable(img)&&!img.hasAttribute('tabindex')){img.tabIndex=0;img.setAttribute('role','button');img.dataset.zoomable='true';}});});
 const open=(img:HTMLImageElement)=>{const all=[...(area.current?.querySelectorAll('img')||[])].filter(zoomable);setShots(all.map(shotOf));setIndex(Math.max(0,all.indexOf(img)));opener.current=img;};
 const onClick=(e:MouseEvent)=>{const img=(e.target as Element).closest?.('img');if(zoomable(img)){e.preventDefault();open(img);}};
 const onKeyDown=(e:KeyboardEvent)=>{if((e.key==='Enter'||e.key===' ')&&zoomable(e.target as Element)){e.preventDefault();open(e.target as HTMLImageElement);}};
 const close=useCallback(()=>{setIndex(-1);opener.current?.focus({preventScroll:true});},[]);
 return <div ref={area} className={className} onClick={onClick} onKeyDown={onKeyDown}>{children}{index>=0&&shots[index]&&createPortal(<ImageViewer shots={shots} index={index} onIndex={setIndex} onClose={close}/>,document.body)}</div>;
}

function ImageViewer({shots,index,onIndex,onClose}:{shots:Shot[];index:number;onIndex:(i:number)=>void;onClose:()=>void}){
 const {t}=useUi(),shot=shots[index],[scale,setScale]=useState(1),[pos,setPos]=useState({x:0,y:0}),closeRef=useRef<HTMLButtonElement>(null);
 const pointers=useRef(new Map<number,{x:number;y:number}>()),pinch=useRef<{d:number;s:number}|null>(null),drag=useRef<{x:number;y:number;px:number;py:number;moved:boolean}|null>(null);
 const reset=()=>{setScale(1);setPos({x:0,y:0});};
 const zoomTo=(next:number)=>{const s=Math.min(MAX,Math.max(MIN,next));setScale(s);if(s===1)setPos({x:0,y:0});};
 const step=useCallback((d:number)=>{if(shots.length>1){onIndex((index+d+shots.length)%shots.length);setScale(1);setPos({x:0,y:0});}},[index,shots.length,onIndex]);
 useEffect(()=>{closeRef.current?.focus();const html=document.documentElement,prev=html.style.overflow;html.style.overflow='hidden';return ()=>{html.style.overflow=prev;};},[]);
 useEffect(()=>{const key=(e:globalThis.KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();onClose();}else if(e.key==='ArrowRight')step(1);else if(e.key==='ArrowLeft')step(-1);else if(e.key==='+'||e.key==='=')setScale(s=>Math.min(MAX,s*1.5));else if(e.key==='-')zoomTo(scale/1.5);else if(e.key==='0')reset();};window.addEventListener('keydown',key);return ()=>window.removeEventListener('keydown',key);});
 const onWheel=(e:WheelEvent)=>{zoomTo(scale*Math.exp(-e.deltaY*0.0015));};
 const down=(e:PointerEvent)=>{(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);pointers.current.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(pointers.current.size===2){const [a,b]=[...pointers.current.values()];pinch.current={d:Math.hypot(a.x-b.x,a.y-b.y),s:scale};drag.current=null;}
  else drag.current={x:e.clientX,y:e.clientY,px:pos.x,py:pos.y,moved:false};};
 const move=(e:PointerEvent)=>{if(!pointers.current.has(e.pointerId))return;pointers.current.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(pinch.current&&pointers.current.size===2){const [a,b]=[...pointers.current.values()];zoomTo(pinch.current.s*Math.hypot(a.x-b.x,a.y-b.y)/pinch.current.d);return;}
  const d=drag.current;if(!d)return;const dx=e.clientX-d.x,dy=e.clientY-d.y;if(Math.abs(dx)+Math.abs(dy)>4)d.moved=true;if(scale>1)setPos({x:d.px+dx,y:d.py+dy});};
 const up=(e:PointerEvent)=>{pointers.current.delete(e.pointerId);if(pointers.current.size<2)pinch.current=null;
  const d=drag.current;drag.current=null;
  // A swipe at normal size steps between images.
  if(d&&d.moved&&scale===1&&Math.abs(e.clientX-d.x)>60&&Math.abs(e.clientX-d.x)>Math.abs(e.clientY-d.y))step(e.clientX<d.x?1:-1);};
 return <div className="image-viewer" role="dialog" aria-modal="true" aria-label={shot.alt||shot.caption||t('Image')} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
  <div className="image-viewer-bar" onClick={e=>e.stopPropagation()}>
   {shots.length>1&&<span className="image-viewer-count">{index+1} / {shots.length}</span>}
   <button type="button" onClick={()=>zoomTo(scale/1.5)} disabled={scale<=MIN} aria-label={t('Zoom out')} title={t('Zoom out')}><ZoomOut size={18}/></button>
   <span className="image-viewer-scale" aria-live="polite">{Math.round(scale*100)}%</span>
   <button type="button" onClick={()=>zoomTo(scale*1.5)} disabled={scale>=MAX} aria-label={t('Zoom in')} title={t('Zoom in')}><ZoomIn size={18}/></button>
   <button type="button" onClick={reset} disabled={scale===1&&!pos.x&&!pos.y} aria-label={t('Reset zoom')} title={t('Reset zoom')}><RotateCcw size={17}/></button>
   <a href={shot.src} target="_blank" rel="noopener noreferrer" aria-label={t('Open original image')} title={t('Open original image')}><ExternalLink size={17}/></a>
   <button ref={closeRef} type="button" onClick={onClose} aria-label={t('Close')} title={t('Close')}><X size={20}/></button>
  </div>
  {shots.length>1&&<button type="button" className="image-viewer-nav prev" onClick={e=>{e.stopPropagation();step(-1);}} aria-label={t('Previous image')}><ChevronLeft size={28}/></button>}
  <div className={'image-viewer-stage'+(scale>1?' zoomed':'')} onWheel={onWheel} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onDoubleClick={()=>scale>1?reset():zoomTo(2.5)} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
   <img src={shot.src} alt={shot.alt} draggable={false} referrerPolicy="no-referrer" style={{transform:`translate(${pos.x}px,${pos.y}px) scale(${scale})`}}/>
  </div>
  {shots.length>1&&<button type="button" className="image-viewer-nav next" onClick={e=>{e.stopPropagation();step(1);}} aria-label={t('Next image')}><ChevronRight size={28}/></button>}
  {shot.caption&&<div className="image-viewer-caption" onClick={e=>e.stopPropagation()}>{shot.caption}</div>}
 </div>;
}
