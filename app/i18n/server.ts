import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {api,output} from '@/app/api/ask/ai';
import {model} from '@/db/store';
import catalog from './catalog.json';
import zh from './zh-pairs.json';
const pending=new Map<string,Promise<Record<string,string>>>();
export function uiTranslations(language:string){
 if(!/^[a-z]{2,3}(?:-[A-Za-z]{2,8})?$/.test(language))throw Error('Invalid language');
 // Cache by catalog version and language, independent of users or page contents.
 if(language==='en')return Promise.resolve(catalog);
 const key=createHash('sha256').update(JSON.stringify(catalog)+language).digest('hex');
 if(!pending.has(key))pending.set(key,(async()=>{
  const directory=join(process.env.DATA_DIR||'./data','ui-translations'),file=join(directory,key+'.json');
  try{return JSON.parse(await readFile(file,'utf8')) as Record<string,string>;}catch{}
  const translated:Record<string,string>=language==='zh'||language==='zh-Hans'?{...zh}:{};
  const entries=Object.keys(catalog).filter(key=>!translated[key]);
  for(let start=0;start<entries.length;start+=45){
   const keys=entries.slice(start,start+45);
   const response=await api('responses',{model:model(),store:false,instructions:'Translate these fixed web application interface strings into '+language+'. Return every key unchanged and its translated value. Keep placeholder tokens such as {count}, leading/trailing spaces, product names, keyboard names, API identifiers and URLs intact. Use consistent concise UI terminology. public read only and public read & write describe page access. Fork means a separately generated page branch. Translate all human-readable text, including errors and permission options. Do not add explanation.',input:JSON.stringify(Object.fromEntries(keys.map(key=>[key,key]))),text:{format:{type:'json_schema',name:'ui_translation',strict:true,schema:{type:'object',additionalProperties:false,properties:Object.fromEntries(keys.map(key=>[key,{type:'string'}])),required:keys}}},max_output_tokens:6500});
   const result=JSON.parse(output(response));for(const key of keys){if(typeof result[key]!=='string'||!result[key].trim())throw Error('Incomplete UI translation');const tokens=(value:string)=>value.match(/\{\w+\}/g)?.sort().join('|')||'';if(tokens(result[key])!==tokens(key))throw Error('Invalid translation placeholders');translated[key]=result[key];}
  }
  await mkdir(directory,{recursive:true});await writeFile(file,JSON.stringify(translated));return translated;
 })().catch(error=>{pending.delete(key);throw error;}));
 return pending.get(key)!;
}
