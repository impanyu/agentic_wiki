// Fills interface strings missing from app/i18n/public/<lang>.json by machine translation (OpenAI), so a new
// t('…') reaches all languages without hand work. Usage: OPENAI_API_KEY=… node scripts/i18n/fill-missing.mjs [dir]
// Placeholders like {count} and {n} are kept; the brand name RankWiki is never translated.
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
const dir=process.argv[2]||'app/i18n/public';const key=process.env.OPENAI_API_KEY;if(!key)throw Error('OPENAI_API_KEY is required.');
const model=process.env.I18N_MODEL||'gpt-5.4-mini';
const en=JSON.parse(readFileSync(dir+'/en.json','utf8'));
const NAMES={zh:'Simplified Chinese','zh-hant':'Traditional Chinese',yue:'Cantonese (Traditional Chinese characters)',no:'Norwegian Bokmål',fil:'Filipino',ceb:'Cebuano',mai:'Maithili',ku:'Kurdish (Kurmanji)',om:'Oromo',ny:'Chichewa',sn:'Shona',rw:'Kinyarwanda',ht:'Haitian Creole'};
const langName=c=>NAMES[c]||new Intl.DisplayNames(['en'],{type:'language'}).of(c)||c;
for(const f of readdirSync(dir).filter(f=>f.endsWith('.json')&&f!=='en.json')){
 const code=f.slice(0,-5),path=dir+'/'+f,d=JSON.parse(readFileSync(path,'utf8'));
 const missing=Object.keys(en).filter(k=>!(k in d));
 for(const k of Object.keys(d))if(!(k in en))delete d[k];
 if(missing.length){
  const r=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({model,response_format:{type:'json_object'},messages:[
   {role:'system',content:`Translate the user-interface strings of RankWiki, a public ranking and encyclopedia website, from English into ${langName(code)}. Return one JSON object mapping each English string (unchanged, as the key) to its translation. Keep placeholders such as {count}, {n}, {q}, {k}, {pct} exactly. Never translate "RankWiki". Use the concise, natural wording a well-made website uses.`},
   {role:'user',content:JSON.stringify(missing)}]})});
  const j=await r.json();if(!r.ok)throw Error(code+': '+JSON.stringify(j).slice(0,300));
  const out=JSON.parse(j.choices[0].message.content);
  for(const k of missing){const v=out[k];if(typeof v!=='string'||!v.trim())throw Error(code+': no translation for '+k);
   for(const p of k.match(/\{\w+\}/g)||[])if(!v.includes(p))throw Error(code+': placeholder '+p+' lost in '+v);d[k]=v;}
  console.log(code,missing.length,'translated');
 }
 writeFileSync(path,JSON.stringify(Object.fromEntries(Object.keys(en).filter(k=>k in d).sort().map(k=>[k,d[k]])),null,1)+'\n');
}
