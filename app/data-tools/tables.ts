import {saveDataset} from './datasets';
import {fetchText} from './net';
import {extractTables,htmlTitle,type ExtractedTable} from './html';
import {blockedReason} from './parse';
// extract_tables: every data table on a page saved as its own dataset, listed compactly.
const MAX_SAVED=40;
export async function tablesFromHtml(html:string,url:string,scope:string,pageTitle:string){
 const tables=extractTables(html,{baseUrl:url}).filter(t=>t.rows.length>0);
 const out:unknown[]=[];
 for(const t of tables.slice(0,MAX_SAVED)){
  const s=await saveDataset(scope,{title:(pageTitle||new URL(url).hostname)+' — table '+t.index+(t.caption?': '+t.caption:t.section?' ('+t.section+')':''),source:url+'#table-'+t.index,rows:t.rows});
  out.push(listing(t,s.datasetId));
 }
 return {tables:out,skipped:Math.max(0,tables.length-MAX_SAVED)};
}
const listing=(t:ExtractedTable,datasetId:string)=>({index:t.index,datasetId,caption:t.caption||undefined,section:t.section||undefined,rowCount:t.rows.length,headers:t.headers.slice(0,30),preview:t.rows.slice(0,2)});
export async function extractTablesTool(args:{url:string;render:boolean},scope:string,signal:AbortSignal){
 let html:string,url:string,title:string;
 if(args.render){
  const {renderPage}=await import('./browser');const r=await renderPage(args.url,{captureJson:false},signal);
  if(r.blocked)throw Error(r.blocked);html=r.html;url=r.url;title=r.title;
 }else{
  const r=await fetchText(args.url,signal,{accept:'text/html,application/xhtml+xml'});
  if(!/html|xml/.test(r.type))throw Error('This address is not an HTML page ('+r.type+'); use fetch_data for data files and APIs.');
  html=r.text;url=r.url;title=htmlTitle(html);
  const blocked=blockedReason(html.replace(/<[^>]+>/g,' '),title,url);if(blocked)throw Error(blocked);
 }
 const {tables,skipped}=await tablesFromHtml(html,url,scope,title);
 return {url,title,tableCount:tables.length,tables,
  note:tables.length?'Each table is saved as a dataset: inspect with describe_data, combine or clean with query_data, then save_data. Cells that are clearly numbers are numbers; columns of numbers with units keep the text and gain a "<column> (number)" column; the first column of entity links gains "<column> (url)"; footnote markers are removed.'+(skipped?' '+skipped+' more tables were not saved.':''):'No data tables were found'+(args.render?'.':'; if the page builds its tables with JavaScript, call again with render=true.')};
}
