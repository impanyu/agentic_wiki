import {saveDataset,DATASET_LIMITS,type DatasetSummary} from './datasets';
import {fetchText} from './net';
import {parseDelimited,parseJsonLines,xmlRows,xmlToValue,parseXml,jsonRows,flattenRow,detectFormat,blockedReason,type DataFormat,type Row} from './parse';
import {extractTables,htmlTitle} from './html';
import {evaluateJsonata,resultRows} from './query';
import {paginate,setParam} from './paging';
// fetch_data: one public URL (optionally several pages of it) → one dataset.
export type FetchDataArgs={url:string;format:'auto'|DataFormat;select:string;tableIndex:number;pages:number;nextPage:string;title:string};
type Parsed={raw:unknown;rows:Row[];format:DataFormat;note?:string;title?:string;tables?:unknown[]};
const scopeHint=(raw:unknown)=>{try{return JSON.stringify(raw,(k,v)=>Array.isArray(v)&&v.length>3?[...v.slice(0,2),'…'+v.length+' items']:typeof v==='string'&&v.length>60?v.slice(0,60)+'…':v).slice(0,600);}catch{return '';}};
export async function parseResponse(text:string,contentType:string,url:string,format:FetchDataArgs['format'],select:string,tableIndex:number):Promise<Parsed>{
 const fmt=format==='auto'||!format?detectFormat(contentType,text,url):format;
 let raw:unknown,rows:Row[]=[],note:string|undefined,title:string|undefined,tables:unknown[]|undefined;
 if(fmt==='json'){try{raw=JSON.parse(text);}catch{throw Error('The response is not valid JSON'+(/^\s*</.test(text)?' (it looks like HTML or XML; try format "html_table" or "xml")':'')+'.');}
  if(!select){const r=jsonRows(raw);rows=r.rows;note='Rows taken from '+r.path+' (nested objects flattened to dotted columns). Use select to choose or reshape rows.';}}
 else if(fmt==='jsonl'){raw=parseJsonLines(text);if(!select)rows=(raw as unknown[]).map(x=>x&&typeof x==='object'&&!Array.isArray(x)?flattenRow(x as Row):{value:x});}
 else if(fmt==='csv'||fmt==='tsv'){raw=parseDelimited(text,fmt==='tsv'?'\t':undefined);rows=raw as Row[];}
 else if(fmt==='xml'){const root=parseXml(text);raw=xmlToValue(root);if(!select){const r=xmlRows(text);rows=r.rows;note='Rows are the repeated <'+r.element+'> elements (attributes as "@name", nested elements as dotted columns).';}}
 else{
  const blocked=blockedReason(text.replace(/<[^>]+>/g,' '),htmlTitle(text),url);if(blocked)throw Error(blocked);
  const all=extractTables(text,{baseUrl:url});title=htmlTitle(text);
  tables=all.map(t=>({index:t.index,caption:t.caption,section:t.section,headers:t.headers.slice(0,25),rowCount:t.rows.length}));
  if(tableIndex===-1)return {raw:null,rows:[],format:'html_table',tables,title};
  if(!all.length)throw Error('No data tables were found on this page'+(/<script/i.test(text)?' (its content may be built by JavaScript: try browse_page or extract_tables with render=true)':'')+'.');
  const t=all[tableIndex];if(!t)throw Error('There is no table '+tableIndex+'; the page has '+all.length+' tables (0–'+(all.length-1)+'). Use tableIndex -1 to list them.');
  raw=t.rows;rows=t.rows;note='Table '+tableIndex+(t.caption?' "'+t.caption+'"':'')+(t.section?' in section "'+t.section+'"':'')+' of '+all.length+'.';
 }
 if(select){
  const result=await evaluateJsonata(select,raw,{url,setParam},10_000,()=>'the parsed response looks like '+scopeHint(raw));
  rows=resultRows(result,DATASET_LIMITS.rows).rows.map(r=>flattenRow(r));
 }
 return {raw,rows,format:fmt,note,title,tables};
}
export async function fetchData(args:FetchDataArgs,scope:string,signal:AbortSignal):Promise<DatasetSummary&{format:string;pages?:unknown;stop?:string}|{url:string;title?:string;tables:unknown[];note:string}>{
 const maxPages=Math.min(50,Math.max(1,Math.floor(args.pages||1)));
 const nextPage=(args.nextPage||'').trim();
 if(maxPages>1&&!nextPage)throw Error('To follow several pages give nextPage: a JSONata expression over the parsed response that returns the next URL or null, e.g. for the World Bank API: \'$[0].page < $[0].pages ? $setParam($url, "page", $[0].page + 1) : null\'.');
 let format:DataFormat='json',note:string|undefined,listed:Parsed|null=null;
 const fetchOne=async(url:string)=>{
  const res=await fetchText(url,signal,{anyType:args.format!=='auto'&&!!args.format});
  const p=await parseResponse(res.text,res.type,res.url,args.format||'auto',args.select||'',Number.isInteger(args.tableIndex)?args.tableIndex:0);
  format=p.format;note=note||p.note;if(p.tables&&args.tableIndex===-1)listed=p;
  return {rows:p.rows,raw:p.raw,url:res.url};
 };
 const run=await paginate(args.url,maxPages,fetchOne,async(page,i)=>{
  if(!nextPage)return null;
  const next=await evaluateJsonata(nextPage,page.raw,{url:page.url,page:i+1,setParam},5000);
  return typeof next==='string'?next:null;
 });
 if(listed){const l=listed as Parsed;return {url:args.url,title:l.title,tables:l.tables||[],note:'Call fetch_data again with tableIndex set to the table you want (or use extract_tables to save them all).'};}
 if(!run.rows.length)throw Error('No rows were found'+(args.select?' (the select expression returned nothing)':'')+'. '+(note||''));
 const summary=await saveDataset(scope,{title:args.title||new URL(args.url).hostname+' data',source:args.url+(run.pages.length>1?' ('+run.pages.length+' pages)':''),rows:run.rows,notes:note});
 return {...summary,format,...(run.pages.length>1||maxPages>1?{pages:run.pages.length,stop:run.stop}:{})};
}
