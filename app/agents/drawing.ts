import {aiKey} from '@/db/store';
import {runProgram} from '@/app/sandboxes/service';
import {sandboxContextFiles} from '@/app/context-files/server';
import {storePageFile,storePageTextFile} from '@/app/context-files/store';
import type {AgentContext} from '@/app/components-registry/registry';
import {renderChartSvg} from './svg-chart';
const setting=(name:string)=>process.env[name]||'';
const imageName=(name:string,extension:string)=>(name.replace(/\.[a-z0-9]+$/i,'')||'figure')+'.'+extension;
const decode=(base64:string)=>Uint8Array.from(atob(base64.replace(/^data:[^,]+,/,'').replace(/\s+/g,'')),c=>c.charCodeAt(0));

// Text-to-image generation with the configured OpenAI image model; the result becomes a page file.
export async function generateImage(pageId:string,ctx:AgentContext,args:{prompt:string;name:string;size?:string;quality?:string},signal?:AbortSignal){
 const key=aiKey();if(!key)throw Error('Image generation is not configured.');
 const size=['1024x1024','1536x1024','1024x1536'].includes(args.size||'')?args.size:'1536x1024',quality=['low','medium','high'].includes(args.quality||'')?args.quality:'medium';
 const response=await fetch('https://api.openai.com/v1/images/generations',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({model:setting('OPENAI_IMAGE_MODEL')||'gpt-image-1',prompt:args.prompt.slice(0,30000),size,quality,n:1}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(240000)]):AbortSignal.timeout(240000)});
 const data=await response.json().catch(()=>({})) as {data?:{b64_json?:string}[];error?:{message?:string}};
 if(!response.ok||!data.data?.[0]?.b64_json)throw Error('Image generation failed: '+(data.error?.message||('HTTP '+response.status)));
 // Generated PNGs are several MB; a high-quality JPEG keeps pages fast.
 let bytes=decode(data.data[0].b64_json),extension='png';
 try{const sharp=(await import('sharp')).default;bytes=new Uint8Array(await sharp(bytes).jpeg({quality:86,mozjpeg:true}).toBuffer());extension='jpg';}catch{}
 const stored=await storePageFile(pageId,ctx.userId,imageName(args.name,extension),bytes,ctx.language||'en','',ctx.pageId?undefined:ctx.pendingFiles);
 return {...stored,note:'Generated image. Say in the caption that it is an AI-generated illustration, not a photograph or measured data.'};
}

// Runs plotting code in the sandbox with the page's files mounted under /workspace/context,
// and stores the returned PNG or SVG as a page file.
export async function renderPlot(pageId:string,ctx:AgentContext,args:{code:string;inputJson?:string;name:string;language?:string}){
 const {uploads,metadata}=ctx.pageId?await sandboxContextFiles(pageId,ctx.userId):{uploads:[],metadata:[]};
 const input=args.inputJson?JSON.parse(args.inputJson):{};
 const run=await runProgram({kind:'sandbox-program',language:args.language==='javascript'?'javascript':'python',code:args.code},input,{userId:ctx.userId,agent:ctx.agent},uploads) as {ok:boolean;stdout:string;stderr:string;result:unknown};
 const result=run.result as {png_base64?:string;svg?:string}|null;
 if(!run.ok||!result||(!result.png_base64&&!result.svg))return {rendered:false,stderr:run.stderr.slice(-4000),stdout:run.stdout.slice(-2000),mountedFiles:metadata,hint:'main(input) must return {"png_base64": "..."} or {"svg": "<svg ...>"}; keep the result under 120 KB (dpi<=100, or save as SVG).'};
 const stored=result.svg?await storePageTextFile(pageId,ctx.userId,imageName(args.name,'svg'),result.svg,ctx.language||'en','',ctx.pageId?undefined:ctx.pendingFiles):await storePageFile(pageId,ctx.userId,imageName(args.name,'png'),decode(result.png_base64!),ctx.language||'en','',ctx.pageId?undefined:ctx.pendingFiles);
 return {rendered:true,...stored};
}

// Draws a chart from supplied data on the server and stores it as an SVG page file.
export async function plotChart(pageId:string,ctx:AgentContext,args:{specJson:string;name:string}){
 const svg=renderChartSvg(JSON.parse(args.specJson));
 return await storePageTextFile(pageId,ctx.userId,imageName(args.name,'svg'),svg,ctx.language||'en','',ctx.pageId?undefined:ctx.pendingFiles);
}
