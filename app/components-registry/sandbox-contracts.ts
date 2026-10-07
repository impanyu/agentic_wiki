import {z} from 'zod';
// A generated app is HTML, CSS and JavaScript plus optional extra modules and
// npm libraries. Libraries are served by this site's own proxy, never fetched
// from a third party by the browser.
const packageName=/^(?:@[a-z0-9][a-z0-9._-]{0,60}\/)?[a-z0-9][a-z0-9._-]{0,80}$/;
const filePath=/^(?!.*\.\.)[A-Za-z0-9_-][A-Za-z0-9_./-]{0,120}\.(?:js|mjs|css|json|txt|svg|csv|md)$/;
export const sandboxFileSchema=z.object({path:z.string().regex(filePath,'File paths are relative, like lib/map.js or data/zones.json'),content:z.string().max(400000)}).strict();
export const sandboxShape=z.object({kind:z.literal('sandbox-app'),html:z.string().min(1).max(200000),css:z.string().max(200000),javascript:z.string().max(400000),files:z.array(sandboxFileSchema).max(40).optional(),libraries:z.record(z.string().regex(packageName),z.string().regex(/^\d{1,4}\.\d{1,4}\.\d{1,6}$/,'Pin an exact version such as 1.9.4')).optional(),height:z.number().int().min(300).max(2400)}).strict();
export const SANDBOX_TOTAL_LIMIT=1500000;
export function sandboxSize(app:{html:string;css:string;javascript:string;files?:{content:string}[]}){return app.html.length+app.css.length+app.javascript.length+(app.files||[]).reduce((n,f)=>n+f.content.length,0);}
export const sandboxSizeCheck=(app:{html:string;css:string;javascript:string;files?:{path:string;content:string}[];libraries?:Record<string,string>},ctx:z.RefinementCtx)=>{
 if(sandboxSize(app)>SANDBOX_TOTAL_LIMIT)ctx.addIssue({code:z.ZodIssueCode.custom,message:'The app is larger than 1.5 MB of source in total.'});
 const paths=(app.files||[]).map(f=>f.path);if(new Set(paths).size!==paths.length)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Each app file path must be unique.'});
 if(Object.keys(app.libraries||{}).length>30)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Use at most 30 libraries.'});
};
export const sandboxSchema=sandboxShape.superRefine(sandboxSizeCheck);
export type SandboxDefinition=z.infer<typeof sandboxShape>;
// Opaque-origin frame: generated code has no cookies, parent DOM or credentials,
// and the policy below lets it reach only this site's library, tile and image
// proxies. Everything else goes through window.pageTools.
const siteOrigin=(origin?:string)=>(origin||(typeof location!=='undefined'?location.origin:process.env.APP_URL)||'').replace(/\/$/,'').replace(/[^A-Za-z0-9:/.\-]/g,'');
export const LIBRARY_PATH='/api/app-libs/npm/',TILE_PATH='/api/app-tiles/';
const usesModules=(app:SandboxDefinition)=>!!(app.files?.length||Object.keys(app.libraries||{}).length)||/^\s*(?:import\s*[\w{*'"]|export\s)/m.test(app.javascript);
// Resolves ./ and ../ between the app's own files to their app/ specifiers.
export function resolveAppImports(code:string,from:string){
 const dir=from.includes('/')?from.slice(0,from.lastIndexOf('/')).split('/'):[];
 const resolve=(spec:string)=>{const parts=[...dir];for(const p of spec.split('/')){if(p==='.'||!p)continue;if(p==='..')parts.pop();else parts.push(p);}return 'app/'+parts.join('/');};
 return code.replace(/(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]+)\2/g,(_m,head,q,spec)=>head+q+resolve(spec)+q);
}
const base64=(text:string)=>typeof Buffer!=='undefined'?Buffer.from(text,'utf8').toString('base64'):btoa(String.fromCharCode(...new TextEncoder().encode(text)));
export function sandboxImportMap(app:SandboxDefinition,origin?:string){
 const site=siteOrigin(origin),imports:Record<string,string>={};
 for(const [name,version] of Object.entries(app.libraries||{})){imports[name]=site+LIBRARY_PATH+name+'@'+version+'/+esm';imports[name+'/']=site+LIBRARY_PATH+name+'@'+version+'/';}
 for(const f of app.files||[]){if(/\.m?js$/.test(f.path))imports['app/'+f.path]='data:text/javascript;base64,'+base64(resolveAppImports(f.content,f.path));else if(f.path.endsWith('.json'))imports['app/'+f.path]='data:application/json;base64,'+base64(f.content);}
 return {imports};
}
export function sandboxPolicy(origin?:string){
 const site=siteOrigin(origin),libs=site+LIBRARY_PATH,tiles=site+TILE_PATH,images=site+'/api/earth-engine/';
 return [`default-src 'none'`,`script-src 'nonce-NONCE' 'unsafe-eval' 'wasm-unsafe-eval' data: blob: ${libs}`,`style-src 'unsafe-inline' ${libs}`,`font-src data: ${libs}`,`img-src data: blob: ${libs} ${tiles} ${images}`,`media-src data: blob:`,`connect-src data: blob: ${libs} ${tiles}`,`worker-src blob: ${libs}`,`frame-src https://maps.google.com https://www.google.com`,`form-action 'none'`,`base-uri ${site}/`].join('; ');
}
export function sandboxDocument(app:SandboxDefinition,origin?:string){
 const nonce=crypto.randomUUID().replaceAll('-',''),site=siteOrigin(origin);
 const escapeScript=(s:string)=>s.replace(/<\/script/gi,'<\\/script');
 const escapeStyle=(s:string)=>s.replace(/<\/style/gi,'');
 const bootstrap=`
// Peer connections can reach any host regardless of the content policy.
for(const k of ['RTCPeerConnection','webkitRTCPeerConnection','RTCDataChannel','RTCIceCandidate','RTCSessionDescription']){try{Object.defineProperty(window,k,{value:undefined,writable:false,configurable:false});}catch{}}
const toolCallId=()=>typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2);
window.pageTools={call:(name,args={})=>new Promise((resolve,reject)=>{const id=toolCallId();const listener=e=>{if(e.source!==parent||e.data?.type!=='page-tool-result'||e.data.id!==id)return;clearTimeout(timer);window.removeEventListener('message',listener);e.data.error?reject(Error(e.data.error)):resolve(e.data.result);};const timer=setTimeout(()=>{window.removeEventListener('message',listener);reject(Error('Tool call timed out. Inspect its result before retrying a write.'));},120000);window.addEventListener('message',listener);parent.postMessage({type:'page-tool-call',id,name,args},'*');})};
window.pageTools.run=(values={},options={})=>window.pageTools.call('run_page',{values,...options});window.pageTools.mapUrl=(where,options={})=>{const p=new URLSearchParams({output:'embed'});if(where&&typeof where==='object'&&where.destination){p.set('saddr',String(where.origin||''));p.set('daddr',String(where.destination));}else{const q=where&&typeof where==='object'?(where.lat+','+where.lng):String(where||'');p.set('q',q);const z=Number(options.zoom??(where&&where.zoom));if(z>=1&&z<=21)p.set('z',String(Math.round(z)));}return 'https://maps.google.com/maps?'+p.toString();};
window.addEventListener('error',()=>{const p=document.createElement('p');p.textContent='This app encountered an error. Please try the question again.';p.setAttribute('role','alert');document.body.appendChild(p);});
window.pageTools.upload=(file,options={})=>window.pageTools.call('upload_page_file',{file,name:String(options.name||file?.name||'file'),folderPath:String(options.folderPath||'')});
window.appFiles=APPFILES;
// Links open in a new tab through the host (with the user's confirmation for other sites); the frame itself never navigates.
document.addEventListener('click',e=>{const a=e.target&&e.target.closest?e.target.closest('a[href]'):null;if(!a)return;const href=a.getAttribute('href')||'';if(!href||href.startsWith('#')||a.hasAttribute('download')||/^(blob|data):/i.test(href))return;e.preventDefault();if(/^https?:/i.test(a.href))parent.postMessage({type:'page-open-link',url:a.href},'*');},true);`.replace('APPFILES',JSON.stringify(Object.fromEntries((app.files||[]).filter(f=>!/\.m?js$/.test(f.path)).map(f=>[f.path,f.content]))).replace(/</g,'\\u003c'));
 const modules=usesModules(app),css=[app.css,...(app.files||[]).filter(f=>f.path.endsWith('.css')).map(f=>f.content)].join('\n');
 const importMap=modules?`<script type="importmap" nonce="${nonce}">${JSON.stringify(sandboxImportMap(app,origin)).replace(/</g,'\\u003c')}</script>`:'';
 const main=modules?`<script nonce="${nonce}">${bootstrap}</script><script type="module" nonce="${nonce}">${escapeScript(resolveAppImports(app.javascript,'main.js'))}</script>`:`<script nonce="${nonce}">${bootstrap}\n${escapeScript(app.javascript)}</script>`;
 return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${sandboxPolicy(origin).replace('NONCE',nonce)}"><meta http-equiv="x-dns-prefetch-control" content="off"><base href="${site}/">${importMap}<style>body{font:16px system-ui;color:#172234;margin:16px}button,input,select,textarea{font:inherit}*{box-sizing:border-box}${escapeStyle(css)}</style></head><body>${app.html}${main}</body></html>`;
}
