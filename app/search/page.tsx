import {getChatGPTUser} from '@/app/chatgpt-auth';
import type {Metadata} from 'next';
import {SITE_NAME} from '@/app/edition';
import {entityDb} from '@/app/entity-db/client';
import {searchPages,logSearch} from '@/app/entity-db/pages';
import {getEmbedder,setEmbedder} from '@/app/entity-db/embeddings';
import {embedder as llmEmbedder} from '@/app/llm';
import {serverUi} from '@/app/i18n/request';
import {localizeLinks} from '@/app/i18n/locales';
import {DbShell} from '@/app/rankings/view';
import {SearchResults} from '@/app/search-box';
import {recordUnserved} from '@/app/teams/unserved';
// /search?q=…: the pages that match a query — by name first, then by meaning. When nothing matches, the reader
// is told so honestly and the query is passed to the editors (and to the manager, who reads the search log).
export const dynamic='force-dynamic';
type Props={searchParams:Promise<Record<string,string|string[]|undefined>>};
const one=(v:string|string[]|undefined)=>(typeof v==='string'?v:'').trim().slice(0,200);
export async function generateMetadata({searchParams}:Props):Promise<Metadata>{
 const q=one((await searchParams).q);
 return {title:(q?`${q} · `:'')+SITE_NAME,robots:{index:false,follow:true}};
}
export default async function SearchPage({searchParams}:Props){
 const q=one((await searchParams).q);
 const ui=await serverUi();
 let nodes:Awaited<ReturnType<typeof searchPages>>['nodes']=[],entities:typeof nodes=[];let note='';
 if(q){
  const db=await entityDb();if(!getEmbedder())setEmbedder(t=>llmEmbedder()(t));
  ({nodes,entities}=await searchPages(db,q,{embed:getEmbedder()}).catch(e=>{console.warn('search',(e as Error).message);return {nodes:[],entities:[]};}));
  await logSearch(db,q,ui.locale,nodes.length+entities.length).catch(()=>{});
  if(!nodes.length&&!entities.length)note=await recordUnserved(q,ui.locale).catch(()=>'');
 }
 return <DbShell locale={ui.locale} dictionary={ui.dict} askTargets={{}} className="answer template-search-v1" query={q} account={await getChatGPTUser().then(u=>u?{name:u.displayName}:null).catch(()=>null)}>
  <SearchResults query={q} nodes={localizeLinks(nodes,ui.locale)} entities={localizeLinks(entities,ui.locale)} unserved={!!note}/>
 </DbShell>;
}
