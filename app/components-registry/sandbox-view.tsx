'use client';
import {useMemo} from 'react';
import {sandboxDocument,type SandboxDefinition} from './sandbox-contracts';
export function SandboxView({app,title}:{app:SandboxDefinition;title:string}){const document=useMemo(()=>sandboxDocument(app),[app]);return <iframe title={title} sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={document} style={{width:'100%',height:app.height,border:'1px solid #dce2ea',borderRadius:12,background:'white',margin:'24px 0'}}/>;}
