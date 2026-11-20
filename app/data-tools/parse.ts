// Pure parsers for fetched data: CSV/TSV, JSON Lines, XML/RSS/Atom and JSON responses become rows
// (plain objects). No imports, so tests load this file directly.
export type Row=Record<string,unknown>;
export type DataFormat='json'|'csv'|'tsv'|'xml'|'html_table'|'jsonl';

// "1,234", "-3.5", "1.2e6", "−7" (Unicode minus) → numbers; anything else stays text.
const PLAIN_NUMBER=/^[-+−]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:[eE][-+]?\d+)?$/;
export function castValue(text:string):unknown{
 const t=text.trim();if(t==='')return '';
 // Codes with leading zeros ("007", ZIP codes) stay text; "0.5" and "0" are numbers.
 if(/^[-+]?0\d/.test(t))return t;
 if(PLAIN_NUMBER.test(t)){const n=Number(t.replace(/,/g,'').replace('−','-'));if(Number.isFinite(n))return n;}
 if(t==='true'||t==='TRUE')return true;if(t==='false'||t==='FALSE')return false;
 return t;
}

// RFC 4180 CSV (quoted fields, doubled quotes, newlines inside quotes); delimiter auto-detected when not given.
export function parseDelimited(text:string,delimiter?:string):Row[]{
 text=text.replace(/^﻿/,'');
 if(!delimiter){const first=text.slice(0,text.indexOf('\n')>0?text.indexOf('\n'):text.length);const counts=[',','\t',';','|'].map(d=>[d,first.split(d).length] as const).sort((a,b)=>b[1]-a[1]);delimiter=counts[0][1]>1?counts[0][0]:',';}
 const records:string[][]=[];let field='',record:string[]=[],quoted=false,i=0;
 while(i<text.length){
  const c=text[i];
  if(quoted){if(c==='"'){if(text[i+1]==='"'){field+='"';i+=2;continue;}quoted=false;i++;continue;}field+=c;i++;continue;}
  if(c==='"'&&field===''){quoted=true;i++;continue;}
  if(c===delimiter){record.push(field);field='';i++;continue;}
  if(c==='\r'){i++;continue;}
  if(c==='\n'){record.push(field);records.push(record);record=[];field='';i++;continue;}
  field+=c;i++;
 }
 if(field!==''||record.length){record.push(field);records.push(record);}
 const nonEmpty=records.filter(r=>r.some(v=>v.trim()!==''));if(!nonEmpty.length)return [];
 const headers=uniqueNames(nonEmpty[0].map((h,j)=>h.trim()||'col'+(j+1)));
 return nonEmpty.slice(1).map(r=>Object.fromEntries(headers.map((h,j)=>[h,castValue(r[j]??'')])));
}
export function uniqueNames(names:string[]){const seen=new Map<string,number>();return names.map(n=>{const k=seen.get(n)||0;seen.set(n,k+1);return k?n+' ('+(k+1)+')':n;});}

export function parseJsonLines(text:string):unknown[]{
 const out:unknown[]=[];let line=0;
 for(const raw of text.split(/\r?\n/)){line++;const t=raw.trim();if(!t)continue;try{out.push(JSON.parse(t));}catch{throw Error('Line '+line+' is not valid JSON.');}}
 return out;
}

// ---- XML ----
export type XmlNode={name:string;attrs:Record<string,string>;children:(XmlNode|string)[]};
const ENTITIES:Record<string,string>={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
export function decodeEntities(s:string){
 return s.replace(/&(#x[\da-f]+|#\d+|[a-z][a-z\d]*);/gi,(m,e:string)=>{
  if(e[0]==='#'){const n=e[1].toLowerCase()==='x'?parseInt(e.slice(2),16):parseInt(e.slice(1),10);return n>0&&n<=0x10ffff?String.fromCodePoint(n):' ';}
  return ENTITIES[e.toLowerCase()]??HTML_ENTITIES[e]??m;
 });
}
const HTML_ENTITIES:Record<string,string>={ndash:'–',mdash:'—',minus:'−',times:'×',deg:'°',hellip:'…',lsquo:'‘',rsquo:'’',ldquo:'“',rdquo:'”',middot:'·',bull:'•',thinsp:' ',ensp:' ',emsp:' ',euro:'€',pound:'£',yen:'¥',cent:'¢',copy:'©',reg:'®',trade:'™',sup2:'²',sup3:'³',frac12:'½',frac14:'¼',frac34:'¾',plusmn:'±',para:'¶',sect:'§',laquo:'«',raquo:'»',shy:''};
export function parseXml(text:string):XmlNode{
 const root:XmlNode={name:'#root',attrs:{},children:[]},stack=[root];
 const re=/<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>[]*(?:\[[\s\S]*?\])?\s*>|<\/\s*([^\s>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/gi;
 let m:RegExpExecArray|null;
 while((m=re.exec(text))){
  const top=stack[stack.length-1];
  if(m[1]!==undefined)top.children.push(m[1]);
  else if(m[2]){const name=m[2];for(let k=stack.length-1;k>0;k--)if(stack[k].name===name){stack.length=k;break;}}
  else if(m[3]){
   const attrs:Record<string,string>={};for(const a of (m[4]||'').matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g))attrs[a[1]]=decodeEntities(a[2]??a[3]??a[4]??'');
   const node:XmlNode={name:m[3],attrs,children:[]};top.children.push(node);if(!m[5])stack.push(node);
  }else if(m[6]!==undefined){const t=decodeEntities(m[6]);if(t.trim())top.children.push(t);}
 }
 return root;
}
const local=(name:string)=>name.includes(':')?name.split(':').pop()!:name;
// An element becomes a string (text only) or an object: attributes as "@name", children by local
// name (arrays when repeated), mixed text as "#text".
export function xmlToValue(node:XmlNode):unknown{
 const elements=node.children.filter((c):c is XmlNode=>typeof c!=='string');
 const text=node.children.filter((c):c is string=>typeof c==='string').join('').trim();
 const attrs=Object.entries(node.attrs).filter(([k])=>!/^xmlns(:|$)/.test(k));
 if(!elements.length&&!attrs.length)return castValue(text);
 const out:Record<string,unknown>={};
 for(const [k,v] of attrs)out['@'+local(k)]=castValue(v);
 const lists=new Set<string>();
 for(const el of elements){const k=local(el.name),v=xmlToValue(el);if(lists.has(k))(out[k] as unknown[]).push(v);else if(k in out){out[k]=[out[k],v];lists.add(k);}else out[k]=v;}
 if(text)out['#text']=castValue(text);
 return out;
}
// Rows are the most repeated element: RSS <item>, Atom <entry>, or any list of same-named siblings.
export function xmlRows(text:string):{rows:Row[];element:string}{
 const root=parseXml(text);let best:{node:XmlNode;name:string;count:number}|null=null;
 const walk=(node:XmlNode,depth:number)=>{
  if(depth>12)return;
  const counts=new Map<string,number>();for(const c of node.children)if(typeof c!=='string')counts.set(c.name,(counts.get(c.name)||0)+1);
  for(const [name,count] of counts){const bonus=/^(item|entry|record|row)$/i.test(local(name))?1000:0;if(count>=2&&(!best||count+bonus>best.count))best={node,name,count:count+bonus};}
  for(const c of node.children)if(typeof c!=='string')walk(c,depth+1);
 };
 walk(root,0);
 const chosen=best as {node:XmlNode;name:string}|null;
 if(!chosen){const top=root.children.find((c):c is XmlNode=>typeof c!=='string');return {rows:top?[flattenRow(asRow(xmlToValue(top)))]:[],element:top?.name||''};}
 const rows=chosen.node.children.filter((c):c is XmlNode=>typeof c!=='string'&&c.name===chosen.name).map(c=>flattenRow(asRow(xmlToValue(c))));
 return {rows,element:local(chosen.name)};
}
const asRow=(v:unknown):Row=>v&&typeof v==='object'&&!Array.isArray(v)?v as Row:{value:v};

// Nested objects become dotted columns ("country.value"); arrays of scalars are joined with "; ".
export function flattenRow(row:Row,maxDepth=3):Row{
 const out:Row={};
 const put=(prefix:string,v:unknown,depth:number)=>{
  if(v&&typeof v==='object'&&!Array.isArray(v)&&depth<maxDepth){const entries=Object.entries(v as Row);if(!entries.length){out[prefix]='';return;}for(const [k,x] of entries)put(prefix?prefix+'.'+k:k,x,depth+1);return;}
  if(Array.isArray(v)&&v.every(x=>x==null||typeof x!=='object')){out[prefix]=v.length===1?v[0]:v.join('; ');return;}
  out[prefix]=v;
 };
 for(const [k,v] of Object.entries(row))put(k,v,1);
 return out;
}

// The rows of a JSON response when no select expression is given: the array itself, or the largest
// array of objects inside it (World Bank's [meta, rows], {"data":[…]}, {"results":[…]}, GeoJSON features…).
export function jsonRows(value:unknown):{rows:Row[];path:string}{
 let best:{arr:unknown[];path:string;score:number;columns?:string[]}|null=null;
 const visit=(v:unknown,path:string,depth:number)=>{
  if(depth>5||v==null||typeof v!=='object')return;
  // Columnar JSON ({"years":[…],"values":[…]} with equal lengths) is zipped into rows.
  if(!Array.isArray(v)){
   const cols=Object.entries(v as Row).filter(([,x])=>Array.isArray(x)&&x.length>1&&x.every(y=>y==null||typeof y!=='object'));
   const len=cols[0]?(cols[0][1] as unknown[]).length:0,same=cols.filter(([,x])=>(x as unknown[]).length===len);
   if(same.length>=2&&(!best||len*2+1>best.score))best={arr:Array.from({length:len},(_,i)=>Object.fromEntries(same.map(([k,x])=>[k,(x as unknown[])[i]]))),path:path+'{'+same.map(([k])=>k).join(',')+'}',score:len*2+1};
  }
  if(Array.isArray(v)){
   const objects=v.filter(x=>x&&typeof x==='object'&&!Array.isArray(x)).length;
   const score=objects*2+(v.length-objects);
   if(v.length&&(!best||score>best.score))best={arr:v,path,score};
   v.slice(0,50).forEach((x,i)=>{if(Array.isArray(x)||x&&typeof x==='object')visit(x,path+'['+i+']',depth+1);});
   return;
  }
  for(const [k,x] of Object.entries(v as Row))visit(x,path+'.'+k,depth+1);
 };
 visit(value,'$',0);
 const chosen=best as {arr:unknown[];path:string}|null;
 if(!chosen)return {rows:value&&typeof value==='object'?[flattenRow(value as Row)]:[{value}],path:'$'};
 return {rows:chosen.arr.map(x=>x&&typeof x==='object'&&!Array.isArray(x)?flattenRow(x as Row):{value:x}),path:chosen.path};
}

// A short description of a JSON value's shape, e.g. 'object{data:array(50×object{id,name,…}),total:number}'.
export function describeShape(v:unknown,depth=0):string{
 if(v===null)return 'null';
 if(Array.isArray(v))return 'array('+v.length+(v.length?'×'+(depth>=2?typeof v[0]:describeShape(v[0],depth+1)):'')+')';
 if(typeof v==='object'){
  const keys=Object.keys(v as Row);if(depth>=2)return 'object{'+keys.slice(0,6).join(',')+(keys.length>6?',…':'')+'}';
  return 'object{'+keys.slice(0,8).map(k=>k+':'+describeShape((v as Row)[k],depth+1)).join(',')+(keys.length>8?',…':'')+'}';
 }
 return typeof v;
}

export function detectFormat(contentType:string,text:string,url=''):DataFormat{
 const t=contentType.toLowerCase(),head=text.trimStart().slice(0,500);
 if(/json/.test(t)&&!/ndjson|jsonl|json-seq/.test(t))return 'json';
 if(/ndjson|jsonl/.test(t)||/\.jsonl$|\.ndjson$/i.test(url))return 'jsonl';
 if(/tab-separated/.test(t)||/\.tsv$/i.test(url))return 'tsv';
 if(/csv/.test(t)||/\.csv$/i.test(url))return 'csv';
 if(/html/.test(t)||/^<!doctype html|^<html/i.test(head))return 'html_table';
 if(/xml|rss|atom/.test(t)||/^<\?xml|^<(rss|feed|rdf)/i.test(head))return 'xml';
 if(/^[[{]/.test(head)){const lines=text.trim().split(/\n/);if(lines.length>1&&lines.slice(0,3).every(l=>/^\s*\{.*\}\s*$/.test(l))){try{JSON.parse(text);return 'json';}catch{return 'jsonl';}}return 'json';}
 if(/^</.test(head))return 'xml';
 const first=head.split('\n')[0];return first.includes('\t')?'tsv':'csv';
}

// Login walls and bot challenges: the tools say so instead of returning a challenge page as data.
export function blockedReason(text:string,title='',url=''):string|null{
 const t=(title+' '+text.slice(0,4000)).toLowerCase(),short=text.replace(/\s+/g,' ').trim().length<3000;
 if(/just a moment\.\.\.|attention required! \| cloudflare|cf-chl-|challenge-platform|captcha|verify you are (a )?human|are you a robot|unusual traffic|press (&|and) hold|access denied|request blocked|bot detection|perimeterx|datadome/.test(t)&&short)return 'This site answered with a bot-protection or human-verification page, so it cannot be read automatically. Do not try to get around it: use the platform\'s public API, an official data export, or another source.';
 if((/\/(login|signin|sign-in|log-in|accounts\/login|auth)\b/i.test(url)||/(sign|log) ?in to (continue|view|see)|you must (be logged|log) in|please (sign|log) in/.test(t))&&short)return 'This page needs a login, so it cannot be read. Only public data can be used: try the platform\'s public API, its public profile/listing pages, or another source.';
 return null;
}
