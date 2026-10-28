import {resolve,evaluate,bindingsIn,stepRefs} from './expressions';
import {isBinding,type Workflow,type RunTrace} from './schema';
import {describe as statsDescribe,group as statsGroup,histogram as statsHistogram,correlate as statsCorrelate,regress as statsRegress} from './stats';
// Runs a client action entirely in the browser: pure calculation steps only
// (validated), no server round trip, no access to data or permissions.
export async function runClientAction(workflow:Workflow,name:string,input:{state:Record<string,unknown>;values:Record<string,unknown>;event:unknown},page:{id:string;title:string}){
 let state={...input.state};const trace:RunTrace[]=[];let current:string|undefined=name;
 for(let chain=0;current&&chain<5;chain++){
  const action:Workflow['actions'][string]|undefined=workflow.actions[current];if(!action?.client)throw Error('Action '+current+' does not run in the browser.');
  const steps:Record<string,unknown>={},scope=()=>({state,values:input.values,event:input.event??null,page,steps});
  for(const step of action.steps){
   const t0=Date.now();
   if(step.when!==undefined&&!(isBinding(step.when)?await evaluate(step.when.$,scope()):step.when)){steps[step.id]=null;trace.push({step:step.id,tool:step.tool,status:'skipped',ms:0});continue;}
   const run=async(bindings:Record<string,unknown>={})=>{const args=await resolve(step.args||{},scope(),bindings) as Record<string,any>;
    if(step.tool==='compute')return args.value;
    if(step.tool==='json.parse'){const text=typeof args.text==='string'?args.text:String(args.text?.text??args.text?.content??'');return args.lines===true?text.split(/\r?\n/).filter(l=>l.trim()).map(l=>JSON.parse(l)):JSON.parse(text);}
    if(step.tool==='json.format')return JSON.stringify(args.value??null,null,args.pretty===false?0:2);
    if(step.tool==='csv.parse')return parseCsv(args);
    if(step.tool==='csv.format')return formatCsv(args);
    if(step.tool==='page_file.read')return readPageFile(page.id,args);
    const stats:Record<string,(a:Record<string,unknown>)=>unknown>={'stats.describe':statsDescribe,'stats.group':statsGroup,'stats.histogram':statsHistogram,'stats.correlate':statsCorrelate,'stats.regress':statsRegress};
    if(stats[step.tool])return stats[step.tool](args);
    throw Error('Unknown client tool '+step.tool);};
   try{
    if(step.each!==undefined){const list=isBinding(step.each)?await evaluate(step.each.$,scope()):step.each;const arr=list==null?[]:Array.isArray(list)?list:[list];if(arr.length>1000)throw Error('each has more than 1000 items.');const out=[];for(let i=0;i<arr.length;i++)out.push(await run({item:arr[i],index:i}));steps[step.id]=out;}
    else steps[step.id]=await run();
    trace.push({step:step.id,tool:step.tool,status:'ok',ms:Date.now()-t0});
   }catch(e){const message=e instanceof Error?e.message:'Step failed';trace.push({step:step.id,tool:step.tool,status:'error',ms:Date.now()-t0,error:message});if(!step.optional)return {state,trace,error:'Step '+step.id+' failed: '+message};steps[step.id]={error:message};}
  }
  if(action.set){const next={...state};for(const [k,v] of Object.entries(action.set))next[k]=await resolve(v,scope());state=next;}
  current=action.then;
 }
 return {state,trace};
}
export const usedRefs=(v:unknown)=>bindingsIn(v).flatMap(stepRefs);

const textOf=(v:unknown)=>typeof v==='string'?v:v&&typeof v==='object'&&typeof (v as {text?:unknown}).text==='string'?(v as {text:string}).text:String(v??'');
async function parseCsv(a:Record<string,any>){
 const {parse}=await import('csv-parse/browser/esm/sync');const text=textOf(a.text),first=text.split(/\r?\n/,1)[0]||'';
 const delimiter=a.delimiter&&a.delimiter!=='auto'?String(a.delimiter):(['\t',';',','].map(d=>[d,first.split(d).length] as const).sort((x,y)=>y[1]-x[1])[0][1]>1?['\t',';',','].map(d=>[d,first.split(d).length] as const).sort((x,y)=>y[1]-x[1])[0][0]:',');
 return (parse(text,{columns:a.header!==false,delimiter,skip_empty_lines:true,relax_column_count:true,cast:a.cast!==false,bom:true}) as unknown[]).slice(0,100000);
}
function formatCsv(a:Record<string,any>){const rows:Record<string,unknown>[]=Array.isArray(a.rows)?a.rows:[];const cols:string[]=a.columns||[...new Set(rows.flatMap(r=>Object.keys(r||{})))];const cell=(v:unknown)=>{const s=v==null?'':typeof v==='object'?JSON.stringify(v):String(v);return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;};return [cols.join(','),...rows.map(r=>cols.map(c=>cell(r?.[c])).join(','))].join('\n');}
// A Page file of this page, read by the reader's browser (the same access as opening it).
async function readPageFile(pageId:string,a:Record<string,any>){
 const list=await fetch('/api/pages/'+encodeURIComponent(pageId)+'/files').then(r=>r.ok?r.json():Promise.reject(Error('Page files are unavailable.'))) as {files?:{id:string;name:string}[]};
 const file=(list.files||[]).find(f=>f.id===a.fileId||f.name===a.name);if(!file)throw Error('No Page file named '+String(a.name??a.fileId)+'.');
 const response=await fetch('/api/pages/'+encodeURIComponent(pageId)+'/files/'+encodeURIComponent(file.id));if(!response.ok)throw Error('The file could not be read.');
 const text=await response.text();if(text.length>20*1024*1024)throw Error('The file is larger than 20 MB.');
 const as=String(a.as||(/\.(csv|tsv)$/i.test(file.name)?'csv':/\.(json|geojson)$/i.test(file.name)?'json':'text'));
 return as==='csv'?parseCsv({text}):as==='json'?JSON.parse(text):text;
}
