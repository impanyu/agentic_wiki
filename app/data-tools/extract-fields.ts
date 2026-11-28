import {looseJson} from './args';
import {load,type CheerioAPI} from 'cheerio';
import {fetchText,publicUrl} from './net';
import {saveDataset,loadDataset,type Row} from './datasets';
import {linkMatcher} from './robots';
// Field extraction from web pages by declarative rules — the way a collector turns a site's detail pages
// (a perfume, a product, a university) into rows without a model at run time. A rule says where a field is:
//   "css:h1"                      text of the first match ("css:a.brand@href" an attribute, "@html" inner HTML)
//   "jsonld:Product.offers.price"  schema.org JSON-LD: the object of that @type, then a path ("*" any element)
//   "microdata:ratingValue"       itemprop value (content/href/src attribute, else text)
//   "meta:og:title"               <meta property|name=…> content
//   "json:props.pageProps.item.price"  data embedded in the page (__NEXT_DATA__, application/json scripts,
//                                  window.__STATE__ = {…} assignments), as one object keyed by script id/name
// Object form adds options: {"css": "…", "attr": "href", "all": true, "join": "; ", "number": true,
// "regex": "([0-9.]+) ?ml", "default": null}. inspect_page shows what a page offers to build rules from.

export type FieldRule={css?:string;attr?:string;jsonld?:string;microdata?:string;meta?:string;json?:string;all?:boolean;join?:string;number?:boolean;regex?:string;default?:unknown};
const MAX_AGENT_PAGES=40,MAX_CRAWLER_PAGES=5000,HOST_GAP_MS=1000,PARALLEL_HOSTS=4;

export function parseRule(raw:unknown):FieldRule{
 if(typeof raw==='string'){
  const m=/^(css|jsonld|microdata|meta|json):([\s\S]+)$/.exec(raw.trim());if(!m)throw Error('A field rule is "css:…", "jsonld:…", "microdata:…", "meta:…" or "json:…" (got "'+raw.slice(0,60)+'").');
  if(m[1]==='css'){const at=/^(.*?)@([\w:-]+)$/.exec(m[2]);return at?{css:at[1].trim(),attr:at[2]}:{css:m[2].trim()};}
  return {[m[1]]:m[2].trim()} as FieldRule;
 }
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('A field rule is a string or an object.');
 const r=raw as FieldRule;if(![r.css,r.jsonld,r.microdata,r.meta,r.json].some(x=>typeof x==='string'&&x))throw Error('A field rule names one of css, jsonld, microdata, meta, json.');
 if(r.regex)try{new RegExp(r.regex);}catch{throw Error('Invalid regex '+r.regex+'.');}
 return r;
}
export function parseFields(raw:unknown):Record<string,FieldRule>{
 const o=typeof raw==='string'?(()=>{try{return looseJson(raw);}catch{throw Error('fields must be a JSON object string: {"name": "css:h1", …}.');}})():raw;
 if(!o||typeof o!=='object'||Array.isArray(o))throw Error('fields must be an object: {"name": "css:h1", …}.');
 const entries=Object.entries(o as Record<string,unknown>);if(!entries.length||entries.length>60)throw Error('Give 1–60 fields.');
 return Object.fromEntries(entries.map(([k,v])=>{if(!/^[A-Za-z_][\w]{0,60}$/.test(k))throw Error('Field names are identifiers (got "'+k+'").');return [k,parseRule(v)];}));
}

// ───────────── structured data in a page ─────────────
type Json=unknown;
export type PageData={url:string;title:string;$:CheerioAPI;jsonld:Record<string,Json>[];embedded:Record<string,Json>};
const tryJson=(s:string):Json|undefined=>{try{return JSON.parse(s);}catch{return undefined;}};
function flattenLd(v:Json,out:Record<string,Json>[]){
 if(Array.isArray(v)){v.forEach(x=>flattenLd(x,out));return;}
 if(!v||typeof v!=='object')return;const o=v as Record<string,Json>;
 if(Array.isArray(o['@graph']))flattenLd(o['@graph'],out);
 if(o['@type'])out.push(o);
}
// window.__INITIAL_STATE__ = {...};  →  the object, balanced-brace scan (no eval).
function assignments(js:string):Record<string,Json>{
 const out:Record<string,Json>={};
 for(const m of js.matchAll(/(?:window\.|self\.|var |let |const )([A-Za-z_$][\w$]*)\s*=\s*(?=[{[])/g)){
  let i=m.index!+m[0].length,depth=0,inStr:string|null=null;const start=i;
  for(;i<js.length&&i-start<5_000_000;i++){const c=js[i];
   if(inStr){if(c==='\\')i++;else if(c===inStr)inStr=null;continue;}
   if(c==='"'||c==="'"||c==='`')inStr=c;else if(c==='{'||c==='[')depth++;else if((c==='}'||c===']')&&--depth===0){const v=tryJson(js.slice(start,i+1));if(v!==undefined)out[m[1]]=v;break;}}
 }
 return out;
}
export function readPage(url:string,html:string):PageData{
 const $=load(html);
 const jsonld:Record<string,Json>[]=[];
 $('script[type="application/ld+json"]').each((_,el)=>{const v=tryJson($(el).text().trim());if(v!==undefined)flattenLd(v,jsonld);});
 const embedded:Record<string,Json>={};
 $('script[type="application/json"], script#__NEXT_DATA__, script#__NUXT_DATA__').each((i,el)=>{const v=tryJson($(el).text().trim());if(v!==undefined)embedded[$(el).attr('id')||$(el).attr('data-target')||'json'+i]=v;});
 $('script:not([src])').each((_,el)=>{const t=$(el).text();if(t.length>40&&/=\s*[{[]/.test(t))Object.assign(embedded,assignments(t));});
 return {url,title:$('title').first().text().trim(),$,jsonld,embedded};
}
function pathGet(v:Json,path:string[]):Json[]{
 let cur:Json[]=[v];
 for(const seg of path){const next:Json[]=[];
  for(const x of cur){if(x==null||typeof x!=='object')continue;
   if(seg==='*'){if(Array.isArray(x))next.push(...x);else next.push(...Object.values(x as object));continue;}
   const idx=/^\[?(\d+)\]?$/.exec(seg);
   if(Array.isArray(x)){if(idx)next.push(x[Number(idx[1])]);else for(const y of x)if(y&&typeof y==='object')next.push((y as Record<string,Json>)[seg]);}
   else next.push((x as Record<string,Json>)[seg]);}
  cur=next.filter(x=>x!==undefined);
 }
 return cur.flatMap(x=>Array.isArray(x)&&path.length?x:[x]);
}
const text=(s:string)=>s.replace(/\s+/g,' ').trim();
const scalar=(v:Json):string|number|boolean|null=>v==null?null:typeof v==='object'?((v as Record<string,Json>)['@value']??(v as Record<string,Json>).name??(v as Record<string,Json>)['@id']??JSON.stringify(v)) as string:v as string|number|boolean;
export function numberOf(v:unknown):number|null{
 if(typeof v==='number')return Number.isFinite(v)?v:null;if(typeof v!=='string')return null;
 const m=/-?\d[\d\s,.']*(?:[eE][-+]?\d+)?/.exec(v.replace(/ /g,' '));if(!m)return null;
 let s=m[0].replace(/[\s']/g,'');
 // "1.234,5" (European) vs "1,234.5": the last separator is the decimal one when followed by 1–2 digits.
 if(/,\d{1,2}$/.test(s)&&s.includes('.'))s=s.replace(/\./g,'').replace(',','.');else if(/^\d{1,3}(,\d{3})+$/.test(s)||s.includes('.'))s=s.replace(/,/g,'');else s=s.replace(',','.');
 const n=Number(s);return Number.isFinite(n)?n:null;
}
export function extractField(p:PageData,rule:FieldRule):unknown{
 const {$}=p;let values:unknown[]=[];
 if(rule.css){const els=$(rule.css);const pick=rule.all?els.toArray():els.toArray().slice(0,1);
  values=pick.map(el=>{const e=$(el);const a=rule.attr;
   if(!a||a==='text')return text(e.text());if(a==='html')return e.html()??'';
   const v=e.attr(a);if(v==null)return null;return (a==='href'||a==='src')?(()=>{try{return new URL(v,p.url).href;}catch{return v;}})():v;});}
 else if(rule.microdata){const els=$('[itemprop="'+rule.microdata.replace(/"/g,'')+'"]');const pick=rule.all?els.toArray():els.toArray().slice(0,1);
  values=pick.map(el=>{const e=$(el);return e.attr('content')??e.attr('href')??e.attr('src')??e.attr('datetime')??text(e.text());});}
 else if(rule.meta){const k=rule.meta.replace(/"/g,'');values=[$('meta[property="'+k+'"]').attr('content')??$('meta[name="'+k+'"]').attr('content')??null];}
 else if(rule.jsonld){const [type,...path]=rule.jsonld.split('.');
  const objs=p.jsonld.filter(o=>{const t=o['@type'];return Array.isArray(t)?t.includes(type):t===type;});
  values=objs.flatMap(o=>path.length?pathGet(o,path):[o]).map(scalar);if(!rule.all)values=values.slice(0,1);}
 else if(rule.json){values=pathGet(p.embedded,rule.json.split('.')).map(scalar);if(!rule.all)values=values.slice(0,1);}
 values=values.filter(v=>v!=null&&v!=='');
 if(rule.regex){const re=new RegExp(rule.regex);values=values.map(v=>{const m=re.exec(String(v));return m?(m[1]??m[0]):null;}).filter(v=>v!=null);}
 if(rule.number)values=values.map(numberOf).filter(v=>v!=null);
 if(!values.length)return rule.default??null;
 if(rule.all)return rule.join!=null?values.map(String).join(rule.join):values.map(String).join('; ');
 return values[0];
}

// ───────────── inspect a page: what rules could read ─────────────
function selectorFor($:CheerioAPI,el:unknown):string{
 const parts:string[]=[];
 // eslint-disable-next-line @typescript-eslint/no-explicit-any
 let cur:any=$(el as never);
 for(let d=0;d<4&&cur.length;d++){
  const node=cur.get(0) as {tagName?:string}|undefined;if(!node?.tagName)break;const tag=node.tagName;
  const id=cur.attr('id');if(id&&/^[A-Za-z][\w-]*$/.test(id)){parts.unshift(tag+'#'+id);break;}
  const ip=cur.attr('itemprop');if(ip){parts.unshift('['+'itemprop="'+ip+'"]');break;}
  const cls=(cur.attr('class')||'').split(/\s+/).filter((c:string)=>/^[A-Za-z][\w-]{1,40}$/.test(c)&&!/^(active|selected|hidden|js-|is-)/.test(c)).slice(0,2);
  parts.unshift(tag+(cls.length?'.'+cls.join('.'):''));if(cls.length)break;
  cur=cur.parent();
 }
 return parts.join(' > ');
}
function scalarPaths(v:Json,prefix:string,out:{path:string;value:string}[],depth=0){
 if(out.length>=80||depth>6||v==null)return;
 if(typeof v!=='object'){out.push({path:prefix,value:String(v).slice(0,80)});return;}
 if(Array.isArray(v)){if(v.length)scalarPaths(v[0],prefix+'.0',out,depth+1);return;}
 for(const [k,x] of Object.entries(v as object).slice(0,40))scalarPaths(x,prefix?prefix+'.'+k:k,out,depth+1);
}
export function inspectPage(p:PageData){
 const {$}=p;
 const jsonld=p.jsonld.slice(0,8).map(o=>{const paths:{path:string;value:string}[]=[];scalarPaths(o,'',paths);const t=Array.isArray(o['@type'])?(o['@type'] as string[])[0]:String(o['@type']);
  return {type:t,fields:paths.filter(x=>!x.path.startsWith('@')).slice(0,30).map(x=>({rule:'jsonld:'+t+'.'+x.path,value:x.value}))};});
 const microdata=$('[itemprop]').toArray().slice(0,40).map(el=>{const e=$(el);const k=e.attr('itemprop')!;return {rule:'microdata:'+k,value:String(e.attr('content')??e.attr('href')??text(e.text())).slice(0,80)};});
 const meta=$('meta[property], meta[name]').toArray().map(el=>({k:$(el).attr('property')||$(el).attr('name')||'',v:$(el).attr('content')||''})).filter(x=>/^(og:|twitter:|description|keywords|product:|article:)/.test(x.k)&&x.v).slice(0,20).map(x=>({rule:'meta:'+x.k,value:x.v.slice(0,80)}));
 const embedded:{rule:string;value:string}[]=[];for(const [k,v] of Object.entries(p.embedded)){const paths:{path:string;value:string}[]=[];scalarPaths(v,k,paths);embedded.push(...paths.slice(0,40).map(x=>({rule:'json:'+x.path,value:x.value})));if(embedded.length>=80)break;}
 // Label → value pairs on the page (dt/dd, th/td, "Label: value"), with a selector for the value.
 const labelled:{label:string;value:string;rule:string}[]=[];
 $('dt').each((_,el)=>{const dd=$(el).next('dd');if(dd.length&&labelled.length<40)labelled.push({label:text($(el).text()).slice(0,40),value:text(dd.text()).slice(0,80),rule:'css:'+selectorFor($,dd.get(0))});});
 $('tr').each((_,el)=>{const th=$(el).children('th').first(),td=$(el).children('td').first();if(th.length&&td.length&&labelled.length<60)labelled.push({label:text(th.text()).slice(0,40),value:text(td.text()).slice(0,80),rule:'css:'+selectorFor($,td.get(0))});});
 const headings=$('h1, h2').toArray().slice(0,8).map(el=>({rule:'css:'+selectorFor($,el),value:text($(el).text()).slice(0,80)}));
 // Link patterns: where the detail pages are (same site, grouped by the first path segments).
 const groups=new Map<string,{n:number;example:string}>();
 $('a[href]').each((_,el)=>{try{const u=new URL($(el).attr('href')!,p.url);if(u.host!==new URL(p.url).host)return;const segs=u.pathname.split('/').filter(Boolean);if(!segs.length)return;
  const key='/'+segs.slice(0,Math.min(2,segs.length-1)||1).join('/')+'/';const g=groups.get(key)??{n:0,example:u.href};g.n++;groups.set(key,g);}catch{}});
 const links=[...groups].sort((a,b)=>b[1].n-a[1].n).slice(0,12).map(([pattern,g])=>({linkPattern:pattern,count:g.n,example:g.example}));
 return {url:p.url,title:p.title,jsonld,microdata,meta,embedded:embedded.slice(0,80),labelled,headings,links,
  note:'Prefer jsonld/microdata/json rules (stable across redesigns) over css; test the rules with extract_fields on 3–5 pages before saving a recipe.'};
}

// ───────────── fetch pages politely ─────────────
export async function pageHtml(url:string,render:boolean,signal:AbortSignal):Promise<{url:string;html:string}>{
 if(render){const {renderPage}=await import('./browser');const r=await renderPage(url,{captureJson:false},signal);if(r.blocked||r.challenge)throw Error('Blocked: '+(r.blocked||'challenge'));return {url:r.url,html:r.html};}
 const r=await fetchText(url,signal,{accept:'text/html,application/xhtml+xml'});return {url:r.url,html:r.text};
}
export async function inspectPageTool(args:{url:string;render:boolean},signal:AbortSignal){
 const r=await pageHtml(publicUrl(args.url).href,args.render,signal);return inspectPage(readPage(r.url,r.html));
}
// Runs pages host by host (≥ 1 s apart on a host, a few hosts at once), within the time budget.
export async function politely<T>(urls:string[],work:(url:string)=>Promise<T>,signal:AbortSignal):Promise<(T|Error)[]>{
 const byHost=new Map<string,number[]>();urls.forEach((u,i)=>{const h=new URL(u).host;const l=byHost.get(h)??[];l.push(i);byHost.set(h,l);});
 const out:(T|Error)[]=new Array(urls.length);const queues=[...byHost.values()];
 const worker=async()=>{for(let q=queues.shift();q;q=queues.shift())for(const i of q){if(signal.aborted){out[i]=Error('Stopped: time budget reached.');continue;}
  const t0=Date.now();try{out[i]=await work(urls[i]);}catch(e){out[i]=e instanceof Error?e:Error(String(e));}
  const wait=HOST_GAP_MS-(Date.now()-t0);if(wait>0)await new Promise(r=>setTimeout(r,wait));}};
 await Promise.all(Array.from({length:Math.min(PARALLEL_HOSTS,queues.length)},worker));
 return out;
}
export type ExtractArgs={urls:string;datasetId:string;urlColumn:string;linkPattern:string;fields:string;render:boolean;maxPages:number;title:string};
export async function extractFieldsTool(args:ExtractArgs,scope:string,signal:AbortSignal,crawler:boolean){
 const fields=parseFields(args.fields);
 let urls=String(args.urls||'').split(/[\s,]+/).map(s=>s.trim()).filter(Boolean);
 if(args.datasetId){const d=await loadDataset(scope,args.datasetId);const col=args.urlColumn||'url';if(!d.columns.includes(col))throw Error('Column "'+col+'" is not in the dataset (columns: '+d.columns.slice(0,30).join(', ')+').');
  urls.push(...d.rows.map(r=>String(r[col]??'').trim()).filter(Boolean));}
 if(args.linkPattern){const match=linkMatcher(args.linkPattern);urls=urls.filter(match);}
 urls=[...new Set(urls.map(u=>{try{return publicUrl(u).href;}catch{return '';}}).filter(Boolean))];
 if(!urls.length)throw Error('No page URLs: give urls, or datasetId with urlColumn (e.g. the links found by crawl_pages).');
 const cap=Math.min(Math.max(1,args.maxPages||urls.length),crawler?MAX_CRAWLER_PAGES:MAX_AGENT_PAGES);
 const total=urls.length;urls=urls.slice(0,cap);
 const budget=AbortSignal.any([signal,AbortSignal.timeout(crawler?3*3600_000:240_000)]);
 const results=await politely(urls,async u=>{const r=await pageHtml(u,args.render,budget);const p=readPage(r.url,r.html);
  const row:Row={url:r.url};for(const [k,rule] of Object.entries(fields))row[k]=extractField(p,rule);return row;},budget);
 const rows=results.filter((r):r is Row=>!(r instanceof Error));
 const errors=results.map((r,i)=>r instanceof Error?{url:urls[i],error:r.message.slice(0,160)}:null).filter(Boolean).slice(0,10);
 // Fill rate per field: the share of fetched pages where the rule found a value (a site redesign shows up here).
 const fillRates=Object.fromEntries(Object.keys(fields).map(k=>[k,rows.length?Math.round(rows.filter(r=>r[k]!=null&&r[k]!=='').length/rows.length*1000)/10:0]));
 const summary=await saveDataset(scope,{title:args.title||'Fields from '+rows.length+' pages',source:urls.length===1?urls[0]:new URL(urls[0]).host+' ('+rows.length+' pages)',rows,
  columns:['url',...Object.keys(fields)],notes:'Fill rate per field (%): '+JSON.stringify(fillRates)});
 return {...summary,pages:{requested:total,fetched:rows.length,failed:results.length-rows.length,skippedOverCap:Math.max(0,total-cap)},fillRates,errors};
}
