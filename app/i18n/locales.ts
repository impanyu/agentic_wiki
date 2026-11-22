// The site's languages. English lives at the bare address (/rankings/x); every other language under its code
// (/fr/rankings/x), like a language edition. proxy.ts rewrites /<code>/… to the page and passes the code in
// the x-rw-locale header; pages read it with requestLocale() (app/i18n/request.ts).
export const LOCALES=[
 {code:'en',name:'English'},{code:'zh',name:'中文'},{code:'es',name:'Español'},{code:'fr',name:'Français'},
 {code:'de',name:'Deutsch'},{code:'ja',name:'日本語'},{code:'ko',name:'한국어'},{code:'ru',name:'Русский'},
 {code:'pt',name:'Português'},{code:'ar',name:'العربية',dir:'rtl'},{code:'hi',name:'हिन्दी'},{code:'it',name:'Italiano'},
 {code:'id',name:'Bahasa Indonesia'},{code:'tr',name:'Türkçe'},{code:'vi',name:'Tiếng Việt'},{code:'pl',name:'Polski'},
] as const;
export type Locale=typeof LOCALES[number]['code'];
export const DEFAULT_LOCALE:Locale='en';
const CODES=new Set<string>(LOCALES.map(l=>l.code));
export const isLocale=(s:unknown):s is Locale=>typeof s==='string'&&CODES.has(s);
export const dirOf=(l:string):'rtl'|'ltr'=>LOCALES.find(x=>x.code===l&&'dir' in x)?'rtl':'ltr';

// The locale a path names, and the path without it ("/fr/rankings/x" → fr, "/rankings/x").
export function splitLocale(path:string):{locale:Locale;path:string}{
 const m=/^\/([a-z]{2})(?=\/|$|\?)/.exec(path);
 if(m&&isLocale(m[1])&&m[1]!==DEFAULT_LOCALE)return {locale:m[1],path:path.slice(3)||'/'};
 return {locale:DEFAULT_LOCALE,path};
}
// A site path in a locale ("/rankings/x", fr → "/fr/rankings/x"; "/" → "/fr"; "/?ask=q" → "/fr?ask=q").
export function localePath(path:string,locale:string):string{
 if(!isLocale(locale)||locale===DEFAULT_LOCALE||!path.startsWith('/')||path.startsWith('//'))return path;
 if(splitLocale(path).locale!==DEFAULT_LOCALE)return path;
 return '/'+locale+(path==='/'?'':path.startsWith('/?')?path.slice(1):path);
}
// Page addresses inside data handed to pages (topics, rankings and entities in the address tree, the home page
// and its questions) are moved into the locale; files (a last segment with an extension), data downloads,
// APIs and static assets keep their one address.
const PAGE_LINK=/^\/(?!\/|api\/|data\/|sitemaps?\b|geo\/|_next\/|favicon|robots)(?:[^?#]*\/)?[^./?#]*(?:[?#].*)?$/;
export function localizeLinks<T>(value:T,locale:string):T{
 if(!isLocale(locale)||locale===DEFAULT_LOCALE)return value;
 const walk=(v:unknown):unknown=>{
  if(typeof v==='string')return PAGE_LINK.test(v)?localePath(v,locale):v;
  if(Array.isArray(v))return v.map(walk);
  if(v&&typeof v==='object'&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null)){
   const o:Record<string,unknown>={};for(const [k,x] of Object.entries(v))o[k]=walk(x);return o;
  }
  return v;
 };
 return walk(value) as T;
}
// hreflang alternates for a page's English path.
export function languageAlternates(path:string):Record<string,string>{
 return Object.fromEntries([...LOCALES.map(l=>[l.code,localePath(path,l.code)]),['x-default',path]]);
}
