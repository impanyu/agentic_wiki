// Pure HTML table extraction (no DOM, no imports): a tolerant tokenizer builds a light element
// tree, then every <table> becomes rows with rowspan/colspan expanded, multi-row headers joined,
// footnote markers ("[1]", "[a]", "[note 3]") removed, image alt text kept (flags), hidden sort
// keys dropped, and a numeric value parsed for cells that are clearly numbers.
export type Row=Record<string,unknown>;
export type HtmlNode={tag:string;attrs:Record<string,string>;children:(HtmlNode|string)[];parent?:HtmlNode};
export type ExtractedTable={index:number;caption:string;headers:string[];rows:Row[];classes:string;section:string};

const VOID=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
const RAW=new Set(['script','style','noscript','template','svg','math','textarea','iframe','object']);
const ENT:Record<string,string>={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',ndash:'–',mdash:'—',minus:'−',times:'×',deg:'°',hellip:'…',lsquo:'‘',rsquo:'’',ldquo:'“',rdquo:'”',middot:'·',bull:'•',thinsp:' ',ensp:' ',emsp:' ',euro:'€',pound:'£',yen:'¥',cent:'¢',sup2:'²',sup3:'³',frac12:'½',plusmn:'±',laquo:'«',raquo:'»',shy:'',zwj:'',zwnj:'',lrm:'',rlm:''};
export function decodeHtml(s:string){
 return s.replace(/&(#x[\da-f]+|#\d+|[a-z][a-z\d]*);?/gi,(m,e:string)=>{
  if(e[0]==='#'){const n=e[1].toLowerCase()==='x'?parseInt(e.slice(2),16):parseInt(e.slice(1),10);return n>0&&n<=0x10ffff?String.fromCodePoint(n):' ';}
  const v=ENT[e.toLowerCase()];return v===undefined?m:v;
 });
}
// Elements whose start tag closes an open element of the listed kinds (up to the nearest boundary).
const CLOSES:Record<string,{close:string[];stop:string[]}>={
 td:{close:['td','th'],stop:['tr','table']},th:{close:['td','th'],stop:['tr','table']},
 tr:{close:['tr','td','th'],stop:['table','thead','tbody','tfoot']},
 thead:{close:['tr','td','th','thead','tbody','tfoot','caption'],stop:['table']},tbody:{close:['tr','td','th','thead','tbody','tfoot','caption'],stop:['table']},tfoot:{close:['tr','td','th','thead','tbody','tfoot','caption'],stop:['table']},
 li:{close:['li'],stop:['ul','ol','table']},p:{close:['p'],stop:['div','td','th','table','li','section','article','body']},
 option:{close:['option'],stop:['select']},dt:{close:['dt','dd'],stop:['dl']},dd:{close:['dt','dd'],stop:['dl']},
};
export function parseHtml(html:string):HtmlNode{
 const root:HtmlNode={tag:'#root',attrs:{},children:[]};const stack:HtmlNode[]=[root];
 const re=/<!--[\s\S]*?-->|<![^>]*>|<\?[^>]*>|<\/\s*([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+|<)/g;
 let m:RegExpExecArray|null;
 while((m=re.exec(html))){
  const top=stack[stack.length-1];
  if(m[1]){const tag=m[1].toLowerCase();for(let k=stack.length-1;k>0;k--){if(stack[k].tag===tag){stack.length=k;break;}if(tag!=='table'&&stack[k].tag==='table')break;}continue;}
  if(m[2]){
   const tag=m[2].toLowerCase(),attrs:Record<string,string>={};
   for(const a of (m[3]||'').matchAll(/([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g))attrs[a[1].toLowerCase()]=decodeHtml(a[2]??a[3]??a[4]??'');
   if(RAW.has(tag)){const end=html.toLowerCase().indexOf('</'+tag,re.lastIndex);const close=end<0?html.length:html.indexOf('>',end)+1||html.length;
    if(tag==='svg'||tag==='math'){const node:HtmlNode={tag,attrs,children:[],parent:top};top.children.push(node);}
    re.lastIndex=close;continue;}
   const rule=CLOSES[tag];
   if(rule){for(let k=stack.length-1;k>0;k--){const t=stack[k].tag;if(rule.stop.includes(t))break;if(rule.close.includes(t)){stack.length=k;break;}}}
   const parent=stack[stack.length-1],node:HtmlNode={tag,attrs,children:[],parent};parent.children.push(node);
   if(!VOID.has(tag)&&!m[4])stack.push(node);
   continue;
  }
  if(m[5])top.children.push(m[5]);
 }
 return root;
}
export function findAll(node:HtmlNode,pred:(n:HtmlNode)=>boolean,out:HtmlNode[]=[],into=true):HtmlNode[]{
 for(const c of node.children)if(typeof c!=='string'){if(pred(c)){out.push(c);if(!into)continue;}findAll(c,pred,out,into);}
 return out;
}
const cls=(n:HtmlNode)=>' '+(n.attrs.class||'').toLowerCase()+' ';
const hidden=(n:HtmlNode)=>/display\s*:\s*none|visibility\s*:\s*hidden/i.test(n.attrs.style||'')||'hidden' in n.attrs||n.attrs['aria-hidden']==='true'&&n.tag!=='span'&&n.tag!=='img';
const SKIP_CLASS=/ (reference|sortkey|noprint|mw-editsection|mw-ref|sr-only|visually-hidden|navbar|plainlinks-print) /;
// Footnote markers and citation tags that Wikipedia renders inline.
export const FOOTNOTE=/\[(?:\d{1,3}|[a-z]{1,2}|[ivx]{1,4}|(?:note|nb|n|lower-alpha|upper-alpha) ?\d{1,3}|citation needed|clarification needed|update|when\?|who\?|dubious[^\]]*|according to whom\?|better source needed|failed verification|†|‡|\*{1,3})\]/gi;
export function nodeText(n:HtmlNode):string{
 const parts:string[]=[],alts:string[]=[];
 const walk=(x:HtmlNode)=>{
  for(const c of x.children){
   if(typeof c==='string'){parts.push(decodeHtml(c));continue;}
   if(c.tag==='sup'&&/ reference /.test(cls(c)))continue;
   if(SKIP_CLASS.test(cls(c))||hidden(c)||c.tag==='style'||c.tag==='table')continue;
   if(c.tag==='br'||c.tag==='p'||c.tag==='div'||c.tag==='li'){parts.push(' ');walk(c);parts.push(' ');continue;}
   if(c.tag==='img'){const alt=(c.attrs.alt||'').trim();if(alt&&!/^(edit|icon)$/i.test(alt))alts.push(alt);continue;}
   walk(c);
  }
 };
 walk(n);
 // Image alt text (a flag, a logo) stands in only when the cell has no text of its own;
 // otherwise it would repeat the name or add icon words ("Increase").
 const tidy=(s:string)=>s.replace(FOOTNOTE,'').replace(/[\s\u00a0\u200b\u2009]+/g,' ').trim();
 if(!tidy(parts.join(''))&&alts.length)parts.push(alts.join(' '));
 return parts.join('').replace(FOOTNOTE,'').replace(/[\s ​ ]+/g,' ').replace(/\s+([,.;:)])/g,'$1').trim();
}
const firstLink=(n:HtmlNode)=>findAll(n,c=>c.tag==='a'&&!!c.attrs.href&&!/ (reference|image|mw-file-description) /.test(cls(c))&&!/^#/.test(c.attrs.href)&&!(c.parent?.tag==='sup'))[0]?.attrs.href;

// "1,234", "17,098,246 (6,601,670)", "−3.4", "12.5%", "$1.2", "~400" → the leading number.
const LEAD=/^(?:[~≈<>≤≥]|ca\.|c\.|approx\.)?\s*([-+−–]?)\s*(?:[$€£¥₹]|US\$|A\$|C\$)?\s*((?:\d{1,3}(?:[,    ]\d{3})+|\d+)(?:\.\d+)?)/i;
export function parseNumber(text:string):{value:number;pure:boolean}|null{
 const t=text.replace(FOOTNOTE,'').trim();if(!t)return null;
 const m=t.match(LEAD);if(!m)return null;
 const digits=m[2].replace(/[,    ]/g,'');
 // A year range or a date ("1990–2000", "12 May 2020") is not one number.
 const rest=t.slice(m[0].length).trim();
 if(/^[-–\/.:]\s*\d/.test(rest))return null;
 const value=Number(digits)*(m[1]&&m[1]!=='+'?-1:1);if(!Number.isFinite(value))return null;
 const pure=/^%?$/.test(rest)&&!/^[~≈<>≤≥]|^c/i.test(t);
 return {value,pure};
}

// The direct rows of a table (through thead/tbody/tfoot, never into nested tables).
function tableRows(table:HtmlNode){
 const rows:{node:HtmlNode;inHead:boolean}[]=[];
 const walk=(n:HtmlNode,inHead:boolean)=>{for(const c of n.children){if(typeof c==='string')continue;if(c.tag==='tr')rows.push({node:c,inHead});else if(c.tag==='thead'||c.tag==='tbody'||c.tag==='tfoot')walk(c,c.tag==='thead');}};
 walk(table,false);return rows;
}
type Cell={text:string;header:boolean;href?:string;origin:boolean};
export function tableGrid(table:HtmlNode){
 const grid:Cell[][]=[];const heads:boolean[]=[];
 tableRows(table).forEach(({node,inHead},r)=>{
  grid[r]=grid[r]||[];heads[r]=inHead;let col=0;
  for(const c of node.children){
   if(typeof c==='string'||(c.tag!=='td'&&c.tag!=='th'))continue;
   while(grid[r][col])col++;
   const rs=Math.min(Math.max(parseInt(c.attrs.rowspan)||1,1),500),cs=Math.min(Math.max(parseInt(c.attrs.colspan)||1,1),100);
   const cell={text:nodeText(c),header:c.tag==='th'&&!(c.attrs.scope==='row'),href:firstLink(c)};
   for(let i=0;i<rs;i++)for(let j=0;j<cs;j++){grid[r+i]=grid[r+i]||[];grid[r+i][col+j]={...cell,origin:i===0&&j===0};}
   col+=cs;
  }
 });
 // Rows without cells (MediaWiki's empty <tr class="mw-empty-elt">) are dropped.
 const keep=grid.map((r,i)=>r&&r.some(Boolean)?i:-1).filter(i=>i>=0);
 return {grid:keep.map(i=>grid[i]),heads:keep.map(i=>heads[i])};
}
const LAYOUT=/ (navbox|vertical-navbox|navbox-inner|ambox|mbox-small|tmbox|ombox|cmbox|fmbox|metadata|sistersitebox|sidebar|toc|mw-hidden-catlinks|plainlinks|nowraplinks) /;
export function extractTables(html:string,options:{baseUrl?:string;keepLayout?:boolean}={}):ExtractedTable[]{
 const root=parseHtml(html),tables=findAll(root,n=>n.tag==='table');
 const out:ExtractedTable[]=[];
 for(const table of tables){
  if(!options.keepLayout&&(LAYOUT.test(cls(table))||table.attrs.role==='presentation'||hidden(table)))continue;
  const {grid,heads}=tableGrid(table);if(!grid.length)continue;
  const width=Math.max(...grid.map(r=>r.length));if(width<2)continue;
  // Header rows: leading rows in <thead> or made only of <th> cells.
  let h=0;while(h<grid.length&&h<4&&(heads[h]||grid[h].length>0&&grid[h].every(c=>c?.header)))h++;
  if(h===grid.length&&h>1)h=1;
  // No <th> header: a first row of short labels above numeric data is the header.
  if(h===0&&grid.length>2&&grid[0].length===width&&grid[0].every(c=>c&&c.text&&c.text.length<80&&!parseNumber(c.text))&&grid[1].some(c=>c&&parseNumber(c.text)?.pure))h=1;
  const headerRows=grid.slice(0,h);
  let headers=Array.from({length:width},(_,j)=>{const parts:string[]=[];for(const r of headerRows){const t=r[j]?.text||'';if(t&&parts[parts.length-1]!==t)parts.push(t);}return parts.join(' - ')||'col'+(j+1);});
  headers=uniq(headers);
  const body=grid.slice(h);let section='';const rows:Row[]=[];let hasSection=false;
  for(const r of body){
   if(!r.length||r.every(c=>!c||!c.text))continue;
   const texts=r.map(c=>c?.text||'');
   // A row whose cells all repeat one value (a full-width group label) names the rows below it.
   if(width>2&&r.length>=width&&new Set(texts).size===1&&r.filter(c=>c?.origin).length===1){section=texts[0];hasSection=true;continue;}
   // A repeated header row inside the body.
   if(r.every(c=>c?.header)&&texts.join('|')===headerRows[headerRows.length-1]?.map(c=>c?.text||'').join('|'))continue;
   const row:Row={};
   headers.forEach((name,j)=>{row[name]=texts[j]??'';});
   if(hasSection)row._group=section;
   rows.push(row);
   (row as {__cells?:Cell[]}).__cells=r;
  }
  if(hasSection)for(const r of rows)if(!('_group' in r))r._group='';
  // Unnamed columns that hold nothing (footnote-only "Notes" columns) are dropped.
  for(const [j,name] of [...headers.entries()].reverse())if(name==='col'+(j+1)&&rows.every(r=>r[name]==='')){headers.splice(j,1);for(const r of rows){delete r[name];const cells=(r as {__cells?:Cell[]}).__cells;cells?.splice(j,1);}}
  finishColumns(headers,rows,options.baseUrl);
  const caption=table.children.find((c):c is HtmlNode=>typeof c!=='string'&&c.tag==='caption');
  out.push({index:out.length,caption:caption?nodeText(caption):'',headers:Object.keys(rows[0]||Object.fromEntries(headers.map(x=>[x,'']))),rows,classes:(table.attrs.class||'').trim(),section:sectionOf(table)});
 }
 return out;
}
function uniq(names:string[]){const seen=new Map<string,number>();return names.map(n=>{const k=seen.get(n)||0;seen.set(n,k+1);return k?n+' ('+(k+1)+')':n;});}
// Per column: pure numbers become numbers; columns of numbers-with-units keep their text and get a
// "<column> (number)" companion; the first column of entity links gets a "<column> (url)" companion.
function finishColumns(headers:string[],rows:Row[],baseUrl?:string){
 let linkDone=false;
 headers.forEach((name,j)=>{
  const cells=rows.map(r=>(r as {__cells?:Cell[]}).__cells?.[j]);
  const values=rows.map(r=>String(r[name]??''));const filled=values.filter(v=>v&&!/^[—–\-?]$|^n\/?a$/i.test(v));
  const parsed=values.map(v=>v?parseNumber(v):null);
  const numeric=filled.length>0&&parsed.filter(p=>p).length>=Math.max(1,filled.length*0.6);
  if(numeric&&parsed.every((p,i)=>!filled.includes(values[i])||p?.pure)){rows.forEach((r,i)=>{if(parsed[i])r[name]=parsed[i]!.value;});}
  else if(numeric){const key=name+' (number)';rows.forEach((r,i)=>{r[key]=parsed[i]?parsed[i]!.value:null;});}
  if(!linkDone&&!numeric&&baseUrl){
   const links=cells.map(c=>c?.href);if(links.filter(Boolean).length>=Math.max(2,rows.length*0.5)){linkDone=true;const key=name+' (url)';rows.forEach((r,i)=>{let u='';try{u=links[i]?new URL(links[i]!,baseUrl).href:'';}catch{}r[key]=u;});}
  }
 });
 for(const r of rows)delete (r as {__cells?:Cell[]}).__cells;
 // Keep companions next to their column.
 if(rows.length){const order=Object.keys(rows[0]).sort((a,b)=>rank(a)-rank(b));for(let i=0;i<rows.length;i++){const r=rows[i],o:Row={};for(const k of order)o[k]=r[k];rows[i]=o;}}
 function rank(k:string){const base=k.replace(/ \((number|url)\)$/,'');const i=headers.indexOf(base);return (i<0?headers.length:i)*3+(k.endsWith(' (number)')?1:k.endsWith(' (url)')?2:0);}
}
// The nearest heading before the table (Wikipedia section), for the agent to tell tables apart.
function sectionOf(table:HtmlNode):string{
 let n:HtmlNode|undefined=table;
 while(n?.parent){
  const siblings=n.parent.children;for(let i=siblings.indexOf(n)-1;i>=0;i--){const s=siblings[i];if(typeof s==='string')continue;
   if(/^h[1-6]$/.test(s.tag))return nodeText(s).slice(0,120);
   const inner=findAll(s,x=>/^h[1-6]$/.test(x.tag));if(inner.length)return nodeText(inner[inner.length-1]).slice(0,120);}
  n=n.parent;
 }
 return '';
}
export function htmlTitle(html:string){return decodeHtml((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'').replace(/\s+/g,' ').trim()).slice(0,300);}
