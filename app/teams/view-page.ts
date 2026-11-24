import {chromiumPath} from '@/app/workflows/render';
import {siteUrl} from '@/app/site';
// The reviewer reads a page as a reader does: the real site in headless Chromium, desktop and phone, full screenshots
// (sent to the reviewer as images) plus what the browser measured — script errors, text wider than the screen.
export type PageView={path:string;status:number;title:string;text:string;textChars:number;tableRows:number;charts:string[];shots:{viewport:string;errors:string[];overflow:boolean;height:number;image:string}[]};
const VIEWPORTS=[{label:'desktop 1280px',width:1280,height:900,mobile:false},{label:'phone 390px',width:390,height:844,mobile:true}];
export async function viewPage(path:string,signal?:AbortSignal,textFrom=0):Promise<PageView>{
 const p=String(path||'').trim();if(!/^\/[\w\-./?=&%]*$/.test(p)||p.startsWith('//'))throw Error('Give a site path such as /geography/countries.');
 const executablePath=chromiumPath();if(!executablePath)throw Error('The browser is not available on this server; use preview_page.');
 const base=process.env.TEAM_PREVIEW_ORIGIN||siteUrl()||'http://127.0.0.1:'+(process.env.PORT||'3000');
 const {chromium}=await import('playwright-core');
 // Only our own pages are opened here, so the sandbox flag is safe; the service runs with NoNewPrivileges, where
 // Chromium's setuid sandbox cannot start.
 const browser=await chromium.launch({executablePath,headless:true,args:['--disable-dev-shm-usage','--no-first-run','--disable-gpu','--no-sandbox']});
 const out:PageView={path:p,status:0,title:'',text:'',textChars:0,tableRows:0,charts:[],shots:[]};
 try{
  for(const v of VIEWPORTS){
   signal?.throwIfAborted();
   // Rebuilt from the database for this request (x-rankwiki-fresh), so the reviewer sees the team's latest work.
   const context=await browser.newContext({viewport:{width:v.width,height:v.height},isMobile:v.mobile,hasTouch:v.mobile,deviceScaleFactor:1,
    extraHTTPHeaders:process.env.TEAM_ADMIN_TOKEN?{'x-rankwiki-fresh':process.env.TEAM_ADMIN_TOKEN}:{}});
   const page=await context.newPage(),errors:string[]=[];
   page.on('pageerror',(e:Error)=>errors.push('Uncaught: '+e.message.slice(0,300)));
   page.on('console',(m:{type():string;text():string})=>{if(m.type()==='error'&&!/favicon|Failed to load resource/i.test(m.text()))errors.push(m.text().slice(0,300));});
   const r=await page.goto(base+p,{waitUntil:'networkidle',timeout:45_000}).catch(()=>null);
   if(!out.status)out.status=r?.status()??0;
   await page.waitForTimeout(1200);
   const m=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>window.innerWidth+2,height:document.documentElement.scrollHeight,title:document.title}));
   if(!out.title)out.title=m.title;
   // Once (desktop): everything a reader can read, including table rows on later pages (hidden but in the page), and
   // each chart's own words (axis ticks, legend, labels).
   if(!v.mobile){
    const t=await page.evaluate(()=>{
     const rows=[...document.querySelectorAll('table tbody tr')].map(tr=>(tr as HTMLElement).innerText||tr.textContent||'').map(x=>x.replace(/\s+/g,' ').trim()).filter(Boolean);
     const charts=[...document.querySelectorAll('svg')].map(svg=>[...svg.querySelectorAll('text')].map(x=>(x.textContent||'').trim()).filter(Boolean).slice(0,60).join(' | ')).filter(x=>x.length>3).slice(0,12);
     return {text:(document.querySelector('main')||document.body).innerText,rows,charts};
    });
    const all=t.text+(t.rows.length?'\n\nALL TABLE ROWS ('+t.rows.length+'):\n'+t.rows.join('\n'):'');
    out.textChars=all.length;out.text=all.slice(textFrom,textFrom+24000);out.tableRows=t.rows.length;out.charts=t.charts;
   }
   const image=(await page.screenshot({type:'jpeg',quality:62,clip:{x:0,y:0,width:v.width,height:Math.min(m.height,v.mobile?3600:2600)}})).toString('base64');
   out.shots.push({viewport:v.label,errors,overflow:m.overflow,height:m.height,image});
   await context.close();
  }
 }finally{await browser.close().catch(()=>{});}
 return out;
}
