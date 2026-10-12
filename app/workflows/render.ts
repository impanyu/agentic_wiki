import {existsSync} from 'node:fs';
import {putPreview,dropPreview} from './preview-store';
import type {Workflow} from './schema';
// Renders a workflow with the site's real components in headless Chromium,
// through /workflow-preview, as the page owner would see it.
export type Shot={label:string;data:string;errors:string[];overflow:boolean;textChars:number};
const VIEWPORTS={desktop:{label:'desktop 1280px',width:1280,height:900},phone:{label:'phone 390px',width:390,height:844}};
export const chromiumPath=()=>[process.env.CHROMIUM_PATH,'/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome'].find(p=>p&&existsSync(p));
export async function renderScreens(workflow:Workflow,snapshot:{state:Record<string,unknown>;values:Record<string,unknown>;title:string;pageId:string;language?:string},viewports:('desktop'|'phone')[]=['desktop','phone'],signal?:AbortSignal):Promise<Shot[]>{
 const executablePath=chromiumPath();if(!executablePath)throw Error('Rendering is unavailable on this server.');
 const token=putPreview({workflow,...snapshot});let browser:any;const shots:Shot[]=[];
 try{
  const {chromium}=await import('playwright-core');browser=await chromium.launch({executablePath,headless:true,args:['--disable-dev-shm-usage','--no-first-run','--disable-gpu']});
  for(const key of viewports){
   if(signal?.aborted)break;
   const viewport=VIEWPORTS[key],page=await browser.newPage({viewport:{width:viewport.width,height:viewport.height}}),errors:string[]=[];
   page.on('pageerror',(e:Error)=>errors.push('Uncaught: '+e.message.slice(0,300)));page.on('console',(m:any)=>{if(m.type()==='error'&&!/favicon|arcgis|tile/i.test(m.text()))errors.push(m.text().slice(0,300));});
   await page.goto('http://127.0.0.1:'+(process.env.PORT||'3000')+'/workflow-preview?token='+token,{waitUntil:'networkidle',timeout:30000}).catch(()=>{});
   await page.waitForTimeout(1500);
   const m=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>window.innerWidth+2,text:document.body.innerText.length,height:document.documentElement.scrollHeight}));
   const data=(await page.screenshot({fullPage:true,type:'jpeg',quality:70,clip:{x:0,y:0,width:viewport.width,height:Math.min(m.height,viewport.width<500?3200:2400)}})).toString('base64');
   shots.push({label:viewport.label,data,errors,overflow:m.overflow,textChars:m.text});await page.close();
  }
 }finally{await browser?.close().catch(()=>{});dropPreview(token);}
 return shots;
}
