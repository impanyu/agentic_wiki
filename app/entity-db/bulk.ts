import {mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import type {AgentContext} from '@/app/components-registry/registry';
import {openStream,lines,delimitedRecords} from '@/app/data-tools/stream';
import {fetchText} from '@/app/data-tools/net';
import {upsertEntities,type EntityMapping} from './repo';
import type {EntityDb} from './client';
// Bulk loading: a collector points a recipe at a large public dump (CSV/TSV/JSON Lines, gzip or not, one file or
// many shards) and the crawler streams it into the entity database by program, in batches, resuming where it
// stopped. RankWiki ranks the best of each kind, so every bulk source has an admission rule: rows that fail it
// (too minor to ever rank) are dropped while streaming and never stored. keepTop instead keeps only the N best
// rows of the whole source by one column.
export type Cond=string|number|boolean|null|{[op:string]:unknown};
export type BulkSpec={urls:string[];indexUrl?:string;indexPattern?:string;format:'csv'|'tsv'|'jsonl';commentPrefix?:string;
 fields?:Record<string,string>;where:Record<string,Cond>;keepTop?:{by:string;n:number;order?:'desc'|'asc'};maxRows?:number;
 mapping:EntityMapping;source:string};
export type BulkProgress={file:number;line:number;scanned:number;admitted:number;loaded:number;done:boolean;files?:number;startedAt:string};
const BATCH=1000;

const num=(v:unknown)=>{if(typeof v==='number')return v;if(typeof v==='string'&&v.trim()!==''){const n=Number(v.replace(/,/g,''));return Number.isFinite(n)?n:NaN;}return NaN;};
// {"cited_by_count":{">=":200},"type":"article","language":{"in":["en","zh"]},"title":{"exists":true}}
export function admits(row:Record<string,unknown>,where:Record<string,Cond>):boolean{
 for(const [k,c] of Object.entries(where)){
  const v=row[k];
  if(c===null||typeof c!=='object'){if(String(v??'')!==String(c??''))return false;continue;}
  for(const [op,want] of Object.entries(c)){
   const n=num(v),w=num(want);
   switch(op){
    case '>':if(!(n>w))return false;break;case '>=':if(!(n>=w))return false;break;
    case '<':if(!(n<w))return false;break;case '<=':if(!(n<=w))return false;break;
    case '=':if(String(v??'')!==String(want))return false;break;case '!=':if(String(v??'')===String(want))return false;break;
    case 'in':if(!Array.isArray(want)||!want.map(String).includes(String(v??'')))return false;break;
    case 'exists':if((v!==undefined&&v!==null&&v!=='')!==Boolean(want))return false;break;
    case 'contains':if(!String(v??'').toLowerCase().includes(String(want).toLowerCase()))return false;break;
    default:throw Error('where: unknown operator "'+op+'" (use > >= < <= = != in exists contains).');
   }
  }
 }
 return true;
}
// A dynamic admission rule follows the current rankings: "rank:1000" is the value of the entity now ranked 1000th
// on that column's metric (the metric it loads into), "*0.8" widens it, "or 200" applies while fewer are ranked.
// e.g. {"cited_by_count":{">=":"rank:1000*0.8 or 200"}}: on every refresh only rows that could enter the top 1000
// are fetched and updated; the rest are skipped.
const CUTOFF=/^rank:(\d+)(?:\*([\d.]+))?(?:\s+or\s+(-?[\d.eE+]+))?$/;
export async function resolveCutoffs(db:EntityDb,where:Record<string,Cond>,mapping:EntityMapping):Promise<{where:Record<string,Cond>;cutoffs:Record<string,number|null>}>{
 const out:Record<string,Cond>={},cutoffs:Record<string,number|null>={};
 for(const [col,c] of Object.entries(where)){
  if(c===null||typeof c!=='object'){out[col]=c;continue;}
  const conds:Record<string,unknown>={};
  for(const [op,want] of Object.entries(c)){
   const m=typeof want==='string'?CUTOFF.exec(want.trim()):null;
   if(!m){conds[op]=want;continue;}
   if(!['>','>=','<','<='].includes(op))throw Error('where: "'+want+'" needs > >= < or <=.');
   const metric=mapping.metricColumns?.[col]?.metric?.split('@')[0]||col;
   const r=await db.query<{v:string}>(`select v from (select distinct on (o.entity_id) o.value v from observations o join entities e on e.id=o.entity_id
     where e.type=$1::text and o.metric=$2::text order by o.entity_id, o.period desc, o.retrieved_at desc) x order by v ${op[0]==='>'?'desc':'asc'} offset $3::int limit 1`,[mapping.type,metric,Number(m[1])-1]);
   const at=r.rows[0]?Number(r.rows[0].v):null;
   const value=at!==null?at*(m[2]?Number(m[2]):1):m[3]!==undefined?Number(m[3]):null;
   cutoffs[col+' '+op]=value;
   if(value!==null)conds[op]=value;
  }
  if(Object.keys(conds).length)out[col]=conds as Cond;
 }
 return {where:out,cutoffs};
}
export function checkSpec(s:BulkSpec){
 if(!s.urls.length&&!s.indexUrl)throw Error('Give url (one address or a JSON array of addresses) or indexUrl + indexPattern.');
 if(!Object.keys(s.where).length&&!s.keepTop)throw Error('A bulk source needs an admission rule: where (e.g. \'{"cited_by_count":{">=":200}}\') or keepTop (e.g. \'{"by":"cited_by_count","n":50000}\'). RankWiki keeps only entities that can rank; minor rows are not stored.');
 if(s.keepTop&&!(s.keepTop.n>=1&&s.keepTop.n<=200_000))throw Error('keepTop.n is between 1 and 200000.');
}
const pick=(o:unknown,p:string):unknown=>p.split('.').reduce<unknown>((x,k)=>x&&typeof x==='object'?(x as Record<string,unknown>)[k]:undefined,o);
function shape(raw:Record<string,unknown>,fields?:Record<string,string>){
 if(!fields||!Object.keys(fields).length){const out:Record<string,unknown>={};for(const [k,v] of Object.entries(raw))out[k]=v!==null&&typeof v==='object'?JSON.stringify(v):v;return out;}
 const out:Record<string,unknown>={};
 for(const [name,p] of Object.entries(fields)){const v=pick(raw,p);out[name]=Array.isArray(v)?v.map(x=>typeof x==='object'?JSON.stringify(x):x).join('; '):v!==null&&typeof v==='object'?JSON.stringify(v):v;}
 return out;
}
async function* rowsOf(url:string,s:BulkSpec,signal:AbortSignal):AsyncGenerator<{line:number;row:Record<string,unknown>}>{
 const {body}=await openStream(url,signal);
 try{
  let src:AsyncIterable<string>=lines(body);
  if(s.commentPrefix){const inner=src,pre=s.commentPrefix;src=(async function*(){for await(const l of inner)if(!l.startsWith(pre))yield l;})();}
  let n=0;
  if(s.format==='jsonl'){for await(const l of src){n++;if(!l.trim())continue;let o:unknown;try{o=JSON.parse(l);}catch{continue;}if(o&&typeof o==='object')yield {line:n,row:shape(o as Record<string,unknown>,s.fields)};}return;}
  let header:string[]|null=null;
  for await(const rec of delimitedRecords(src,s.format==='tsv'?'\t':',')){
   if(!header){header=rec.map(h=>h.trim());continue;}
   n++;const o:Record<string,unknown>={};header.forEach((h,i)=>{o[h]=rec[i];});
   yield {line:n,row:shape(o,s.fields)};
  }
 }finally{body.destroy();}
}
export async function resolveUrls(s:BulkSpec,signal:AbortSignal):Promise<string[]>{
 if(!s.indexUrl)return s.urls;
 const {text,url}=await fetchText(s.indexUrl,signal,{anyType:true,maxBytes:20*1024*1024});
 const re=s.indexPattern?new RegExp(s.indexPattern):null;const out=new Set<string>();
 // Links in an HTML listing, URLs in a JSON/text manifest (s3://bucket/key is the bucket's public https address), or bare file names.
 for(const m of text.matchAll(/(?:href=["']([^"']+)["'])|((?:https?|s3):\/\/[^\s"'<>,]+)|(^[^\s<>"']+\.(?:gz|csv|tsv|jsonl|json|txt)$)/gim)){
  let raw=m[1]||m[2]||m[3];if(!raw)continue;
  const s3=/^s3:\/\/([^/]+)\/(.+)$/.exec(raw);if(s3)raw='https://'+s3[1]+'.s3.amazonaws.com/'+s3[2];
  let abs:string;try{abs=new URL(raw,url).href;}catch{continue;}
  if(re?re.test(abs):/\.(gz|csv|tsv|jsonl)$/i.test(abs))out.add(abs);
 }
 if(!out.size)throw Error('indexUrl lists no matching files'+(s.indexPattern?' for indexPattern '+s.indexPattern:'')+'.');
 return [...out].sort();
}
// Top-N over a stream: a bounded array kept sorted lazily (rows past the current cut-off are skipped cheaply).
class TopN{
 rows:{v:number;row:Record<string,unknown>}[]=[];cut=-Infinity;
 constructor(public n:number,public by:string,public asc:boolean){}
 add(row:Record<string,unknown>){
  let v=num(row[this.by]);if(!Number.isFinite(v))return;if(this.asc)v=-v;
  if(this.rows.length>=this.n&&v<=this.cut)return;
  this.rows.push({v,row});
  if(this.rows.length>=this.n*2){this.rows.sort((a,b)=>b.v-a.v);this.rows.length=this.n;this.cut=this.rows[this.n-1].v;}
 }
 final(){this.rows.sort((a,b)=>b.v-a.v);if(this.rows.length>this.n)this.rows.length=this.n;return this.rows.map(r=>r.row);}
}
const stateDir=()=>path.join(process.env.DATA_DIR||'./data','bulk');
const safe=(k:string)=>k.replace(/[^a-z0-9_.-]+/gi,'_').slice(0,180);
// One run: streams from the saved position until the time budget is spent (crawler) or maxRows rows were
// scanned (an agent's trial run, which never saves progress). Returns the progress; done=false means call again.
export async function runBulk(db:EntityDb,s:BulkSpec,ctx:AgentContext,signal:AbortSignal,{key,budgetMs,persist}:{key:string;budgetMs:number;persist:boolean}){
 checkSpec(s);
 const {where,cutoffs}=await resolveCutoffs(db,s.where,s.mapping);s={...s,where};
 const urls=await resolveUrls(s,signal);
 const file=path.join(stateDir(),safe(key)+'.json'),topFile=file.replace(/\.json$/,'.top.json');
 let p:BulkProgress={file:0,line:0,scanned:0,admitted:0,loaded:0,done:false,startedAt:new Date().toISOString()};
 if(persist){try{const saved=JSON.parse(await readFile(file,'utf8')) as BulkProgress;if(!saved.done)p=saved;}catch{}}
 const top=s.keepTop?new TopN(s.keepTop.n,s.keepTop.by,s.keepTop.order==='asc'):null;
 if(top&&persist&&p.file>0){try{const t=JSON.parse(await readFile(topFile,'utf8')) as Record<string,unknown>[];t.forEach(r=>top.add(r));}catch{}}
 const t0=Date.now(),counts={inserted:0,merged:0,skipped:0,observations:0,relations:0,errors:[] as string[]};
 let batch:Record<string,unknown>[]=[];
 const flush=async()=>{if(!batch.length)return;const r=await upsertEntities(db,batch,s.mapping,{source:s.source});
  counts.inserted+=r.inserted;counts.merged+=r.merged;counts.skipped+=r.skipped;counts.observations+=r.observations;counts.relations+=r.relations;
  if(r.errors?.length&&counts.errors.length<10)counts.errors.push(...r.errors.slice(0,10-counts.errors.length).map(String));
  p.loaded+=batch.length;batch=[];};
 const save=async()=>{if(!persist)return;await mkdir(stateDir(),{recursive:true});await writeFile(file,JSON.stringify({...p,files:urls.length}));};
 const limit=s.maxRows||Infinity;let stop=false;
 for(;p.file<urls.length&&!stop;p.file++,p.line=0){
  // A shard is read whole before the position moves on, so a top-N never double counts a resumed shard.
  const resumeLine=top?0:p.line;
  for await(const {line,row} of rowsOf(urls[p.file],s,signal)){
   if(line<=resumeLine)continue;
   p.scanned++;p.line=line;
   if(admits(row,s.where)){p.admitted++;if(top)top.add(row);else{batch.push(row);if(batch.length>=BATCH){await flush();await save();}}}
   if(p.scanned>=limit){stop=true;break;}
   if(!top&&Date.now()-t0>budgetMs){stop=true;break;}
  }
  if(stop)break;
  if(top&&persist){await mkdir(stateDir(),{recursive:true});await writeFile(topFile,JSON.stringify(top.final()));}
  if(top&&Date.now()-t0>budgetMs){p.file++;p.line=0;stop=true;break;}
 }
 await flush();
 if(p.file>=urls.length){
  if(top){batch=top.final();await flush();if(persist)await rm(topFile,{force:true});}
  p.done=true;
 }
 await save();
 return {...p,files:urls.length,...counts,...(Object.keys(cutoffs).length?{cutoffs}:{}),partial:!p.done,note:p.done?undefined:'Partial: the next run continues from file '+(p.file+1)+' line '+p.line+'.'};
}
