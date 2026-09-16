'use client';
import {useSearchParams} from 'next/navigation';
import {UiContext,usePageUi} from '@/app/i18n/client';
import {Workbench} from './workbench';
export function ToolsRoute(){const p=useSearchParams(),ui=usePageUi(p.get('language')||'en');return <UiContext.Provider value={ui}><main className="native-route"><Workbench app={p.get('app')||'hub'} source={{page:p.get('page')||undefined,file:p.get('file')||undefined,connector:p.get('connector')||undefined,name:p.get('name')||undefined,language:p.get('language')||'en'}}/></main></UiContext.Provider>;}
