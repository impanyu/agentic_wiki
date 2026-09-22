import {z} from 'zod';
export const sandboxSchema=z.object({kind:z.literal('sandbox-app'),html:z.string().min(1).max(30000),css:z.string().max(16000),javascript:z.string().max(30000),height:z.number().int().min(300).max(1200)}).strict();
export type SandboxDefinition=z.infer<typeof sandboxSchema>;
// Opaque-origin frame: generated code has no cookies, parent DOM, credentials or network.
export function sandboxDocument(app:SandboxDefinition){
 const nonce=crypto.randomUUID().replaceAll('-','');
 const escapeScript=(s:string)=>s.replace(/<\/script/gi,'<\\/script');
 const bootstrap=`
window.pageTools={call:(name,args={})=>new Promise((resolve,reject)=>{const id=crypto.randomUUID();const listener=e=>{if(e.source!==parent||e.data?.type!=='page-tool-result'||e.data.id!==id)return;clearTimeout(timer);window.removeEventListener('message',listener);e.data.error?reject(Error(e.data.error)):resolve(e.data.result);};const timer=setTimeout(()=>{window.removeEventListener('message',listener);reject(Error('Tool call timed out. Inspect its result before retrying a write.'));},120000);window.addEventListener('message',listener);parent.postMessage({type:'page-tool-call',id,name,args},'*');})};
window.addEventListener('error',()=>{const p=document.createElement('p');p.textContent='This app encountered an error. Please try the question again.';p.setAttribute('role','alert');document.body.appendChild(p);});`;
 return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'"><style>body{font:16px system-ui;color:#172234;margin:16px}button,input,select,textarea{font:inherit}*{box-sizing:border-box}${app.css.replace(/<\/style/gi,'')}</style></head><body>${app.html}<script nonce="${nonce}">${bootstrap}\n${escapeScript(app.javascript)}</script></body></html>`;
}
