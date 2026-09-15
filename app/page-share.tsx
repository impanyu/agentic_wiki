'use client';
import {useUi} from '@/app/i18n/client';
import {useState} from 'react';
import {Copy,Share2} from 'lucide-react';
import {pageAccess,type PageAccess} from './page-permissions';
import type {AnswerPage} from './page-types';

export function PageShare({page,disabled,onAccess}:{page:AnswerPage;disabled:boolean;onAccess:(access:PageAccess)=>Promise<boolean>}){
 const {t,locale}=useUi();

 const [open,setOpen]=useState(false),[link,setLink]=useState(''),[notice,setNotice]=useState(''),[working,setWorking]=useState(false);
 const zh=page.language.startsWith('zh');
 async function copy(url:string){
  try{await navigator.clipboard.writeText(url);setNotice("Link copied.");}
  catch{setNotice("Copy the link below.");}
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
  <button type="button" disabled={disabled||working} aria-expanded={open} onClick={()=>setOpen(v=>!v)}><Share2 size={15}/>{t("Share")}</button>
  {open&&<div className="page-share-panel">
   {page.owned?<><p>{t("Choose access and copy the link:")}</p>
    <button disabled={disabled||working} onClick={()=>void share('public-read')}>{t("Public read only · Copy link")}</button>
    <button disabled={disabled||working} onClick={()=>void share('public-write')}>{t("Public read & write · Copy link")}</button>
    <small>{t("Sharing updates this page’s access. The same link always follows its current permissions.")}</small>
   </>:<><p>{pageAccess(page)==='public-write'?(t("Current access: Public read & write")):(t("Current access: Public read only"))}</p><button disabled={disabled||working} onClick={()=>void share(pageAccess(page))}><Copy size={14}/>{t("Copy link")}</button><small>{t("Only the owner can change sharing permissions.")}</small></>}
   {link&&<input aria-label={t("Page share link")} readOnly value={link} onFocus={e=>e.target.select()}/>}
   <p role="status">{working?(t("Preparing link…")):t(notice)}</p>
  </div>}
 </div>;
}
