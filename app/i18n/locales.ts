// The site's languages: every language with more than ten million speakers, and the larger Wikipedia editions.
// English lives at the bare address (/rankings/x); every other language under its code (/fr/…, /zh-hant/…),
// like a language edition. proxy.ts tags /<code>/… requests with x-rw-locale and next.config.ts rewrites
// them internally; pages read the code with requestLocale() (app/i18n/request.ts).
export const LOCALES=[
 {code:'en',name:'English'},{code:'zh',name:'中文（简体）',hreflang:'zh-Hans'},{code:'zh-hant',name:'中文（繁體）',hreflang:'zh-Hant'},{code:'yue',name:'粵語'},
 {code:'es',name:'Español'},{code:'hi',name:'हिन्दी'},{code:'ar',name:'العربية',dir:'rtl'},{code:'bn',name:'বাংলা'},
 {code:'pt',name:'Português'},{code:'ru',name:'Русский'},{code:'ja',name:'日本語'},{code:'pa',name:'ਪੰਜਾਬੀ'},
 {code:'de',name:'Deutsch'},{code:'jv',name:'Basa Jawa'},{code:'ko',name:'한국어'},{code:'fr',name:'Français'},
 {code:'te',name:'తెలుగు'},{code:'mr',name:'मराठी'},{code:'tr',name:'Türkçe'},{code:'ta',name:'தமிழ்'},
 {code:'vi',name:'Tiếng Việt'},{code:'ur',name:'اردو',dir:'rtl'},{code:'it',name:'Italiano'},{code:'th',name:'ไทย'},
 {code:'gu',name:'ગુજરાતી'},{code:'fa',name:'فارسی',dir:'rtl'},{code:'pl',name:'Polski'},{code:'uk',name:'Українська'},
 {code:'kn',name:'ಕನ್ನಡ'},{code:'ml',name:'മലയാളം'},{code:'or',name:'ଓଡ଼ିଆ'},{code:'my',name:'မြန်မာ'},
 {code:'ha',name:'Hausa'},{code:'yo',name:'Yorùbá'},{code:'ig',name:'Igbo'},{code:'am',name:'አማርኛ'},
 {code:'om',name:'Afaan Oromoo'},{code:'sw',name:'Kiswahili'},{code:'id',name:'Bahasa Indonesia'},{code:'ms',name:'Bahasa Melayu'},
 {code:'fil',name:'Filipino'},{code:'ceb',name:'Cebuano'},{code:'nl',name:'Nederlands'},{code:'ro',name:'Română'},
 {code:'el',name:'Ελληνικά'},{code:'cs',name:'Čeština'},{code:'hu',name:'Magyar'},{code:'sv',name:'Svenska'},
 {code:'he',name:'עברית',dir:'rtl'},{code:'az',name:'Azərbaycanca'},{code:'kk',name:'Қазақша'},{code:'uz',name:'Oʻzbekcha'},
 {code:'ne',name:'नेपाली'},{code:'si',name:'සිංහල'},{code:'km',name:'ខ្មែរ'},{code:'zu',name:'isiZulu'},
 {code:'xh',name:'isiXhosa'},{code:'af',name:'Afrikaans'},{code:'so',name:'Soomaali'},{code:'ps',name:'پښتو',dir:'rtl'},
 {code:'sd',name:'سنڌي',dir:'rtl'},{code:'as',name:'অসমীয়া'},{code:'mai',name:'मैथिली'},{code:'mg',name:'Malagasy'},
 {code:'rw',name:'Kinyarwanda'},{code:'ht',name:'Kreyòl ayisyen'},{code:'sn',name:'chiShona'},{code:'ny',name:'Chichewa'},
 {code:'ku',name:'Kurdî'},{code:'sr',name:'Српски'},{code:'bg',name:'Български'},{code:'hr',name:'Hrvatski'},
 {code:'sk',name:'Slovenčina'},{code:'da',name:'Dansk'},{code:'fi',name:'Suomi'},{code:'no',name:'Norsk'},
 {code:'ca',name:'Català'},{code:'lt',name:'Lietuvių'},{code:'ka',name:'ქართული'},{code:'hy',name:'Հայերեն'},
 {code:'lo',name:'ລາວ'},{code:'tg',name:'Тоҷикӣ'},{code:'ky',name:'Кыргызча'},{code:'mn',name:'Монгол'},
] as const satisfies readonly {code:string;name:string;dir?:'rtl';hreflang?:string}[];
export type Locale=typeof LOCALES[number]['code'];
export const DEFAULT_LOCALE:Locale='en';
const CODES=new Set<string>(LOCALES.map(l=>l.code));
export const isLocale=(s:unknown):s is Locale=>typeof s==='string'&&CODES.has(s);
const RTL=new Set<string>(LOCALES.filter(l=>'dir' in l).map(l=>l.code));
export const dirOf=(l:string):'rtl'|'ltr'=>RTL.has(l)?'rtl':'ltr';
// The BCP 47 tag for <html lang> and hreflang (zh → zh-Hans, zh-hant → zh-Hant).
export const langTag=(l:string):string=>(LOCALES.find(x=>x.code===l) as {hreflang?:string}|undefined)?.hreflang??l;
// A path's first segment as a locale code (2–3 letters, optionally a script or region: zh-hant).
const PREFIX=/^\/([a-z]{2,3}(?:-[a-z]{2,4})?)(?=\/|$|\?)/;

// The locale a path names, and the path without it ("/fr/rankings/x" → fr, "/rankings/x").
export function splitLocale(path:string):{locale:Locale;path:string}{
 const m=PREFIX.exec(path);
 if(m&&isLocale(m[1])&&m[1]!==DEFAULT_LOCALE)return {locale:m[1],path:path.slice(m[0].length)||'/'};
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
 return Object.fromEntries([...LOCALES.map(l=>[langTag(l.code),localePath(path,l.code)]),['x-default',path]]);
}
