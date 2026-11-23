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
// Translates a page model into a language: what is translated already is put in, the rest is queued.
// Returns the model and whether anything is still waiting (the page is then kept out of search indexes).
export async function localizeContent<T>(db:Queryable,model:T,locale:string):Promise<{model:T;complete:boolean}>{
 if(!locale||locale===DEFAULT_LOCALE||!LOCALES.some(l=>l.code===locale))return {model,complete:true};
 const texts=new Set<string>();collect(model,texts);
 if(!texts.size)return {model,complete:true};
 const list=[...texts].slice(0,800),hashes=list.map(hashOf);
 const map=new Map<string,string>();
 try{
  const r=await db.query<{hash:string;text:string|null;status:string}>('select hash, text, status from translations where lang=$1::text and hash = any($2::text[])',[locale,hashes]);
  const got=new Map(r.rows.map(x=>[x.hash,x]));const missing:[string,string][]=[];
  list.forEach((s,i)=>{const g=got.get(hashes[i]);if(g?.status==='done'&&g.text)map.set(s,g.text);else if(!g)missing.push([hashes[i],s]);});
  if(missing.length){
   await db.query(`insert into translations(lang,hash,source) select $1::text, x.h, x.s from unnest($2::text[],$3::text[]) as x(h,s) on conflict do nothing`,[locale,missing.map(m=>m[0]),missing.map(m=>m[1])]);
   // The first reader of a page in this language should not see English: a small batch is translated right away
   // (CONTENT_SYNC_LIMIT texts within CONTENT_SYNC_MS); a larger one, or a slow or failed call, waits for the heartbeat.
   const limit=Number(process.env.CONTENT_SYNC_LIMIT||80),ms=Number(process.env.CONTENT_SYNC_MS||6000);
   if(missing.length<=limit&&limit>0){
    const name=LOCALES.find(l=>l.code===locale)?.name||locale;
    const got=await Promise.race([translateBatch(missing.map(m=>m[1]),locale,name).catch(()=>null),new Promise<null>(r=>setTimeout(()=>r(null),ms))]);
    if(got)for(const [h,src] of missing){const t=got[src];if(typeof t==='string'&&t.trim()){map.set(src,t.trim());
     await db.query(`update translations set text=$3::text, status='done', updated_at=now() where lang=$1::text and hash=$2::text`,[locale,h,t.trim().slice(0,4000)]).catch(()=>{});}}
   }
  }
 }catch{return {model,complete:false};}
 return {model:apply(model,map) as T,complete:map.size>=list.length};
}
// Background: translate the oldest waiting texts, a batch per language (heartbeat).
let busy=false;
export async function translatePending(db:Queryable,{batches=4,size=40}:{batches?:number;size?:number}={}):Promise<number>{
 if(busy)return 0;busy=true;let done=0;
 try{
  const langs=(await db.query<{lang:string}>(`select lang from translations where status='pending' and attempts<3 group by lang order by min(created_at) limit $1::int`,[batches])).rows.map(r=>r.lang);
  for(const lang of langs){
   const rows=(await db.query<{hash:string;source:string}>(`select hash, source from translations where lang=$1::text and status='pending' and attempts<3 order by created_at limit $2::int`,[lang,size])).rows;
   if(!rows.length)continue;
   const name=LOCALES.find(l=>l.code===lang)?.name||lang;
   try{
    const out=await translateBatch(rows.map(r=>r.source),lang,name);
    for(const r of rows){const t=out[r.source];
     if(typeof t==='string'&&t.trim())await db.query(`update translations set text=$3::text, status='done', updated_at=now() where lang=$1::text and hash=$2::text`,[lang,r.hash,t.trim().slice(0,4000)]);
     else await db.query('update translations set attempts=attempts+1, updated_at=now() where lang=$1::text and hash=$2::text',[lang,r.hash]);
     done++;}
   }catch(e){await db.query('update translations set attempts=attempts+1, updated_at=now() where lang=$1::text and hash = any($2::text[])',[lang,rows.map(r=>r.hash)]);console.warn('[translate]',lang,(e as Error).message.slice(0,200));}
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
