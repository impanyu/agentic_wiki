import {createHash} from 'node:crypto';
import type {Queryable} from '@/app/entity-db/client';
import {DEFAULT_LOCALE,LOCALES} from './locales';
// Content translation (the pages' own words, not the interface): titles, labels, sentences and short attribute values
// of a page model are looked up per language; a text never seen in that language is queued and the page shows it in
// English meanwhile; the heartbeat translates the queue in batches (translatePending). Proper names, numbers,
// units and links are kept. A page in another language is indexed only when nothing on it is still waiting.
const KEYS=new Set(['title','name','label','lead','text','description','detail','subtitle','about','caption','note','kicker','summary','heading','paragraphs','baseTitle','question','unitLabel']);
const SKIP=new Set(['rows','href','slug','key','id','image','url','code','format','unit','currency','period','year','entity_id','type','column','props_rows']);
const hashOf=(s:string)=>createHash('sha1').update(s).digest('hex').slice(0,20);
const translatable=(s:string)=>s.length>=2&&s.length<=1200&&/\p{L}{2}/u.test(s)&&!/^(https?:|\/|#|data:)/.test(s)&&!/^[\p{Lu}\d_-]{2,12}$/u.test(s);
// Every translatable text in a value (by key), in order.
function collect(v:unknown,out:Set<string>,key=''){
 if(typeof v==='string'){if(KEYS.has(key)&&translatable(v.trim()))out.add(v.trim());return;}
 if(Array.isArray(v)){for(const x of v)collect(x,out,key==='paragraphs'?'paragraphs':key);return;}
 if(v&&typeof v==='object')for(const [k,x] of Object.entries(v)){if(SKIP.has(k))continue;collect(x,out,k==='parts'||k==='leadParts'||k==='paragraphParts'?'text':k);}
}
function apply(v:unknown,map:Map<string,string>,key=''):unknown{
 if(typeof v==='string'){if(!KEYS.has(key))return v;const t=map.get(v.trim());return t??v;}
 if(Array.isArray(v))return v.map(x=>apply(x,map,key==='paragraphs'?'paragraphs':key));
 if(v&&typeof v==='object'){const o:Record<string,unknown>={};for(const [k,x] of Object.entries(v)){o[k]=SKIP.has(k)?x:apply(x,map,k==='parts'||k==='leadParts'||k==='paragraphParts'?'text':k);}return o;}
 return v;
}
// Texts being translated right now (lang:hash), so concurrent requests and the background queue do not translate
// the same text twice at once.
const inflight=new Set<string>();
async function save(db:Queryable,lang:string,pairs:[string,string][],out:Record<string,string>,map?:Map<string,string>){
 const hs:string[]=[],ts:string[]=[];
 for(const [h,src] of pairs){const t=out[src];if(typeof t==='string'&&t.trim()){hs.push(h);ts.push(t.trim().slice(0,4000));map?.set(src,t.trim());}}
 if(hs.length)await db.query(`update translations x set text=v.t, status='done', updated_at=now() from unnest($2::text[],$3::text[]) as v(h,t) where x.lang=$1::text and x.hash=v.h`,[lang,hs,ts]);
 const failed=pairs.filter(([,src])=>!(typeof out[src]==='string'&&out[src].trim())).map(([h])=>h);
 if(failed.length)await db.query('update translations set attempts=attempts+1, updated_at=now() where lang=$1::text and hash = any($2::text[])',[lang,failed]);
}
// Translates chunks of [hash, source] in parallel (each chunk saved when it returns, even after the caller stopped
// waiting); resolves when all are done.
function translateChunks(db:Queryable,lang:string,pairs:[string,string][],size:number,map?:Map<string,string>):Promise<unknown>[]{
 const name=LOCALES.find(l=>l.code===lang)?.name||lang;
 const todo=pairs.filter(([h])=>!inflight.has(lang+':'+h));
 const out:Promise<unknown>[]=[];
 for(let i=0;i<todo.length;i+=size){
  const chunk=todo.slice(i,i+size);for(const [h] of chunk)inflight.add(lang+':'+h);
  out.push(translateBatch(chunk.map(c=>c[1]),lang,name)
   .then(r=>save(db,lang,chunk,r,map),async e=>{await save(db,lang,chunk,{});console.warn('[translate]',lang,(e as Error).message.slice(0,160));})
   .catch(()=>{}).finally(()=>{for(const [h] of chunk)inflight.delete(lang+':'+h);}));
 }
 return out;
}
// Translates a page model into a language: what is translated already is put in; everything else on the page is
// translated right away in parallel batches (the first reader waits up to CONTENT_SYNC_MS, the batches finish and are
// stored even if they take longer), and anything still missing goes first in the background queue.
// Returns the model and whether anything is still waiting (the page is then kept out of search indexes).
export async function localizeContent<T>(db:Queryable,model:T,locale:string):Promise<{model:T;complete:boolean}>{
 if(!locale||locale===DEFAULT_LOCALE||!LOCALES.some(l=>l.code===locale))return {model,complete:true};
 const texts=new Set<string>();collect(model,texts);
 if(!texts.size)return {model,complete:true};
 const list=[...texts].slice(0,800),hashes=list.map(hashOf);
 const map=new Map<string,string>();
 try{
  const r=await db.query<{hash:string;text:string|null;status:string;attempts:number}>('select hash, text, status, attempts from translations where lang=$1::text and hash = any($2::text[])',[locale,hashes]);
  const got=new Map(r.rows.map(x=>[x.hash,x]));const missing:[string,string][]=[];
  list.forEach((s,i)=>{const g=got.get(hashes[i]);if(g?.status==='done'&&g.text)map.set(s,g.text);else if(!g||Number(g.attempts)<3)missing.push([hashes[i],s]);});
  if(missing.length){
   // Queued with reader priority (texts pre-queued for this language move up too).
   await db.query(`insert into translations(lang,hash,source,priority) select $1::text, x.h, x.s, 1 from unnest($2::text[],$3::text[]) as x(h,s)
    on conflict (lang, hash) do update set priority = 1 where translations.status = 'pending' and translations.priority < 1`,[locale,missing.map(m=>m[0]),missing.map(m=>m[1])]);
   const limit=Number(process.env.CONTENT_SYNC_LIMIT||400),ms=Number(process.env.CONTENT_SYNC_MS||6000);
   if(limit>0){
    const jobs=translateChunks(db,locale,missing.slice(0,limit),25,map);
    await Promise.race([Promise.all(jobs),new Promise(r=>setTimeout(r,ms))]);
   }
  }
 }catch{return {model,complete:false};}
 return {model:apply(model,new Map(map)) as T,complete:map.size>=list.length};
}
// Background: the waiting texts, readers' first, then pre-translation; CONTENT_TRANSLATE_CONCURRENCY batches at
// once, for up to budgetMs (the heartbeat calls it once a minute).
let busy=false;
export async function translatePending(db:Queryable,{concurrency=8,size=40,budgetMs=50_000}:{concurrency?:number;size?:number;budgetMs?:number}={}):Promise<number>{
 if(busy)return 0;busy=true;let done=0;const until=Date.now()+budgetMs;
 try{
  while(Date.now()<until){
   const rows=(await db.query<{lang:string;hash:string;source:string}>(`select lang, hash, source from translations where status='pending' and attempts<3 order by priority desc, created_at limit $1::int`,[concurrency*size*2])).rows
    .filter(r=>!inflight.has(r.lang+':'+r.hash));
   if(!rows.length)break;
   const byLang=new Map<string,[string,string][]>();for(const r of rows){const l=byLang.get(r.lang)??[];l.push([r.hash,r.source]);byLang.set(r.lang,l);}
   const jobs:Promise<unknown>[]=[];
   for(const [lang,pairs] of byLang){if(jobs.length>=concurrency)break;jobs.push(...translateChunks(db,lang,pairs.slice(0,size*(concurrency-jobs.length)),size).slice(0,concurrency-jobs.length));}
   await Promise.all(jobs);done+=Math.min(rows.length,jobs.length*size);
  }
 }finally{busy=false;}
 return done;
}
async function translateBatch(texts:string[],lang:string,name:string):Promise<Record<string,string>>{
 const {respond}=await import('@/app/llm');
 const schema={type:'object',additionalProperties:false,required:['items'],properties:{items:{type:'array',items:{type:'object',additionalProperties:false,required:['source','text'],properties:{source:{type:'string'},text:{type:'string'}}}}}};
 const r=await respond({class:'fast',store:false,instructions:`You translate the text of RankWiki, a public ranking and encyclopedia site, from English into ${name} (${lang}). Translate each item fully and naturally, as a well-edited reference site in that language would. Keep: brand, product, company and person names as they are (use the established ${name} name of a famous person or work if one exists); place names in their established ${name} form; every number, date, unit symbol, currency sign, ordinal meaning and {placeholder} exactly. Return every item with its source unchanged.`,
  input:JSON.stringify(texts),max_output_tokens:12000,text:{format:{type:'json_schema',name:'translations',schema,strict:true}}} as never);
 const text=(r.output||[]).flatMap(o=>'content' in o&&Array.isArray(o.content)?o.content:[]).map((c:{type?:string;text?:string})=>c.type==='output_text'?c.text||'':'').join('');
 const parsed=JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g,'')||'{}') as {items?:{source:string;text:string}[]};
 return Object.fromEntries((parsed.items||[]).map(x=>[x.source,x.text]));
}

// Pre-translation: the tree's topic names and descriptions are queued for the most-read languages ahead of readers,
// so browsing topics never waits. Once a day; only what is not queued or translated yet.
export const PRETRANSLATE=['zh','es','hi','ar','pt','fr','ja','ru','de','id','bn','ko','tr','vi','it','ur','fa','th','pl','zh-hant'];
export async function queueTreeTranslations(db:Queryable,langs=PRETRANSLATE):Promise<number>{
 const rows=(await db.query<{name:string;description:string}>("select name, description from topics where status <> 'archived'")).rows;
 const texts=[...new Set(rows.flatMap(r=>[r.name,r.description]).map(x=>String(x||'').trim()).filter(translatable))];
 let n=0;
 for(const lang of langs){
  for(let i=0;i<texts.length;i+=2000){const part=texts.slice(i,i+2000);
   const r=await db.query(`insert into translations(lang,hash,source) select $1::text, x.h, x.s from unnest($2::text[],$3::text[]) as x(h,s) on conflict do nothing returning 1`,[lang,part.map(hashOf),part]);
   n+=r.rows.length;}
 }
 return n;
}
