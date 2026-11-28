import {chromiumPath} from '@/app/workflows/render';
import {allowedRequestUrl,publicUrl} from './net';
import {guardProxy} from './proxy';
import {describeShape,jsonRows,detectChallenge,type Challenge} from './parse';
// Headless Chromium for JavaScript-built public pages. One browser per process, a few pages at a
// time (BROWSER_PAGES), a fresh context per call (no cookies or storage kept), downloads, service
// workers and permission prompts refused. Every request goes through a pinned-address proxy
// (proxy.ts) and route interception, so only public hosts are reached — redirects, subresources
// and WebSockets included.
export type CapturedJson={url:string;status:number;bytes:number;shape:string;rowCount:number;value:unknown};
export type Rendered={url:string;title:string;html:string;text:string;json:CapturedJson[];blocked:string|null;challenge:Challenge|null;blockedRequests:number};
// Analytics, telemetry, consent and bot-detection endpoints are not page data. Pages that load
// such scripts are read normally; only a real challenge or login wall counts as blocked (parse.ts).
const NOISE=/telemetry|analytics|collect\b|beacon|sentry|awswaf|captcha|recaptcha|hcaptcha|stripe\.com|doubleclick|google-analytics|googletagmanager|segment\.io|mixpanel|amplitude|hotjar|clarity\.ms|consent|onetrust|cookielaw|datadome|perimeterx|newrelic|nr-data/i;
const HARD_TIMEOUT=45_000,JSON_MAX=5*1024*1024,JSON_KEEP=40;
const UA={desktop:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',mobile:'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'};
let browserPromise:Promise<any>|null=null,idle:ReturnType<typeof setTimeout>|null=null;
export const browserAvailable=()=>!!chromiumPath();
async function browser(){
 const executablePath=chromiumPath();
 if(!executablePath)throw Error('Rendering pages in a browser is unavailable on this server (no Chromium). Use fetch_data or extract_tables with render=false, or the site\'s public API.');
 if(!browserPromise)browserPromise=(async()=>{const {chromium}=await import('playwright-core');const server=await guardProxy();const b=await chromium.launch({executablePath,headless:true,proxy:{server,bypass:''},args:['--proxy-bypass-list=<-loopback>','--disable-dev-shm-usage','--no-first-run','--disable-gpu','--disable-features=Translate,MediaRouter','--disable-background-networking','--deny-permission-prompts']});b.on('disconnected',()=>{browserPromise=null;});return b;})().catch(e=>{browserPromise=null;throw e;});
 return browserPromise;
}
function scheduleClose(){if(idle)clearTimeout(idle);idle=setTimeout(()=>{const p=browserPromise;browserPromise=null;p?.then(b=>b.close()).catch(()=>{});},90_000);idle.unref?.();}
// Runs one rendering job at a time.
// A few pages at once (BROWSER_PAGES, default 2) in one shared browser: several teams browse at the same time
// without each launching its own Chromium (the VM has 4 cores and is shared with the site).
const SLOTS=Math.max(1,Math.min(6,Number(process.env.BROWSER_PAGES)||2));let active=0;const waiting:(()=>void)[]=[];
async function exclusive<T>(job:()=>Promise<T>):Promise<T>{
 if(active>=SLOTS)await new Promise<void>(r=>waiting.push(r));
 active++;
 try{return await job();}finally{active--;waiting.shift()?.();}
}
export async function renderPage(address:string,options:{waitFor?:string;scrolls?:number;device?:'desktop'|'mobile';captureJson?:boolean},signal?:AbortSignal):Promise<Rendered>{
 const start=publicUrl(address);
 return exclusive(async()=>{
  signal?.throwIfAborted();
  const b=await browser();if(idle)clearTimeout(idle);
  const mobile=options.device==='mobile';
  const context=await b.newContext({userAgent:mobile?UA.mobile:UA.desktop,viewport:mobile?{width:390,height:844}:{width:1366,height:900},isMobile:mobile,hasTouch:mobile,acceptDownloads:false,serviceWorkers:'block',permissions:[],javaScriptEnabled:true,bypassCSP:false,locale:'en-US',extraHTTPHeaders:{'Accept-Language':'en-US,en;q=0.9'}});
  const json:CapturedJson[]=[];let blockedRequests=0;const pending:Promise<void>[]=[];
  const deadline=Date.now()+HARD_TIMEOUT;
  const timer=setTimeout(()=>{context.close().catch(()=>{});},HARD_TIMEOUT+5000);
  const onAbort=()=>{context.close().catch(()=>{});};signal?.addEventListener('abort',onAbort,{once:true});
  try{
   await context.route('**/*',async(route:any)=>{
    const req=route.request(),type=req.resourceType();
    if(type==='image'||type==='media'||type==='font')return route.abort('blockedbyclient');
    if(!(await allowedRequestUrl(req.url()))){blockedRequests++;return route.abort('blockedbyclient');}
    return route.continue();
   });
   if(typeof context.routeWebSocket==='function')await context.routeWebSocket(/.*/,async(ws:any)=>{if(await allowedRequestUrl(ws.url()))ws.connectToServer();else{blockedRequests++;ws.close();}});
   const page=await context.newPage();
   page.on('dialog',(d:any)=>d.dismiss().catch(()=>{}));
   page.on('download',(d:any)=>d.cancel().catch(()=>{}));
   if(options.captureJson!==false)page.on('response',(res:any)=>{pending.push((async()=>{
    try{
     const ct=String(res.headers()['content-type']||'').toLowerCase(),req=res.request(),type=req.resourceType();
     if(!/json/.test(ct)||!(type==='xhr'||type==='fetch'||type==='other'))return;
     if(json.length>=JSON_KEEP||NOISE.test(res.url()))return;
     const len=Number(res.headers()['content-length']||0);if(len>JSON_MAX)return;
     const body=await res.body();if(body.length>JSON_MAX||body.length<2)return;
     const value=JSON.parse(body.toString('utf8'));
     json.push({url:res.url(),status:res.status(),bytes:body.length,shape:describeShape(value),rowCount:jsonRows(value).rows.length,value});
    }catch{}
   })());});
   await page.goto(start.href,{waitUntil:'domcontentloaded',timeout:Math.max(5000,deadline-Date.now()-8000)});
   await page.waitForLoadState('networkidle',{timeout:Math.min(8000,Math.max(1000,deadline-Date.now()-6000))}).catch(()=>{});
   if(options.waitFor)await page.waitForSelector(options.waitFor,{timeout:Math.min(10_000,Math.max(1000,deadline-Date.now()-5000))}).catch(()=>{});
   for(let i=0;i<Math.min(20,Math.max(0,options.scrolls||0))&&Date.now()<deadline-6000;i++){
    await page.evaluate(()=>window.scrollBy(0,Math.max(window.innerHeight*2,1200)));
    await page.waitForLoadState('networkidle',{timeout:2500}).catch(()=>{});await page.waitForTimeout(400);
   }
   await Promise.race([Promise.allSettled(pending),new Promise(r=>setTimeout(r,2000))]);
   const url=page.url(),title=await page.title().catch(()=>''),html=await page.content();
   const text=await page.evaluate(()=>(document.body?.innerText||'').replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim()).catch(()=>'');
   const challenge=detectChallenge({text,title,url,html});
   {const {noteFetch}=await import('@/app/sources/health');noteFetch(start,challenge?'denied':'ok',{error:challenge?.reason||''});}
   return {url,title,html,text,json,blocked:challenge?.reason||null,challenge,blockedRequests};
  }catch(e){
   const m=(e as Error).message||'';
   if(!signal?.aborted&&!/ERR_BLOCKED_BY_CLIENT/.test(m)){const {noteFetch}=await import('@/app/sources/health');noteFetch(start,'failed',{error:m.split('\n')[0]});}
   if(/Timeout|closed|Target page/i.test(m))throw Error('The page did not finish loading within '+HARD_TIMEOUT/1000+' s: '+start.href);
   if(/ERR_BLOCKED_BY_CLIENT/.test(m))throw Error('Only public internet addresses can be opened.');
   if(/ERR_NAME_NOT_RESOLVED/.test(m))throw Error('The host does not exist: '+start.hostname);
   throw Error('The page could not be opened: '+m.split('\n')[0].slice(0,200));
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',onAbort);await context.close().catch(()=>{});scheduleClose();}
 });
}
