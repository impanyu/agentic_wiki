'use client';
import {useEffect,useRef,type RefObject} from 'react';

/** Dismiss floating surfaces without swallowing the click on the page beneath. */
export function useDismissFloating(open:boolean,surface:RefObject<HTMLElement|null>,dismiss:()=>void,trigger?:RefObject<HTMLElement|null>){
 const callback=useRef(dismiss);callback.current=dismiss;
 useEffect(()=>{
  if(!open)return;
  const outside=(event:PointerEvent)=>{
   const node=surface.current;if(!node)return;
   if(trigger?.current?.contains(event.target as Node))return;
   if(node.contains(event.target as Node)){
    // Native modal backdrops retarget pointer events to the dialog itself.
    if(!(node instanceof HTMLDialogElement)||event.target!==node)return;
    const box=node.getBoundingClientRect();
    if(event.clientX>=box.left&&event.clientX<=box.right&&event.clientY>=box.top&&event.clientY<=box.bottom)return;
   }
   callback.current();
  };
  const keyboard=(event:KeyboardEvent)=>{if(event.key==='Escape'){callback.current();trigger?.current?.focus();}};
  document.addEventListener('pointerdown',outside,true);
  document.addEventListener('keydown',keyboard);
  return()=>{document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',keyboard);};
 },[open,surface,trigger]);
}
