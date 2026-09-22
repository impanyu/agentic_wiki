'use client';
import {X} from 'lucide-react';
import {useUi} from '@/app/i18n/client';
import {GeoViewer} from './viewer';
import {toolHref} from '@/app/tools/sources';
import type {SourceRef} from '@/app/tools/sources';

export function RepositoryMap({source,onClose,url}:{source:SourceRef;onClose:()=>void;url?:string}){
 const {t}=useUi();
 return <section className="repository-map" aria-label={t('Map preview')}><header><strong>{source.name||t('Map preview')}</strong><button type="button" onClick={onClose} aria-label={t('Close')}><X size={16}/>{t('Close')}</button></header><a href={toolHref('arcgis-publisher',source)}>{t('Publish to ArcGIS Online')}</a><GeoViewer embedded source={{...source,file:url?undefined:source.file}} initialUrl={url} initialTitle={source.name}/></section>;
}
