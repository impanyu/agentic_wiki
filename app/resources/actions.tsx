'use client';
import {useState} from 'react';
import {useUi} from '@/app/i18n/client';
import {ResourcePicker} from './picker';
import type {Resource} from './contracts';
export function TransferActions({pageId,resource,canMove=true,disabled=false,onChanged}:{pageId:string;resource:Resource;canMove?:boolean;disabled?:boolean;onChanged?:()=>void}){
 const {t}=useUi(),[mode,setMode]=useState<'copy'|'move'|null>(null);
 return <span className="resource-actions"><button type="button" disabled={disabled} onClick={()=>setMode('copy')}>{t('Copy to…')}</button>{canMove&&<button type="button" disabled={disabled} onClick={()=>setMode('move')}>{t('Move to…')}</button>}{mode&&<ResourcePicker pageId={pageId} copyMode initialSources={[resource]} initialAction={mode} onClose={()=>{setMode(null);onChanged?.();}}/>}</span>;
}
