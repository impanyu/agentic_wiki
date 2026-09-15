'use client';
import {useState} from 'react';
import {Copy,Share2} from 'lucide-react';
import {pageAccess,type PageAccess} from './page-permissions';
import type {AnswerPage} from './page-types';

export function PageShare({page,disabled,onAccess}:{page:AnswerPage;disabled:boolean;onAccess:(access:PageAccess)=>Promise<boolean>}){
 const [open,setOpen]=useState(false),[link,setLink]=useState(''),[notice,setNotice]=useState(''),[working,setWorking]=useState(false);
 const zh=page.language.startsWith('zh');
 async function copy(url:string){
  try{await navigator.clipboard.writeText(url);setNotice(zh?'链接已复制。':'Link copied.');}
  catch{setNotice(zh?'请复制下方链接。':'Copy the link below.');}
 }
 async function share(access:PageAccess){
  if(working||disabled)return;
  setWorking(true);setNotice('');setLink('');
  try{
   if(page.owned){if(!await onAccess(access))return;}
   else if(page.visibility!=='public')return;
   const url=new URL('/',window.location.origin);url.searchParams.set('page',page.id);
   setLink(url.href);await copy(url.href);
  }finally{setWorking(false);}
 }
 return <div className="page-share">
  <button type="button" disabled={disabled||working} aria-expanded={open} onClick={()=>setOpen(v=>!v)}><Share2 size={15}/>{zh?'分享':'Share'}</button>
  {open&&<div className="page-share-panel">
   {page.owned?<><p>{zh?'选择分享权限并复制链接：':'Choose access and copy the link:'}</p>
    <button disabled={disabled||working} onClick={()=>void share('public-read')}>{zh?'Public 只读 · 复制链接':'Public read only · Copy link'}</button>
    <button disabled={disabled||working} onClick={()=>void share('public-write')}>{zh?'Public 读写 · 复制链接':'Public read & write · Copy link'}</button>
    <small>{zh?'分享会同步修改此页面的权限。同一个链接始终遵循页面当前权限。':'Sharing updates this page’s access. The same link always follows its current permissions.'}</small>
   </>:<><p>{pageAccess(page)==='public-write'?(zh?'当前权限：Public 读写':'Current access: Public read & write'):(zh?'当前权限：Public 只读':'Current access: Public read only')}</p><button disabled={disabled||working} onClick={()=>void share(pageAccess(page))}><Copy size={14}/>{zh?'复制链接':'Copy link'}</button><small>{zh?'只有所有者可以更改分享权限。':'Only the owner can change sharing permissions.'}</small></>}
   {link&&<input aria-label={zh?'页面分享链接':'Page share link'} readOnly value={link} onFocus={e=>e.target.select()}/>}
   <p role="status">{working?(zh?'正在准备分享…':'Preparing link…'):notice}</p>
  </div>}
 </div>;
}
