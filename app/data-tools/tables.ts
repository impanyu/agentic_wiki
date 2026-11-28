import {saveDataset} from './datasets';
import {fetchText} from './net';
import {extractTables,htmlTitle,type ExtractedTable} from './html';
import {detectChallenge,blockedHint,type Challenge} from './parse';
import {archivedCopy,archiveMark} from './archive-fallback';
import {sourceText} from '@/app/url-content/fetch';
import {renderIfShell,hostNeedsRender} from './page-load';
import {noteFetch} from '@/app/sources/health';
// extract_tables: every data table on a page saved as its own dataset, listed compactly.
const MAX_SAVED=40;
export async function tablesFromHtml(html:string,url:string,scope:string,pageTitle:string,source=url){
 const tables=extractTables(html,{baseUrl:url}).filter(t=>t.rows.length>0);
 const out:unknown[]=[];
 for(const t of tables.slice(0,MAX_SAVED)){
  const s=await saveDataset(scope,{title:(pageTitle||new URL(url).hostname)+' — table '+t.index+(t.caption?': '+t.caption:t.section?' ('+t.section+')':''),source:source+'#table-'+t.index,rows:t.rows});
  out.push(listing(t,s.datasetId));
 }
 return {tables:out,skipped:Math.max(0,tables.length-MAX_SAVED)};
}
const listing=(t:ExtractedTable,datasetId:string)=>({index:t.index,datasetId,caption:t.caption||undefined,section:t.section||undefined,rowCount:t.rows.length,headers:t.headers.slice(0,30),preview:t.rows.slice(0,2)});
export async function extractTablesTool(args:{url:string;render:boolean},scope:string,signal:AbortSignal){
 let html='',url=args.url,title='',challenge:Challenge|string|null=null,rendered=false;
 try{
  if(args.render||hostNeedsRender(args.url)){
   const {renderPage}=await import('./browser');const r=await renderPage(args.url,{captureJson:false},signal);
   html=r.html;url=r.url;title=r.title;challenge=r.challenge||r.blocked;rendered=true;
  }else{
   const r=await fetchText(args.url,signal,{accept:'text/html,application/xhtml+xml'});
   if(!/html|xml/.test(r.type))throw Error('This address is not an HTML page ('+r.type+'); use fetch_data for data files and APIs.');
   html=r.text;url=r.url;title=htmlTitle(html);
   challenge=detectChallenge({text:sourceText(html),title,url,html});
   if(challenge)noteFetch(url,'denied',{error:challenge.reason,reclassify:true});
   // Built by JavaScript: rendered in the headless browser without being asked.
   else{const v=await renderIfShell(url,html,signal);if(v){html=v.html;url=v.url;title=v.title||title;challenge=v.challenge;rendered=true;}}
  }
 }catch(e){if(signal.aborted||!/could not be fetched/.test((e as Error).message))throw e;challenge=(e as Error).message;}
 // Blocked live: the latest Wayback capture, marked as archived; else where to look instead.
 let mark:ReturnType<typeof archiveMark>|null=null;
 if(challenge){
  const copy=await archivedCopy(args.url,signal);
  if(!copy)return {url,title,...blockedHint(args.url,challenge)};
  mark=archiveMark(copy);html=copy.html;url=copy.original;title=htmlTitle(html);
 }
 const {tables,skipped}=await tablesFromHtml(html,url,scope,title,mark?.snapshotUrl);
 return {url,title,...mark||{},...(rendered&&!args.render?{renderedAutomatically:true}:{}),tableCount:tables.length,tables,
  note:(mark?'The live page was blocked; these tables come from its Wayback Machine capture of '+mark.archivedAt+' (cite '+mark.snapshotUrl+' with that date). ':'')+(tables.length?'Each table is saved as a dataset: inspect with describe_data, combine or clean with query_data, then save_data. Cells that are clearly numbers are numbers; columns of numbers with units keep the text and gain a "<column> (number)" column; the first column of entity links gains "<column> (url)"; footnote markers are removed.'+(skipped?' '+skipped+' more tables were not saved.':''):'No data tables were found'+(args.render||rendered?'.':'; if the page builds its tables with JavaScript, call again with render=true.'))};
}
