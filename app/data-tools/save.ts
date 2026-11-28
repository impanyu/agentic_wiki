import {looseJson} from './args';
import {loadDataset,saveDataset,summarize,DATASET_LIMITS} from './datasets';
import {evaluateJsonata,resultRows} from './query';
import {sqlQuery,looksLikeSql} from './sql-query';
import {columnStats,rowRange,pickColumns,toCsv,fitRows} from './table-ops';
import {setParam} from './paging';
import type {AgentContext} from '@/app/components-registry/registry';
// query_data, describe_data and save_data: work on saved datasets by id.
const list=(s:string)=>s.split(',').map(x=>x.trim()).filter(Boolean);
function parseObject(text:string,what:string):Record<string,string>{
 if(!text.trim())return {};
 let v:unknown;try{v=looseJson(text);if(v===undefined)return {};}catch{throw Error(what+' must be a JSON object string, e.g. {"pop":"ds_…","gdp":"ds_…"}.');}
 if(!v||typeof v!=='object'||Array.isArray(v))throw Error(what+' must be a JSON object.');
 return Object.fromEntries(Object.entries(v as Record<string,unknown>).map(([k,x])=>[k,String(x)]));
}
export async function queryData(args:{inputs:string;expression:string;title:string},scope:string){
 const inputs=parseObject(args.inputs,'inputs');const aliases=Object.keys(inputs);
 if(!aliases.length)throw Error('inputs needs at least one alias, e.g. {"pop":"ds_…"}.');
 if(aliases.length>8)throw Error('Use at most 8 inputs.');
 const bad=aliases.find(a=>!/^[A-Za-z_][A-Za-z0-9_]*$/.test(a));if(bad)throw Error('Alias "'+bad+'" must be a simple name (letters, digits, _).');
 const data:Record<string,unknown[]>={},tables:Record<string,{rows:Record<string,unknown>[];columns:string[]}>={},described:string[]=[];
 const sql=looksLikeSql(args.expression);
 for(const a of aliases){const d=await loadDataset(scope,inputs[a]);data[a]=d.rows;tables[a]={rows:d.rows as Record<string,unknown>[],columns:d.columns};described.push(a+' ('+d.rows.length+' rows; columns: '+d.columns.slice(0,40).map(c=>sql?(/^[a-z_][a-z0-9_]*$/.test(c)?c:'"'+c+'"'):/^[A-Za-z_]\w*$/.test(c)?c:'`'+c+'`').join(', ')+')');}
 // SQL (SELECT / WITH): each alias is a table. Otherwise JSONata; an expression whose quotes were escaped once too
 // often (\"name\") is read with plain quotes.
 const result=sql?await sqlQuery(args.expression,tables,15_000)
  :await evaluateJsonata(args.expression,data,{setParam},15_000,()=>described.join('; ')+'. Refer to a dataset by its alias (e.g. '+aliases[0]+'[value > 0]) and to columns with spaces in backticks. Or write SQL instead (SELECT … FROM '+aliases[0]+' …).')
   .catch(async e=>{if(/\\"/.test(args.expression))return evaluateJsonata(args.expression.replace(/\\"/g,'"'),data,{setParam},15_000);throw e;});
 const {rows,truncated}=resultRows(result,DATASET_LIMITS.rows);
 if(!rows.length)throw Error('The expression returned no rows. Inputs: '+described.join('; '));
 const summary=await saveDataset(scope,{title:args.title||'Query result',source:'query_data over '+aliases.map(a=>a+'='+inputs[a]).join(', ')+': '+args.expression.slice(0,600),rows});
 return truncated?{...summary,note:'Only the first '+DATASET_LIMITS.rows+' rows were kept.'}:summary;
}
export async function describeData(args:{datasetId:string;rows:string;columns:string},scope:string){
 const d=await loadDataset(scope,args.datasetId);
 const cols=list(args.columns||'');const unknown=cols.filter(c=>!d.columns.includes(c));if(unknown.length)throw Error('Unknown column(s): '+unknown.join(', ')+'. Columns: '+d.columns.join(', '));
 const columns=cols.length?cols:d.columns;
 const range=rowRange(args.rows||'',d.rows.length,200);
 const picked=d.rows.slice(range.start,range.end).map(r=>cols.length?Object.fromEntries(cols.map(c=>[c,r[c]])):r);
 const rows=fitRows(picked,60_000);
 const {preview:_preview,...summary}=summarize(d);
 return {...summary,createdAt:d.createdAt,stats:columnStats(d.rows,columns.slice(0,60)),
  ...(range.end>range.start?{rows:rows,rowsShown:range.start+1+'-'+(range.start+rows.length)}:{preview:d.rows.slice(0,5)}),
  ...(range.note||rows.length<picked.length?{note:range.note||'Rows were cut at 60,000 characters; ask for a smaller range or fewer columns.'}:{})};
}
export async function saveData(args:{datasetId:string;name:string;columns:string;rename:string},scope:string,ctx:AgentContext){
 const target=ctx.pageId||ctx.plannedPageId;if(!target)throw Error('Open a page first.');
 const name=String(args.name||'').trim();
 if(!/^[^/\\]{1,120}\.(csv|json)$/i.test(name))throw Error('name must end in .csv or .json, e.g. "countries.csv".');
 const d=await loadDataset(scope,args.datasetId);
 const {columns,rows}=pickColumns(d.rows,d.columns,list(args.columns||''),parseObject(args.rename||'','rename'));
 const content=/\.json$/i.test(name)?JSON.stringify(rows):toCsv(rows,columns);
 if(content.length>2*1024*1024)throw Error('The file would be '+(content.length/1048576).toFixed(1)+' MB; Page files hold up to 2 MB. Keep fewer columns (columns) or rows (query_data).');
 const {storePageTextFile}=await import('@/app/context-files/store');
 const stored=await storePageTextFile(target,ctx.userId,name,content,ctx.language||'en','',ctx.pageId?undefined:ctx.pendingFiles);
 return {name:stored.name,url:stored.url,fileId:stored.fileId,rows:rows.length,columns,source:d.source};
}
