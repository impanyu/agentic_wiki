// Pure helpers for the rich viz components (no imports, so tests can load this file directly).

/** Accepts https: URLs or same-site paths ("/x", not "//host" or "/\host"); anything else is null. */
export function safeImageUrl(u:unknown):string|null{
 if(typeof u!=='string')return null;const s=u.trim();if(!s)return null;
 if(s.startsWith('/'))return /^\/[\/\\]/.test(s)?null:s;
 try{return new URL(s).protocol==='https:'?s:null;}catch{return null;}
}

/** A number clamped to 0..100; non-numeric input gives the fallback. */
export function clampPercent(n:unknown,fallback:number):number{
 const v=typeof n==='string'&&n.trim()?Number(n):n;
 if(typeof v!=='number'||!Number.isFinite(v))return fallback;
 return Math.min(100,Math.max(0,v));
}

/** A positive finite number, or the fallback. */
export function positiveNumber(n:unknown,fallback:number):number{
 const v=typeof n==='string'&&n.trim()?Number(n):n;
 return typeof v==='number'&&Number.isFinite(v)&&v>0?v:fallback;
}

/** Index wrapped into 0..len-1 (so "previous" from the first slide is the last). */
export function wrapIndex(i:number,len:number):number{return len>0?((i%len)+len)%len:0;}

export type Slide={src:string;caption?:string;credit?:string};
/** Carousel items: strings or {src,caption?,credit?}; a lone object counts as one item; unsafe URLs are dropped. */
export function normalizeSlides(items:unknown):Slide[]{
 const list=Array.isArray(items)?items:items&&typeof items==='object'?[items]:[];
 const out:Slide[]=[];
 for(const it of list){
  const o=(typeof it==='string'?{src:it}:it) as Record<string,unknown>|null;
  const src=o&&typeof o==='object'?safeImageUrl(o.src??o.url):null;if(!src)continue;
  const s:Slide={src};
  if(typeof o!.caption==='string'&&o!.caption.trim())s.caption=o!.caption;
  if(typeof o!.credit==='string'&&o!.credit.trim())s.credit=o!.credit;
  out.push(s);
 }
 return out;
}

/** Line numbers to emphasize, from an array of numbers/strings; ranges like "3-5" are expanded. */
export function lineSet(v:unknown):Set<number>{
 const out=new Set<number>();
 for(const x of Array.isArray(v)?v:v==null?[]:[v]){
  const m=String(x).match(/^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/);if(!m)continue;
  const a=+m[1],b=m[2]?Math.min(+m[2],a+10000):a;for(let i=a;i<=b;i++)out.add(i);
 }
 return out;
}

/**
 * Splits highlighter HTML into one fragment per line. Spans that cross a newline are
 * closed at the end of the line and reopened on the next, so each line is well-formed.
 */
export function splitHighlightedLines(html:string):string[]{
 const lines:string[]=[];const open:string[]=[];let cur='';
 for(const tok of html.match(/<span[^>]*>|<\/span>|\n|[^<\n]+|</g)||[]){
  if(tok==='\n'){lines.push(cur+'</span>'.repeat(open.length));cur=open.join('');}
  else{if(tok.startsWith('<span'))open.push(tok);else if(tok==='</span>')open.pop();cur+=tok;}
 }
 lines.push(cur);
 return lines;
}
