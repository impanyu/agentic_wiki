'use client';
import {X} from 'lucide-react';
import {useUi} from '@/app/i18n/client';
import {GeoViewer} from './viewer';
import type {SourceRef} from '@/app/tools/sources';

export function RepositoryMap({source,onClose}:{source:SourceRef;onClose:()=>void}){
 const {t}=useUi();
 return <section className="repository-map" aria-label={t('Map preview')}><header><strong>{source.name||t('Map preview')}</strong><button type="button" onClick={onClose} aria-label={t('Close')}><X size={16}/>{t('Close')}</button></header><GeoViewer embedded source={source}/></section>;
}
