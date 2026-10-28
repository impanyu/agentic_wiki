'use client';
import {useMemo} from 'react';
import {useUi} from '@/app/i18n/client';
import {WorkflowApp} from './app';
import {blockWorkflow,excludedComponents} from './component-block';
// Renders an article's ```component block with the platform components; a broken
// block explains why, with its source kept in a collapsed section.
export function ComponentBlock({code,pageId,title}:{code:string;pageId:string;title:string}){
 const {t}=useUi();
 const parsed=useMemo(()=>{try{const w=blockWorkflow(JSON.parse(code)),excluded=excludedComponents(w);if(excluded.length)throw Error(excluded.join(', ')+' cannot be used in an article.');return {workflow:w};}catch(e){return {error:e instanceof Error?e.message:'Invalid component block.'};}},[code]);
 if(!parsed.workflow)return <div className="chart-invalid" role="note"><strong>{t('This component could not be displayed.')}</strong><p>{parsed.error}</p><details><summary>{t('Component source')}</summary><pre>{code}</pre></details></div>;
 return <div className="wiki-component"><WorkflowApp workflow={parsed.workflow} pageId={pageId} title={parsed.workflow.title||title} writable={false}/></div>;
}
