import {sourceText} from '@/app/url-content/fetch';
// Pages whose content is built by JavaScript come back from a plain request as an empty shell (an app root, a
// "enable JavaScript" notice, scripts and little text). The data tools then render them in the headless browser on
// their own, without the agent having to know or ask (render=true stays available), and remember the host for a day
// so the next pages of the same site are rendered straight away.
const SHELL_ROOT=/<(div|main|body)[^>]+id=["'](root|app|__next|__nuxt|___gatsby|svelte|main-app)["'][^>]*>\s*(<!--[^>]*-->\s*)*<\/(div|main|body)>/i;
const NOSCRIPT=/<noscript[^>]*>[\s\S]{0,400}?(enable|requires?|turn on|need)[\s\S]{0,40}?javascript/i;
export function jsShell(html:string):boolean{
 if(!html)return false;
 const text=sourceText(html).replace(/\s+/g,' ').trim().length;
 const scripts=(html.match(/<script\b/gi)||[]).length;
 if(text>=2500)return false;
 return SHELL_ROOT.test(html)||NOSCRIPT.test(html)&&text<1500||text<400&&scripts>=3;
}
const renderHosts=new Map<string,number>();
const DAY=24*3600_000;
const host=(url:string)=>{try{return new URL(url).hostname.toLowerCase();}catch{return '';}};
export function hostNeedsRender(url:string){const h=host(url),t=renderHosts.get(h);if(t&&Date.now()-t<DAY)return true;if(t)renderHosts.delete(h);return false;}
export function rememberRender(url:string){const h=host(url);if(h){renderHosts.set(h,Date.now());if(renderHosts.size>500)renderHosts.delete(renderHosts.keys().next().value!);}}
// The page as the browser shows it when the plain response was a shell (or the host is known to need it).
export async function renderIfShell(url:string,html:string,signal:AbortSignal):Promise<{url:string;html:string;title:string;text:string;challenge:string|null}|null>{
 if(!jsShell(html))return null;
 const {browserAvailable,renderPage}=await import('./browser');
 if(!browserAvailable())return null;
 try{const r=await renderPage(url,{captureJson:false},signal);rememberRender(url);return {url:r.url,html:r.html,title:r.title,text:r.text,challenge:r.blocked};}
 catch{signal.throwIfAborted();return null;}
}
