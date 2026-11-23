import {createHash} from 'node:crypto';
import type {Queryable} from '@/app/entity-db/client';
import {DEFAULT_LOCALE,LOCALES} from './locales';
// Content translation (the pages' own words, not the interface): titles, labels, sentences, table cells and units of a
// page model, stored once per language. One language per page: a text not translated yet is translated before the
// page is shown (localizeContent); a pool of background workers translates ahead of readers (startTranslationPool).
// Proper names, numbers and links are kept. A page in another language is indexed only when nothing on it is missing.
const KEYS=new Set(['title','name','label','lead','text','description','detail','subtitle','about','caption','note','kicker','summary','heading','paragraphs','baseTitle','question','unitLabel','unit','what','predicate','subtitle','headline','tagline','alt','typeLabel']);
const SKIP=new Set(['href','slug','key','id','image','url','code','format','currency','period','year','entity_id','type','column']);
const hashOf=(s:string)=>createHash('sha1').update(s).digest('hex').slice(0,20);
const translatable=(s:string)=>s.length>=2&&s.length<=1200&&/\p{L}{2}/u.test(s)&&!/^(https?:|\/|#|data:)/.test(s)&&!/^[\p{Lu}\d_-]{2,12}$/u.test(s);
// A number followed by its unit ("72.24 years", "2,702.48 USD per person"): the unit is translated, the number kept.
const NUM_UNIT=/^([+−-]?\d[\d.,\s  ]*%?)\s+(\p{L}[\p{L}\p{N}\s/.²³₂·()'’-]*)$/u;
// A sentence with links is a list of parts ({text, href?}); it is translated as one sentence, the linked words marked
// <n>…</n> (n = the part's index) so the translation keeps them linked, in the order the language needs.
type Part={text:string;href?:string};
const isParts=(v:unknown):v is Part[]=>Array.isArray(v)&&v.length>0&&v.every(p=>p&&typeof p==='object'&&typeof (p as Part).text==='string'&&Object.keys(p as object).every(k=>k==='text'||k==='href'));
const PART_KEYS=new Set(['leadParts','paragraphParts','parts']);
const marked=(parts:Part[])=>parts.map((p,i)=>p.href?`<${i}>${p.text}</${i}>`:p.text).join('').trim();
function unmark(t:string,parts:Part[]):Part[]|null{
 const out:Part[]=[];let last=0;const used=new Set<number>();
 for(const m of t.matchAll(/<(\d+)>([\s\S]*?)<\/\1>/g)){const i=Number(m[1]);if(!parts[i]?.href||used.has(i))return null;used.add(i);
  if(m.index!>last)out.push({text:t.slice(last,m.index)});out.push({text:m[2],href:parts[i].href});last=m.index!+m[0].length;}
 if(last<t.length)out.push({text:t.slice(last)});
 // Every link must survive, and no stray tag may be left.
 if(parts.some((p,i)=>p.href&&!used.has(i))||out.some(p=>/<\/?\d+>/.test(p.text)))return null;
 return out.filter(p=>p.text);
}
// Cells of a table (a ranking's rows): every text cell is page text (names, regions, categories) except ids, addresses,
// periods and source names.
const CELL_SKIP=/^(id|entity_id|slug|href|url|image|period|code|type|num)$|_(source|url|id|href|code)$/;
// Every translatable text in a value (by key), in order.
function collect(v:unknown,out:Set<string>,key=''){
 if(typeof v==='string'){const x=v.trim();if(!x)return;
  const nu=NUM_UNIT.exec(x);if(nu){if(translatable(nu[2].trim()))out.add(nu[2].trim());return;}
  if((KEYS.has(key)||key==='cell')&&translatable(x)&&!/^[\d\s.,%+−-]+$/.test(x))out.add(x);return;}
 if(PART_KEYS.has(key)&&Array.isArray(v)){
  if(isParts(v)){const m=marked(v);if(translatable(m))out.add(m);return;}
  if(v.every(isParts)){for(const s of v as Part[][]){const m=marked(s);if(translatable(m))out.add(m);}return;}
 }
 if(key==='rows'&&Array.isArray(v)){for(const r of v)if(r&&typeof r==='object')for(const [k,x] of Object.entries(r))if(!CELL_SKIP.test(k))collect(x,out,KEYS.has(k)?k:'cell');return;}
 if(Array.isArray(v)){for(const x of v)collect(x,out,key==='paragraphs'?'paragraphs':key);return;}
 if(v&&typeof v==='object')for(const [k,x] of Object.entries(v)){if(SKIP.has(k))continue;collect(x,out,k);}
}
function apply(v:unknown,map:Map<string,string>,key=''):unknown{
 if(typeof v==='string'){const x=v.trim();
  const nu=NUM_UNIT.exec(x);if(nu){const t=map.get(nu[2].trim());return t?nu[1].trim()+' '+t:v;}
  if(!KEYS.has(key)&&key!=='cell')return v;const t=map.get(x);return t??v;}
 if(PART_KEYS.has(key)&&Array.isArray(v)){
  const one=(s:Part[])=>{const t=map.get(marked(s));return t?unmark(t,s)??s:s;};
  if(isParts(v))return one(v);
  if(v.every(isParts))return (v as Part[][]).map(one);
 }
 if(key==='rows'&&Array.isArray(v))return v.map(r=>r&&typeof r==='object'?Object.fromEntries(Object.entries(r).map(([k,x])=>[k,CELL_SKIP.test(k)?x:apply(x,map,KEYS.has(k)?k:'cell')])):r);
 if(Array.isArray(v))return v.map(x=>apply(x,map,key==='paragraphs'?'paragraphs':key));
 if(v&&typeof v==='object'){const o:Record<string,unknown>={};for(const [k,x] of Object.entries(v)){o[k]=SKIP.has(k)?x:apply(x,map,k);}return o;}
 return v;
}
// Texts being translated right now (lang:hash → the batch's promise), so concurrent requests and the background pool
// share one translation of each text instead of starting another.
const inflight=new Map<string,Promise<unknown>>();
async function save(db:Queryable,lang:string,pairs:[string,string][],out:Record<string,string>,map?:Map<string,string>){
 const hs:string[]=[],ts:string[]=[];
 for(const [h,src] of pairs){const t=out[src];if(typeof t==='string'&&t.trim()){hs.push(h);ts.push(t.trim().slice(0,4000));map?.set(src,t.trim());}}
 if(hs.length)await db.query(`update translations x set text=v.t, status='done', updated_at=now() from unnest($2::text[],$3::text[]) as v(h,t) where x.lang=$1::text and x.hash=v.h`,[lang,hs,ts]);
 const failed=pairs.filter(([,src])=>!(typeof out[src]==='string'&&out[src].trim())).map(([h])=>h);
 if(failed.length)await db.query('update translations set attempts=attempts+1, updated_at=now() where lang=$1::text and hash = any($2::text[])',[lang,failed]);
}
type Cls='instant'|'translate';
// Translates [hash, source] pairs in parallel chunks (each saved when it returns, even after the caller stopped
// waiting). Returns a promise per chunk, plus the promises of pairs another request is already translating.
function translateChunks(db:Queryable,lang:string,pairs:[string,string][],size:number,cls:Cls):Promise<unknown>[]{
 const name=LOCALES.find(l=>l.code===lang)?.name||lang;
 const out:Promise<unknown>[]=[],todo:[string,string][]=[];
 for(const p of pairs){const f=inflight.get(lang+':'+p[0]);if(f)out.push(f);else todo.push(p);}
 for(let i=0;i<todo.length;i+=size){
  const chunk=todo.slice(i,i+size);
  const job=translateBatch(chunk.map(c=>c[1]),lang,name,cls)
   .then(r=>save(db,lang,chunk,r),async e=>{await save(db,lang,chunk,{});console.warn('[translate]',lang,(e as Error).message.slice(0,160));})
   .catch(()=>{}).finally(()=>{for(const [h] of chunk)if(inflight.get(lang+':'+h)===job)inflight.delete(lang+':'+h);});
  for(const [h] of chunk)inflight.set(lang+':'+h,job);
  out.push(job);
 }
 return [...new Set(out)];
}
// Translates a page model into a language. One language per page: what is translated already is put in, and
// everything still missing is translated before the page is shown — in parallel batches on models that answer in
// seconds (the "instant" chain), waiting up to CONTENT_SYNC_MS (15 s). Pre-translation makes this rare. Numbers and
// units may stay as they are; every other word is in the reader's language.
// Returns the model and whether anything is still missing (the page is then kept out of search indexes).
export async function localizeContent<T>(db:Queryable,model:T,locale:string):Promise<{model:T;complete:boolean}>{
 if(!locale||locale===DEFAULT_LOCALE||!LOCALES.some(l=>l.code===locale))return {model,complete:true};
 const texts=new Set<string>();collect(model,texts);
 if(!texts.size)return {model,complete:true};
 const list=[...texts].slice(0,4000),hashes=list.map(hashOf);
 const map=new Map<string,string>();
 try{
  const r=await db.query<{hash:string;text:string|null;status:string;attempts:number}>('select hash, text, status, attempts from translations where lang=$1::text and hash = any($2::text[])',[locale,hashes]);
  const got=new Map(r.rows.map(x=>[x.hash,x]));const missing:[string,string][]=[];
  list.forEach((s,i)=>{const g=got.get(hashes[i]);if(g?.status==='done'&&g.text)map.set(s,g.text);else missing.push([hashes[i],s]);});
  if(missing.length){
   await db.query(`insert into translations(lang,hash,source,priority) select $1::text, x.h, x.s, 1 from unnest($2::text[],$3::text[]) as x(h,s)
    on conflict (lang, hash) do update set priority = greatest(translations.priority, 1), attempts = least(translations.attempts, 2) where translations.status = 'pending'`,[locale,missing.map(m=>m[0]),missing.map(m=>m[1])]);
   const ms=Number(process.env.CONTENT_SYNC_MS||15000);
   if(ms>0){
    const jobs=translateChunks(db,locale,missing,20,'instant');
    await Promise.race([Promise.all(jobs),new Promise(r=>setTimeout(r,ms))]);
    const done=await db.query<{hash:string;text:string}>(`select hash, text from translations where lang=$1::text and status='done' and hash = any($2::text[])`,[locale,missing.map(m=>m[0])]);
    const byHash=new Map(missing);for(const d of done.rows){const src=byHash.get(d.hash);if(src&&d.text)map.set(src,d.text);}
   }
  }
 }catch{return {model,complete:false};}
 return {model:apply(model,map) as T,complete:map.size>=list.length};
}
// Background translation: a pool of workers, each taking the next waiting batch (highest priority first: the home
// page, subject pages, texts readers met, then the rest of the tree) as soon as its last one is done. Started once
// per worker process; runs for the life of the process.
let pool=0;
export function startTranslationPool(db:Queryable,workers=16,size=40){
 if(pool)return pool;pool=workers;
 const worker=async(n:number)=>{
  await new Promise(r=>setTimeout(r,n*500));
  for(;;){
   try{
    const rows=(await db.query<{lang:string;hash:string;source:string}>(`select lang, hash, source from translations where status='pending' and attempts<3 order by priority desc, created_at limit 400`)).rows
     .filter(r=>!inflight.has(r.lang+':'+r.hash));
    if(!rows.length){await new Promise(r=>setTimeout(r,15_000));continue;}
    const lang=rows[0].lang,pairs=rows.filter(r=>r.lang===lang).slice(0,size).map(r=>[r.hash,r.source] as [string,string]);
    const t0=Date.now();await Promise.all(translateChunks(db,lang,pairs,size,'translate'));
    done+=pairs.length;if(Date.now()-t0<1000)await new Promise(r=>setTimeout(r,1000));
   }catch(e){console.warn('[translate] pool',(e as Error).message.slice(0,160));await new Promise(r=>setTimeout(r,10_000));}
  }
 };
 for(let i=0;i<workers;i++)void worker(i);
 setInterval(()=>{if(done){console.log('[translate]',done,'texts in the last 5 min');done=0;}},5*60_000).unref?.();
 return pool;
}
let done=0;
async function translateBatch(texts:string[],lang:string,name:string,cls:Cls='translate'):Promise<Record<string,string>>{
 const {respond}=await import('@/app/llm');
 const schema={type:'object',additionalProperties:false,required:['items'],properties:{items:{type:'array',items:{type:'object',additionalProperties:false,required:['source','text'],properties:{source:{type:'string'},text:{type:'string'}}}}}};
 const r=await respond({class:cls,store:false,instructions:`You translate the text of RankWiki, a public ranking and encyclopedia site, from English into ${name} (${lang}). Translate each item fully and naturally, as a well-edited reference site in that language would. Some items mark linked words as <0>…</0>, <3>…</3>: keep every such tag pair exactly once, around the words that mean the same in your translation (reorder them as the grammar needs). Keep: brand, product, company and person names as they are (use the established ${name} name of a famous person or work if one exists); place names in their established ${name} form; every number, date, unit symbol, currency sign, ordinal meaning and {placeholder} exactly. Return every item with its source unchanged.`,
  input:JSON.stringify(texts),max_output_tokens:12000,text:{format:{type:'json_schema',name:'translations',schema,strict:true}}} as never);
 const text=(r.output||[]).flatMap(o=>'content' in o&&Array.isArray(o.content)?o.content:[]).map((c:{type?:string;text?:string})=>c.type==='output_text'?c.text||'':'').join('');
 const parsed=JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g,'')||'{}') as {items?:{source:string;text:string}[]};
 return Object.fromEntries((parsed.items||[]).map(x=>[x.source,x.text]));
}

// Queues texts for every given language at a priority (raising it for texts already waiting). Returns how many
// were new or raised.
export async function queueTexts(db:Queryable,values:unknown,langs:string[],priority:number):Promise<number>{
 const set=new Set<string>();collect(values,set);const texts=[...set];if(!texts.length)return 0;
 let n=0;
 for(const lang of langs){if(lang===DEFAULT_LOCALE)continue;
  const r=await db.query(`insert into translations(lang,hash,source,priority) select $1::text, x.h, x.s, $4::int from unnest($2::text[],$3::text[]) as x(h,s)
   on conflict (lang, hash) do update set priority = $4::int where translations.status = 'pending' and translations.priority < $4::int returning 1`,[lang,texts.map(hashOf),texts,priority]);
  n+=r.rows.length;}
 return n;
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
