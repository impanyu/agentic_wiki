'use client';
import {useEffect,useState,useRef,type CSSProperties} from 'react';
import {ArrowLeft,ExternalLink,FolderSearch,HardDriveUpload} from 'lucide-react';
import {processingCatalog,processingRunName,type ProcessingField} from './processing-catalog';
import {toolInfo,siFieldState} from './tool-info';
import {ResourcePicker} from '@/app/resources/picker';
import type {Resource} from '@/app/resources/contracts';
import {useUi} from '@/app/i18n/client';
import {toolHref} from '@/app/tools/sources';
import './processing.css';
type Account={id:string;name:string;allowed:string[]};type Item={id:string;name:string;is_public?:boolean};
const toolPageHref=(locale:string,slug?:string)=>'/tools?'+new URLSearchParams({app:'adma-tools',language:locale,...(slug?{tool:slug}:{})});
// Each catalog tool has its own dedicated page (ToolWorkbench); without a tool
// reference this renders the tool directory, like ADMA's own Tools page.
export function ProcessingPanel({pageId,writable,initialTool=''}:{pageId:string;writable:boolean;initialTool?:string}){
 const spec=processingCatalog.find(s=>s.slug===initialTool);
 return spec?<ToolWorkbench pageId={pageId} writable={writable} slug={spec.slug}/>:<ToolsHub/>;
}
function ToolsHub(){
 const {t,locale}=useUi();
 return <section className="adma-processing processing-hub"><header><h2>{t('ADMA processing tools')}</h2><p>{t('Run agricultural data tools with your connected ADMA account.')} {t('Each tool opens on its own page.')}</p></header>
 <div className="hub-cards">{processingCatalog.map(spec=>{const info=toolInfo[spec.slug];return <a key={spec.slug} className="hub-card" href={toolPageHref(locale,spec.slug)}><span className="hub-thumb" style={{background:info?.gradient,color:info?.accent}} aria-hidden="true">{info&&<info.Icon size={34}/>}</span><strong>{t(spec.name)}</strong><span className="hub-description">{t(spec.description)}</span></a>;})}</div>
 </section>;
}
function ToolWorkbench({pageId,writable,slug}:{pageId:string;writable:boolean;slug:string}){
 const {t,locale}=useUi(),[accounts,setAccounts]=useState<Account[]>([]),[account,setAccount]=useState(''),[values,setValues]=useState<Record<string,string>>({}),[files,setFiles]=useState<Item[]>([]),[folders,setFolders]=useState<Item[]>([]),[custom,setCustom]=useState<Record<string,boolean>>({}),[picker,setPicker]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[task,setTask]=useState(''),[result,setResult]=useState<any>(null);
 const operation=useRef<{key:string;id:string}|null>(null),uploadInput=useRef<HTMLInputElement>(null),uploadField=useRef('');
 const spec=processingCatalog.find(s=>s.slug===slug)!,info=toolInfo[slug],connection=accounts.find(a=>a.id===account),can=(name:string)=>!!connection?.allowed.includes(name),endpoint='/api/pages/'+encodeURIComponent(pageId)+'/adma',historyKey='adma-processing:'+pageId+':'+account+':'+slug;
 const workflow=values.workflow||'standard_uav',state=(name:string)=>slug==='si-tool'?siFieldState(workflow,name):'default';
 const activeFields=spec.fields.filter(f=>state(f.name)!=='hidden');
 async function call(tool:string,args:Record<string,unknown>,confirm=false){const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({connectorId:account,tool,args,confirm})}),d:any=await r.json();if(!r.ok)throw Error(d.error||'ADMA request failed.');if(d.result?.confirmationRequired)throw Error('Enable this tool in Connectors.');return d.result;}
 useEffect(()=>{let live=true;fetch(endpoint).then(r=>r.json()).then((d:any)=>{if(!live)return;if(d.error)throw Error(d.error);setAccounts(d.accounts||[]);setAccount(d.accounts?.[0]?.id||'');}).catch(e=>live&&setError(String(e)));return()=>{live=false;};},[endpoint]);
 useEffect(()=>{setValues(Object.fromEntries(spec.fields.filter(f=>f.value!==undefined).map(f=>[f.name,String(f.value)])));},[slug]);
 useEffect(()=>{setFiles([]);setFolders([]);setResult(null);setTask('');if(!account)return;try{setTask(localStorage.getItem(historyKey)||'');}catch{}let live=true;Promise.all([can('list_files')?call('list_files',{}):{files:[]},can('list_folders')?call('list_folders',{}):{folders:[]}]).then(([a,b])=>{if(live){setFiles((a.files||[]).filter((f:Item)=>f.is_public===false));setFolders((b.folders||[]).filter((f:Item)=>f.is_public===false));}}).catch(e=>live&&setError(String(e)));return()=>{live=false;};},[account]);
 async function run(){setBusy(true);setError('');setResult(null);try{const args=Object.fromEntries(activeFields.filter(f=>values[f.name]?.trim()).map(f=>[f.name,f.type==='number'?Number(values[f.name]):values[f.name].trim()]));const key=JSON.stringify([account,slug,args]);if(operation.current?.key!==key)operation.current={key,id:crypto.randomUUID()};const r=await call(processingRunName(slug),{...args,operation_id:operation.current.id},true);setTask(r.task_id);setResult(r);try{localStorage.setItem(historyKey,r.task_id);}catch{}}catch(e){setError(String(e));}finally{setBusy(false);}}
 async function check(){setBusy(true);setError('');try{setResult(await call('processing_status',{task_id:task}));}catch(e){setError(String(e));}finally{setBusy(false);}}
 async function guard(fn:()=>Promise<void>){setBusy(true);setError('');try{await fn();}catch(e){setError(String(e));}finally{setBusy(false);}}
 // A selection from another repository is first transferred into the user's
 // private ADMA workspace; the tool then runs on the new ADMA file.
 async function adopt(name:string,resource:Resource){
  if(resource.kind!=='file')throw Error('Choose a file, not a folder.');
  if(resource.space==='adma'&&resource.connectorId===account){setFiles(old=>old.some(x=>x.id===resource.id)?old:[...old,{id:resource.id,name:resource.name,is_public:false}]);setValues(v=>({...v,[name]:resource.id}));return;}
  const r=await fetch('/api/pages/'+encodeURIComponent(pageId)+'/resources',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operationId:crypto.randomUUID(),sources:[resource],destination:{space:'adma',id:'',kind:'folder',name:'My ADMA files',connectorId:account}})}),d=await r.json() as {error?:string;copied?:{result?:{files?:Item[]}}[];failed?:{error?:string}[]};
  if(!r.ok)throw Error(d.error||'Transfer to ADMA failed.');
  const copied=d.copied?.find(entry=>entry.result?.files?.length)?.result?.files?.[0];
  if(!copied?.id)throw Error(d.failed?.[0]?.error||'ADMA did not accept this file.');
  setFiles(old=>[...old,{id:copied.id,name:copied.name,is_public:false}]);setValues(v=>({...v,[name]:copied.id}));
 }
 async function uploadLocal(name:string,file:File){
  if(file.size>10*1024*1024)throw Error('Choose a file up to 10 MB.');
  const r=await fetch('/api/components/upload',{method:'POST',headers:{'Content-Type':file.type||'application/octet-stream','X-Page-Id':pageId,'X-File-Name':encodeURIComponent(file.name),'X-Folder-Path':''},body:file}),d=await r.json() as {error?:string;file?:{id:string}};
  if(!r.ok)throw Error(d.error||'Upload failed.');
  if(!d.file?.id)throw Error('Upload did not attach to this page.');
  await adopt(name,{space:'page',id:d.file.id,kind:'file',name:file.name});
 }
 const outputFiles:Item[]=[];function collect(value:any,depth=0){if(!value||depth>8)return;if(Array.isArray(value)){value.forEach(v=>collect(v,depth+1));return;}if(typeof value==='object'){if(typeof value.id==='string'&&typeof value.name==='string'&&/^[a-f0-9-]{36}$/i.test(value.id)&&!outputFiles.some(f=>f.id===value.id))outputFiles.push(value);Object.values(value).forEach(v=>collect(v,depth+1));}}collect(result?.result);
 function field(f:ProcessingField){const required=f.required||state(f.name)==='required',help=info?.fieldHelp[f.name];
  if(f.type==='file'||f.type==='folder'){
   const pool=f.type==='file'?files:folders,accept=info?.accept[f.name],matches=f.type==='file'&&accept?pool.filter(x=>new RegExp(accept,'i').test(x.name)):pool,chosen=pool.find(x=>x.id===values[f.name]);
   const manual=custom[f.name]||(!!values[f.name]&&!chosen);
   return <label key={f.name}>{t(f.label)}{required?' *':''}
    {manual?<><input list={f.type==='file'?(info?.accept[f.name]?'processing-files-'+f.name:'processing-files'):'processing-folders'} required={required} type="text" value={values[f.name]||''} onChange={e=>setValues({...values,[f.name]:e.target.value})}/><small>{t('Paste an ADMA resource ID, or')} <button type="button" className="field-link" onClick={()=>{setCustom({...custom,[f.name]:false});setValues({...values,[f.name]:''});}}>{t('choose from your files')}</button></small></>
    :<><select required={required} value={chosen?values[f.name]:''} onChange={e=>{if(e.target.value==='__custom'){setCustom({...custom,[f.name]:true});setValues({...values,[f.name]:''});}else setValues({...values,[f.name]:e.target.value});}}>
     <option value="">{f.type==='folder'?t('Auto-create output folder (default)'):t('Choose from my ADMA files…')}</option>
     {matches.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}
     <option value="__custom">{t('Enter an ID manually…')}</option>
    </select>
    {f.type==='file'&&!matches.length&&<small>{t('No matching private files found in your ADMA account.')}</small>}
    {chosen&&<small className="field-selected">✓ {t('Selected:')} {chosen.name}</small>}
    {help&&<small>{t(help)}</small>}</>}
    {f.type==='file'&&<span className="field-sources"><button type="button" disabled={busy} onClick={()=>setPicker(f.name)}><FolderSearch size={14}/>{t('Google Drive & all sources…')}</button><button type="button" disabled={busy} onClick={()=>{uploadField.current=f.name;uploadInput.current?.click();}}><HardDriveUpload size={14}/>{t('Upload from computer')}</button></span>}
   </label>;
  }
  return <label key={f.name}>{t(f.label)}{required?' *':''}{f.type==='select'?<select required={required} value={values[f.name]||''} onChange={e=>setValues({...values,[f.name]:e.target.value})}>{f.options?.map(x=><option key={x}>{x}</option>)}</select>:<><input required={required} type={f.type==='number'?'number':'text'} step="any" value={values[f.name]||''} onChange={e=>setValues({...values,[f.name]:e.target.value})}/>{help&&<small>{t(help)}</small>}</>}</label>;}
 // The SI workflow is chosen like on ADMA's page: methodology and imagery selects.
 function workflowStep(){const [treatment,imagery]=workflow.split('_'),set=(a:string,b:string)=>setValues({...values,workflow:a+'_'+b});return <div className="processing-fields"><label>{t('Treatment methodology')}<select value={treatment} onChange={e=>set(e.target.value,imagery)}><option value="standard">{t('STANDARD')}</option><option value="sbf">{t('SBF (Sensor-Based Fertigation)')}</option></select></label><label>{t('Imagery type')}<select value={imagery} onChange={e=>set(treatment,e.target.value)}><option value="uav">{t('UAV')}</option><option value="satellite">{t('Satellite')}</option></select></label></div>;}
 if(!info||!spec)return null;
 return <section className="adma-processing processing-tool" style={{'--tool-accent':info.accent} as CSSProperties}>
 <nav className="tool-return"><a href={toolPageHref(locale)}><ArrowLeft size={15}/>{t('All ADMA tools')}</a><a href="https://adma.aisoup.net/tools/" target="_blank" rel="noreferrer">{t('Open in ADMA')} <ExternalLink size={13}/></a></nav>
 <header className="tool-banner" style={{background:info.gradient}}><span className="tool-glyph" aria-hidden="true"><info.Icon size={38}/></span><div><h2>{t(spec.name)}</h2><p className="tool-subtitle">{t(info.subtitle)}</p><p>{t(info.intro)}</p><ul className="tool-outputs">{info.outputs.map(([term,text])=><li key={term}><strong>{t(term)}</strong> – {t(text)}</li>)}</ul></div></header>
 {!account?<p>{t('Enable your ADMA connection in Connectors to browse your files.')}</p>:<>
 {accounts.length>1&&<label className="tool-account">{t('Account')}<select value={account} disabled={busy} onChange={e=>setAccount(e.target.value)}>{accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>}
 {!writable&&<p>{t("Fork this page to run tools in your private workspace.")}</p>}
 <p>{t('Processing writes output files. Use private input files and a private output folder. Copy shared datasets into your private ADMA workspace first.')}</p>
 <p className="step-help">{t('Files picked from Page files, Google Drive, Dropbox, OneDrive or your computer are transferred into your private ADMA workspace before the tool runs. Shapefiles need their sidecar files (.dbf, .shx, .prj) transferred as well.')}</p>
 <datalist id="processing-files">{files.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</datalist><datalist id="processing-folders">{folders.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</datalist>
 {Object.entries(info.accept).map(([name,pattern])=>{const expression=new RegExp(pattern,'i');return <datalist key={name} id={'processing-files-'+name}>{files.filter(f=>expression.test(f.name)).map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</datalist>;})}
 <form onSubmit={e=>{e.preventDefault();void run();}}><fieldset disabled={busy||!writable}>
 {info.steps.map((step,index)=>{const stepFields=step.fields.map(name=>spec.fields.find(f=>f.name===name)).filter((f):f is ProcessingField=>!!f&&state(f.name)!=='hidden'&&!(slug==='si-tool'&&f.name==='workflow'));const isWorkflow=slug==='si-tool'&&step.fields.includes('workflow');if(!isWorkflow&&!stepFields.length)return null;
  return <section className="tool-step" key={step.title}><h3><span className="step-badge">{index+1}</span>{t(step.title)}</h3>{step.help&&<p className="step-help">{t(step.help)}</p>}{isWorkflow?workflowStep():<div className="processing-fields">{stepFields.map(field)}</div>}</section>;})}
 <button className="tool-run" disabled={!can(processingRunName(slug))||!!task&&!['SUCCESS','FAILURE','REVOKED'].includes(result?.status)}>{t(info.runLabel)}</button></fieldset></form>
 {!can(processingRunName(slug))&&<p>{t('Enable this tool in Connectors.')} <code>{processingRunName(slug)}</code></p>}
 <div className="processing-task"><label>{t('Task ID')}<input value={task} onChange={e=>{setTask(e.target.value);setResult(null);}}/></label><button disabled={busy||!task||!can('processing_status')} onClick={()=>void check()}>{t('Check status')}</button><button disabled={busy} onClick={()=>{operation.current=null;setTask('');setResult(null);try{localStorage.removeItem(historyKey);}catch{}}}>{t('New task')}</button></div>
 {result&&<><p role="status">{t('Status')}: {String(result.status||'SUBMITTED')}{result.result?.success===false?' · '+t('Task failed'):''}</p>{outputFiles.length>0&&<ul>{outputFiles.map(f=><li key={f.id}><strong>{f.name}</strong> <a href={toolHref(/\.(geojson|kml|gpx)$/i.test(f.name)?'map':'hub',{page:pageId,connector:account,file:f.id,name:f.name,language:locale})}>{t('Open with…')}</a> <a href={'https://adma.aisoup.net/file/'+encodeURIComponent(f.id)+'/'} target="_blank" rel="noreferrer">{t('Open in ADMA')}</a></li>)}</ul>}<details><summary>{t('Result details')}</summary><pre>{JSON.stringify(result,null,2)}</pre></details></>}
 </>}{error&&<p role="alert">{error}</p>}
 <input hidden ref={uploadInput} type="file" onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void guard(()=>uploadLocal(uploadField.current,file));}}/>
 {picker&&<ResourcePicker pageId={pageId} selectLabel="Use selected file" onClose={()=>setPicker('')} onSelect={mentions=>{const mention=mentions.find(m=>m.type==='resource');const name=picker;if(mention&&'resource' in mention)void guard(()=>adopt(name,mention.resource));}}/>}
 </section>;
}
