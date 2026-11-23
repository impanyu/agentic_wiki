import type {Queryable} from '@/app/entity-db/client';
import {webSearch} from '@/app/llm/search';
// The collector's source survey: a world directory of public data sources to search (international bodies, every
// large country's statistics office, regulators, registries, exchanges, local retailers and spec sites, bulk dumps),
// web search in any language, and the topic's own source register (every candidate with the decision and why).
export type DirectoryEntry={id:string;name:string;scope?:string;countries?:string[];languages?:string[];topics?:string[];kind?:string;access?:string;url?:string;api?:string;format?:string;notes?:string};
let directory:Promise<DirectoryEntry[]>|null=null;
function loadDirectory(){
 // Bundled with the server build (app/public-data/directory.json, curated and link-checked).
 directory??=import('@/app/public-data/directory.json').then(m=>(m.default??m) as unknown as DirectoryEntry[]).catch(()=>[]);
 return directory;
}
const norm=(s:string)=>s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g,'');
// Every word of the query must appear in the entry's name, topics, kind, notes or scope; country narrows to entries
// covering that country (ISO2/ISO3 or name) or the world/its region.
export async function findSources(query:string,country:string,limit=30){
 const all=await loadDirectory();
 const words=norm(query).split(/[^\p{L}\p{N}]+/u).filter(w=>w.length>1);
 const c=norm(country.trim());
 const hits=all.map(e=>{
  const hay=norm([e.name,e.scope,e.kind,(e.topics||[]).join(' '),e.notes,e.id].join(' '));
  const score=words.reduce((n,w)=>n+(hay.includes(w)?1:0),0);
  // A code matches exactly ("IN" is India, not the "in" of "United Kingdom"); a name (4+ letters) matches the scope.
  const local=!!c&&((e.countries||[]).some(x=>norm(x)===c)||c.length>3&&norm(e.scope||'').includes(c));
  const world=(e.countries||[]).some(x=>['world','global','int'].includes(norm(x)));
  return {e,score:score+(local?0.5:0),inCountry:!c||local||world};
 }).filter(h=>h.inCountry&&(!words.length||h.score>=1)).sort((a,b)=>b.score-a.score).slice(0,limit).map(h=>h.e);
 return {directorySize:all.length,count:hits.length,sources:hits,
  note:all.length?'Directory entries are leads, not proof: open each one (fetch_data, browse_page) to see what it really holds before recording it.':'The source directory is not available on this server; use web_search.'};
}
export async function searchWeb(query:string,count:number,signal?:AbortSignal){
 try{return await webSearch(query,count,n=>process.env[n],fetch,signal);}
 catch(e){
  const m=(e as Error).message;
  if(m==='WEB_SEARCH_NOT_CONFIGURED'){
   const {raiseIssue}=await import('@/app/ops/issues');const {entityDb}=await import('@/app/entity-db/client');
   await raiseIssue(await entityDb(),{source:'platform',topic:'',severity:'major',title:'Collectors have no web search',detail:'Set JINA_API_KEY (free tier at jina.ai), TAVILY_API_KEY or EXA_API_KEY with ~/rankwiki/set-secret.sh so collectors can survey sources.',fingerprint:'web-search-missing'}).catch(()=>{});
   throw Error('Web search is not configured on this server yet (the operators are told). Use find_sources and the public sources meanwhile.');
  }
  throw e;
 }
}
// The topic's source register: one row per candidate source, chosen or rejected, with why.
export type SourceRecord={url:string;name:string;kind:string;countries:string;covers:string;format:string;decision:'chosen'|'rejected'|'candidate';reason:string};
export async function recordSources(db:Queryable,topicId:string|null,items:SourceRecord[]){
 if(!topicId)throw Error('This team has no topic.');
 let saved=0;
 for(const s of items){
  const url=String(s.url||'').trim();if(!/^https?:\/\//.test(url))throw Error('Each source needs its http(s) address: '+JSON.stringify(s).slice(0,120));
  if(!['chosen','rejected','candidate'].includes(s.decision))throw Error('decision is chosen, rejected or candidate.');
  const notes=JSON.stringify({name:String(s.name||'').slice(0,200),countries:String(s.countries||'').slice(0,300),covers:String(s.covers||'').slice(0,600),format:String(s.format||'').slice(0,60),decision:s.decision,reason:String(s.reason||'').slice(0,600),at:new Date().toISOString()});
  await db.query(`insert into sources(topic_id,url,kind,notes) values ($1::uuid,$2::text,$3::text,$4::text)
   on conflict (coalesce(topic_id::text, ''), url) do update set kind=excluded.kind, notes=excluded.notes`,[topicId,url.slice(0,2000),String(s.kind||'').slice(0,60),notes]);
  saved++;
 }
 return {saved,register:await listSources(db,topicId)};
}
export async function listSources(db:Queryable,topicId:string|null){
 if(!topicId)return [];
 const r=await db.query<{url:string;kind:string;notes:string}>('select url, kind, notes from sources where topic_id=$1::uuid order by created_at',[topicId]);
 return r.rows.map(x=>{let n:Record<string,unknown>={};try{n=JSON.parse(x.notes);}catch{n={notes:x.notes};}return {url:x.url,kind:x.kind,...n};});
}
