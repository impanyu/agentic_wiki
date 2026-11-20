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

// Login walls and interactive challenges. Only a page that actually IS a challenge or a login
// wall counts — a normal page that merely loads a protection or CAPTCHA script (Cloudflare's
// challenge-platform beacon, DataDome tags, an invisible reCAPTCHA on a contact form) is read
// as usual. Policy: use any page a normal anonymous visit opens; stop only at a login, a CAPTCHA
// or an interactive challenge — never solve, spoof or evade it — and fall back to archives.
export type Challenge={kind:'challenge'|'captcha'|'login'|'denied';via:string;reason:string};
const CHALLENGE_TITLE:[RegExp,string][]=[
 [/^just a moment\.*$/,'Cloudflare "Just a moment"'],[/^attention required!? \| cloudflare$/,'Cloudflare block page'],[/^one more step$/,'Cloudflare challenge'],
 [/^(ddos-guard|checking your browser.*|please wait while we verify.*|security check|human verification|are you a (robot|human)\??|robot check|pardon our interruption\.*|verifying (you are|that you are) human.*|bot verification|access to this page has been denied\.?)$/,'challenge page'],
];
const CHALLENGE_HTML:[RegExp,string,Challenge['kind']][]=[
 [/window\._cf_chl_opt|id=["']challenge-(form|running|stage)["']|cf-browser-verification|\/cdn-cgi\/challenge-platform\/h\/[bg]\/orchestrate/i,'Cloudflare challenge','challenge'],
 [/id=["']px-captcha["']|captcha\.px-cdn\.net/i,'PerimeterX "Press & Hold"','captcha'],
 [/<iframe[^>]+src=["'][^"']*captcha-delivery\.com|geo\.captcha-delivery\.com\/captcha|var dd=\{['"]rt['"]:['"][cib]['"]|ct\.captcha-delivery\.com\/[cib]\.js/i,'DataDome CAPTCHA','captcha'],
 [/_Incapsula_Resource|Incapsula incident ID/i,'Imperva/Incapsula challenge','challenge'],
 [/AwsWafIntegration\.(checkForceRefresh|getToken)|awswaf\.com\/[^"']*\/(challenge|captcha)\.js/i,'AWS WAF challenge','challenge'],
];
const CAPTCHA_WIDGET=/<iframe[^>]+src=["'][^"']*(hcaptcha\.com|google\.com\/recaptcha|recaptcha\.net\/recaptcha|challenges\.cloudflare\.com)|class=["'][^"']*\b(g-recaptcha|h-captcha|cf-turnstile)\b/i;
const CHALLENGE_TEXT=/verify (that )?you are (a )?human|are you a (robot|human)\b|i['’]?m not a robot|checking (if the site connection is secure|your browser before)|complete the security check|press (&|and) hold|unusual traffic from your computer network|enable javascript and cookies to continue|type the characters you see|confirm you are not a robot|needs to review the security of your connection|please enable js and disable any ad blocker/;
const DENIED_TEXT=/you don['’]?t have permission to access .* on this server|request unsuccessful\. incapsula|the request could not be satisfied|request blocked\. we can['’]?t connect to the server|error 1020|access denied \| .* used cloudflare/;
const LOGIN_URL=/\/(login|signin|sign-in|log-in|logon|accounts\/login|auth\/login|auth|sso|session\/new)(\/|\?|$|\.)/i;
const LOGIN_TEXT=/(sign|log) ?in to (continue|view|see|read|access|proceed)|you must (be logged|log) in|please (sign|log) in|(log|sign) in or (sign up|create an account) to (view|see|continue)|you need to (sign|log) in|this content is (only )?available to (members|subscribers|registered users)/;
const WHY=' Do not solve, spoof or get around it. Use the latest archived copy instead (call_public_source archive.wayback_fetch, or archive.commoncrawl_index + commoncrawl_fetch), the platform\'s official API or a data dump, and say on the page which criteria have reduced coverage.';
export function detectChallenge(page:{text:string;title?:string;url?:string;html?:string}):Challenge|null{
 const html=page.html||'',title=(page.title||'').replace(/\s+/g,' ').trim().toLowerCase();
 const visible=page.text.replace(/\s+/g,' ').trim(),t=(title+' '+visible.slice(0,4000)).toLowerCase();
 const tiny=visible.length<1500,short=visible.length<3000;
 const make=(kind:Challenge['kind'],via:string):Challenge=>({kind,via,reason:kind==='login'?'This page needs a login ('+via+'), so it is not public.'+WHY:kind==='denied'?'The site refused this anonymous request ('+via+') instead of serving the page.'+WHY:'This address answered with '+(kind==='captcha'?'a CAPTCHA':'an interactive challenge')+' ('+via+') instead of the page.'+WHY});
 if(short)for(const [re,via] of CHALLENGE_TITLE)if(re.test(title))return make(/access .* denied/.test(title)?'denied':'challenge',via);
 if(short&&html)for(const [re,via,kind] of CHALLENGE_HTML)if(re.test(html))return make(kind,via);
 if(tiny&&html&&CAPTCHA_WIDGET.test(html)&&!/type=["']password["']/i.test(html))return make('captcha',(html.match(/hcaptcha|recaptcha|turnstile|challenges\.cloudflare/i)?.[0]||'CAPTCHA')+' widget');
 if(tiny&&CHALLENGE_TEXT.test(t))return make('captcha','human-verification prompt');
 if(tiny&&(DENIED_TEXT.test(t)||/^(access denied|403 forbidden|forbidden)$/.test(title)))return make('denied',title||'access denied');
 if(short&&(LOGIN_URL.test(page.url?(()=>{try{return new URL(page.url!).pathname+new URL(page.url!).search;}catch{return page.url!;}})():'')||LOGIN_TEXT.test(t)))return make('login','login wall');
 if(tiny&&html&&/<input[^>]+type=["']password["']/i.test(html))return make('login','password form');
 return null;
}
export function blockedReason(text:string,title='',url='',html=''):string|null{return detectChallenge({text,title,url,html})?.reason||null;}
// The structured answer a tool gives for a blocked address: why, and where the same page can
// still be read (Wayback Machine snapshot, Common Crawl index lookup).
export function blockedHint(url:string,c:Challenge|string){
 const challenge=typeof c==='string'?{kind:'challenge',via:'',reason:c}:c;
 let pattern=url;try{const u=new URL(url);pattern=u.host+u.pathname.replace(/\/[^/]*$/,'/')+'*';}catch{}
 return {blocked:true as const,kind:challenge.kind,reason:challenge.reason,fallbacks:[
  {source:'wayback',url:'https://web.archive.org/web/'+url,tool:'call_public_source',sourceId:'archive',name:'wayback_fetch',arguments:{url},note:'Latest Wayback Machine snapshot of the same address; cite it with its snapshot date.'},
  {source:'commoncrawl',tool:'call_public_source',sourceId:'archive',name:'commoncrawl_index',arguments:{url:pattern},note:'Lists captures of this site section in the latest Common Crawl; then commoncrawl_fetch {filename, offset, length} of a row reads one record.'},
 ]};
}
