// Tolerant tool arguments. Agents (open models especially) often send "empty" as the text `""`, `''` or `null`,
// wrap JSON in an extra layer of quotes, put a stray quote in an argument's name, or write almost-JSON (code fences,
// trailing commas, raw line breaks inside strings, Python True/None). Each of these used to fail the call and cost a
// round; they are read as meant instead. Applied once where every tool call enters (team, data and entity tools).

const EMPTY=new Set(['""',"''",'null','undefined','NULL','"null"',"'null'",'\\"\\"']);

// Raw control characters inside string literals (a SPARQL query pasted with its line breaks) escaped.
function escapeControlInStrings(s:string){
 let out='',inStr=false,esc=false;
 for(const ch of s){
  if(inStr){
   if(esc){esc=false;out+=ch;continue;}
   if(ch==='\\'){esc=true;out+=ch;continue;}
   if(ch==='"'){inStr=false;out+=ch;continue;}
   if(ch==='\n'){out+='\\n';continue;}if(ch==='\r'){out+='\\r';continue;}if(ch==='\t'){out+='\\t';continue;}
   out+=ch;continue;}
  if(ch==='"')inStr=true;out+=ch;}
 return out;
}

// JSON.parse, then the usual near-misses repaired one by one.
export function looseJson(text:unknown):unknown{
 if(text!==null&&typeof text==='object')return text;
 let s=String(text??'').trim();
 if(!s||EMPTY.has(s))return undefined;
 const tryParse=(x:string):{ok:boolean;v?:unknown}=>{try{return {ok:true,v:JSON.parse(x)};}catch{return {ok:false};}};
 const unwrap=(v:unknown):unknown=>{
  // A JSON document wrapped in quotes once more: "{\"a\":1}".
  if(typeof v==='string'){const t=v.trim();if(!t||EMPTY.has(t))return undefined;if(/^[[{]/.test(t)){const r=tryParse(t);if(r.ok)return r.v;}}
  return v;};
 let r=tryParse(s);if(r.ok)return unwrap(r.v);
 s=s.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
 s=s.replace(/[\u201c\u201d]/g,'"').replace(/[\u2018\u2019]/g,"'");
 const fixes=[
  (x:string)=>x,
  (x:string)=>escapeControlInStrings(x),
  (x:string)=>x.replace(/,\s*([}\]])/g,'$1'),
  (x:string)=>x.replace(/\bTrue\b/g,'true').replace(/\bFalse\b/g,'false').replace(/\bNone\b/g,'null'),
  // Over-escaped quotes: {\"a\":\"b\"}.
  (x:string)=>/^[[{]\s*\\"/.test(x)?x.replace(/\\"/g,'"'):x,
  // Single-quoted JSON: {'a': 'b'} (only when there are no double quotes to break).
  (x:string)=>x.includes('"')?x:x.replace(/'/g,'"'),
  // Unquoted keys: {region: "Asia"}.
  (x:string)=>x.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g,'$1"$2":'),
 ];
 let cur=s;
 for(const f of fixes){cur=f(cur);r=tryParse(cur);if(r.ok)return unwrap(r.v);}
 throw Error('not valid JSON');
}

// An argument's value as the tool means it: "empty" spellings become '', JSON wrapped in extra quotes is unwrapped.
function cleanValue(v:unknown):unknown{
 if(typeof v!=='string')return v;
 const t=v.trim();
 if(EMPTY.has(t))return '';
 // "\"{...}\"" or "\"[...]\"": a JSON document quoted once more.
 if(/^"[[{]/.test(t)&&/[\]}]"$/.test(t)){try{const inner=JSON.parse(t);if(typeof inner==='string')return inner;}catch{}}
 // "\"\"" style literal of an empty string inside quotes, and a quoted plain number/boolean.
 if(/^"(?:-?\d+(?:\.\d+)?|true|false)"$/.test(t))return t.slice(1,-1);
 return v;
}
// Argument names with stray quotes, backslashes or spaces ("expression\"") fixed.
export function normalizeArgs(args:Record<string,unknown>):Record<string,unknown>{
 if(!args||typeof args!=='object')return {};
 const out:Record<string,unknown>={};
 for(const [k,v] of Object.entries(args)){const key=k.replace(/[\\"'\s]/g,'');if(!key)continue;if(key in out&&out[key]!==''&&out[key]!==undefined)continue;out[key]=cleanValue(v);}
 return out;
}
