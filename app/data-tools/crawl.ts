import {saveDataset} from './datasets';
import {renderIfShell,hostNeedsRender} from './page-load';
import {fetchText,publicUrl} from './net';
import {extractTables,htmlTitle,type ExtractedTable} from './html';
import {detectChallenge} from './parse';
import {parseRobots,crawlAllowed,robotsMode,sameSite,linkMatcher,type RobotsRules} from './robots';
import {archivedCopy,archiveMark} from './archive-fallback';
import {pageLinks} from '@/app/url-content/browse';
import {sourceText} from '@/app/url-content/fetch';
// crawl_pages: a polite breadth-first crawl over one site's links that match a pattern.
export type CrawlArgs={startUrl:string;linkPattern:string;maxPages:number;render:boolean;extract:'tables'|'text'};
const BUDGET_MS=240_000,MIN_GAP_MS=1000,MAX_ARCHIVE=15;
const robotsCache=new Map<string,{at:number;rules:RobotsRules|null}>();
async function robotsFor(origin:string,signal:AbortSignal):Promise<RobotsRules|null>{
 const hit=robotsCache.get(origin);if(hit&&Date.now()-hit.at<3600_000)return hit.rules;
 let rules:RobotsRules|null=null;
 try{const r=await fetchText(origin+'/robots.txt',signal,{accept:'text/plain',anyType:true,maxBytes:512*1024});rules=/html/.test(r.type)?null:parseRobots(r.text);}catch{rules=null;}
 robotsCache.set(origin,{at:Date.now(),rules});return rules;
}
const lastHit=new Map<string,number>();
async function politeWait(host:string,gap:number,signal:AbortSignal){
 const wait=(lastHit.get(host)||0)+gap-Date.now();
 if(wait>0)await new Promise<void>((resolve,reject)=>{const t=setTimeout(resolve,wait);signal.addEventListener('abort',()=>{clearTimeout(t);reject(signal.reason);},{once:true});});
 lastHit.set(host,Date.now());
}
export async function crawlPages(args:CrawlArgs,scope:string,signal:AbortSignal){
 const start=publicUrl(args.startUrl),matches=linkMatcher(args.linkPattern||''),max=Math.min(50,Math.max(1,Math.floor(args.maxPages||10)));
 const mode=robotsMode(process.env.CRAWL_ROBOTS);
 const queue:string[]=[start.href],seen=new Set([start.href]),began=Date.now();let archived=0;
 const pages:Record<string,unknown>[]=[],skipped:{url:string;reason:string}[]=[];
 const tablesBySignature=new Map<string,{headers:string[];rows:Record<string,unknown>[];pages:string[];caption:string}>();
 let stop='no more matching links';
 while(queue.length){
  if(pages.length>=max){stop='maxPages ('+max+') reached; '+queue.length+' matching links not visited';break;}
  if(Date.now()-began>BUDGET_MS){stop='time budget ('+BUDGET_MS/1000+' s) used; '+queue.length+' matching links not visited';break;}
  signal.throwIfAborted();
  const url=queue.shift()!,u=new URL(url);
  const rules=mode==='respect'?await robotsFor(u.origin,signal):null;
  if(!crawlAllowed(rules,u.pathname+u.search,mode)){skipped.push({url,reason:'disallowed by robots.txt'});continue;}
  await politeWait(u.host,Math.max(MIN_GAP_MS,Math.min(10,rules?.crawlDelay||0)*1000),signal);
  let html='',finalUrl=url,title='',text='',blocked:string|null=null;
  try{
   if(args.render||hostNeedsRender(url)){const {renderPage}=await import('./browser');const r=await renderPage(url,{captureJson:false},signal);if(r.blocked)blocked=r.blocked;else{html=r.html;finalUrl=r.url;title=r.title;text=r.text;}}
   else{const r=await fetchText(url,signal,{accept:'text/html,application/xhtml+xml'});if(!/html/.test(r.type)){skipped.push({url,reason:'not an HTML page ('+r.type+')'});continue;}html=r.text;finalUrl=r.url;title=htmlTitle(html);text=sourceText(mainHtml(html));
    blocked=detectChallenge({text,title,url:finalUrl,html})?.reason||null;
    if(blocked){const {noteFetch}=await import('@/app/sources/health');noteFetch(finalUrl,'denied',{error:blocked,reclassify:true});}
    // Built by JavaScript: rendered in the headless browser without being asked (and the rest of the site with it).
    else{const v=await renderIfShell(finalUrl,html,signal);if(v){if(v.challenge)blocked=v.challenge;else{html=v.html;finalUrl=v.url;title=v.title||title;text=v.text;}}}}
  }catch(e){const m=(e as Error).message;if(signal.aborted||!/could not be fetched/.test(m)){skipped.push({url,reason:m.slice(0,160)});continue;}blocked=m;}
  // Blocked live (login, CAPTCHA, challenge, HTTP error): read the latest Wayback capture instead.
  let mark:ReturnType<typeof archiveMark>|null=null;
  if(blocked){
   const copy=archived<MAX_ARCHIVE?await archivedCopy(url,signal):null;
   if(!copy){skipped.push({url,reason:blocked.split('.')[0]+(archived>=MAX_ARCHIVE?' (archive fallback limit reached)':'; no Wayback capture')});continue;}
   archived++;mark=archiveMark(copy);html=copy.html;finalUrl=copy.original;title=htmlTitle(html);text=sourceText(mainHtml(html));
  }
  const cite=mark?mark.snapshotUrl:finalUrl;
  const tables=extractTables(html,{baseUrl:finalUrl}).filter(t=>t.rows.length>0);
  for(const t of tables)collect(t,cite);
  pages.push({...(args.extract==='text'?{url:finalUrl,title,text:text.slice(0,1500),tables:tables.length}:{url:finalUrl,title,tables:tables.map(t=>({index:t.index,rows:t.rows.length,headers:t.headers.slice(0,12)}))}),...mark?{...mark,liveBlocked:blocked!.split('.')[0]}:{}});
  for(const link of pageLinks(html,finalUrl)){
   const l=new URL(link.url);
   if(seen.has(l.href)||!/^https?:$/.test(l.protocol)||!sameSite(l.hostname,start.hostname)||!matches(l.href))continue;
   seen.add(l.href);queue.push(l.href);
  }
 }
 // Tables with the same headers across pages are concatenated with a _page column.
 const datasets:unknown[]=[];
 for(const g of [...tablesBySignature.values()].sort((a,b)=>b.pages.length-a.pages.length||b.rows.length-a.rows.length).slice(0,15)){
  const s=await saveDataset(scope,{title:(g.caption||'Crawled table')+' ('+g.pages.length+' page'+(g.pages.length>1?'s':'')+')',source:start.href+' crawl: '+g.pages.slice(0,5).join(' ')+(g.pages.length>5?' …':''),rows:g.rows});
  datasets.push({datasetId:s.datasetId,pages:g.pages.length,rowCount:s.rowCount,headers:g.headers.slice(0,20),preview:s.preview.slice(0,2)});
 }
 return {startUrl:start.href,visited:pages.length,robots:mode,archivedPages:archived,stop,pages,skipped:skipped.slice(0,30),datasets,
  note:'Same-site links matching the pattern were followed breadth-first, at least 1 s apart, '+(mode==='respect'?'obeying robots.txt (pages it disallows are listed in skipped)':'with robots.txt not consulted (CRAWL_ROBOTS=ignore)')+'. Pages that answered with a login wall, CAPTCHA, interactive challenge or HTTP error were read from their latest Wayback Machine capture when one exists (fromArchive, snapshotUrl, archivedAt: cite the snapshot with its date; their tables\' _page is the snapshot URL). Tables with identical headers on several pages were concatenated into one dataset with a _page column.'};
 function collect(t:ExtractedTable,page:string){
  const sig=t.headers.join('\u0001');let g=tablesBySignature.get(sig);
  if(!g){g={headers:[...t.headers,'_page'],rows:[],pages:[],caption:t.caption};tablesBySignature.set(sig,g);}
  if(!g.pages.includes(page))g.pages.push(page);
  for(const r of t.rows)if(g.rows.length<100_000)g.rows.push({...r,_page:page});
 }
}
// The main content when the page marks it (<main>, <article>, Wikipedia's content div), else the whole page.
function mainHtml(html:string){
 for(const [open,close] of [['<main','</main>'],['id="mw-content-text"','<div class="printfooter'],['<article','</article>']] as const){
  const a=html.indexOf(open);if(a<0)continue;const b=html.lastIndexOf(close);if(b>a)return html.slice(html.lastIndexOf('<',a),b);
 }
 return html;
}
