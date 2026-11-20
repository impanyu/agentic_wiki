import {env} from '@/server/runtime';
// Datasets are tables an agent fetched or derived during its work (a World Bank indicator,
// a Wikipedia list table, a Wikidata query…). They stay on the server so the agent handles
// ids, column names and previews instead of copying hundreds of rows through its context,
// and so the numbers that reach a page are exactly the numbers that were fetched.
// A dataset belongs to one scope (the agent instance, else the user) and is kept for a day.
export type Row=Record<string,unknown>;
export type Dataset={id:string;title:string;source:string;columns:string[];rows:Row[];createdAt:string;notes?:string};
export type DatasetSummary={datasetId:string;title:string;source:string;rowCount:number;columns:{name:string;type:string;filled:number;example?:unknown}[];preview:Row[];notes?:string};
export const DATASET_LIMITS={rows:100_000,bytes:30*1024*1024,previewRows:8,ttlMs:24*3600_000};
type Bucket={put(key:string,value:string):Promise<unknown>;get(key:string):Promise<{text():Promise<string>}|null>};
const bucket=()=>(env as unknown as {FILES:Bucket}).FILES;
const key=(scope:string,id:string)=>'datasets/'+scope+'/'+id+'.json';
const ID=/^ds_[a-z0-9]{8,32}$/;
export const datasetScope=(ctx:{agent?:{id:string}|null;userId:string})=>ctx.agent?.id||ctx.userId||'anonymous';
function columnsOf(rows:Row[]){const seen=new Set<string>();for(const r of rows.slice(0,2000))for(const k of Object.keys(r))seen.add(k);return [...seen];}
function typeOf(values:unknown[]){const t=new Set(values.filter(v=>v!=null&&v!=='').map(v=>typeof v==='number'?'number':typeof v==='boolean'?'boolean':typeof v==='string'?(/^-?\d+(\.\d+)?$/.test(v.trim())?'numeric-text':'text'):Array.isArray(v)?'array':'object'));return t.size===0?'empty':t.size===1?[...t][0]:'mixed('+[...t].join(',')+')';}
export function summarize(d:Dataset):DatasetSummary{
 const sample=d.rows.slice(0,2000);
 return {datasetId:d.id,title:d.title,source:d.source,rowCount:d.rows.length,notes:d.notes,
  columns:d.columns.map(name=>{const values=sample.map(r=>r[name]);const example=values.find(v=>v!=null&&v!=='');return {name,type:typeOf(values),filled:d.rows.filter(r=>r[name]!=null&&r[name]!=='').length,...example!==undefined?{example:typeof example==='string'&&example.length>80?example.slice(0,80)+'…':example}:{}};}),
  preview:d.rows.slice(0,DATASET_LIMITS.previewRows)};
}
// Rows must be plain objects; scalars and arrays are wrapped so every dataset is a table.
export function normalizeRows(raw:unknown):Row[]{
 const list=Array.isArray(raw)?raw:raw&&typeof raw==='object'?[raw]:[];
 return list.slice(0,DATASET_LIMITS.rows).map(r=>r&&typeof r==='object'&&!Array.isArray(r)?r as Row:{value:r});
}
export async function saveDataset(scope:string,input:{title:string;source:string;rows:unknown;columns?:string[];notes?:string}):Promise<DatasetSummary>{
 const rows=normalizeRows(input.rows);
 const d:Dataset={id:'ds_'+crypto.randomUUID().replace(/-/g,'').slice(0,16),title:String(input.title||'Dataset').slice(0,200),source:String(input.source||'').slice(0,2000),columns:input.columns?.length?input.columns:columnsOf(rows),rows,createdAt:new Date().toISOString(),...input.notes?{notes:input.notes.slice(0,2000)}:{}};
 const text=JSON.stringify(d);if(text.length>DATASET_LIMITS.bytes)throw Error('The dataset is larger than 30 MB; select fewer columns or rows.');
 await bucket().put(key(scope,d.id),text);
 return summarize(d);
}
export async function loadDataset(scope:string,id:string):Promise<Dataset>{
 if(!ID.test(id))throw Error('Unknown dataset '+id+'.');
 const o=await bucket().get(key(scope,id));if(!o)throw Error('Unknown dataset '+id+' (datasets last for this task only).');
 const d=JSON.parse(await o.text()) as Dataset;
 if(Date.now()-Date.parse(d.createdAt)>DATASET_LIMITS.ttlMs)throw Error('Dataset '+id+' has expired; fetch it again.');
 return d;
}
