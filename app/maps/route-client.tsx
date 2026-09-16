'use client';
import {useSearchParams} from 'next/navigation';
import {UiContext,usePageUi} from '@/app/i18n/client';
import {GeoViewer} from '@/app/geo/viewer';
export function MapsRoute(){const p=useSearchParams(),ui=usePageUi(p.get('language')||'en');return <UiContext.Provider value={ui}><main className="native-route"><GeoViewer source={{page:p.get('page')||undefined,file:p.get('file')||undefined,connector:p.get('connector')||undefined,name:p.get('name')||undefined,language:p.get('language')||'en'}}/></main></UiContext.Provider>;}
