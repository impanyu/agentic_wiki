// Web search for providers without OpenAI's built-in web_search tool: a function tool
// web_search(query,count) backed by the first configured search API (Jina, Tavily, Exa).
export type SearchResult={title:string;url:string;snippet:string};
export type SearchProvider={id:string;keyEnv:string;search:(query:string,count:number,key:string,fetcher:typeof fetch,signal?:AbortSignal)=>Promise<SearchResult[]>};
const clip=(text:unknown,max=700)=>String(text||'').replace(/\s+/g,' ').trim().slice(0,max);
async function json(response:Response,name:string){if(!response.ok){await response.body?.cancel();throw Error(name+' search failed ('+response.status+')');}return await response.json() as any;}
export const SEARCH_PROVIDERS:SearchProvider[]=[
 {id:'jina',keyEnv:'JINA_API_KEY',search:async(query,count,key,fetcher,signal)=>{
  const data=await json(await fetcher('https://s.jina.ai/?q='+encodeURIComponent(query),{headers:{Authorization:'Bearer '+key,Accept:'application/json','X-Respond-With':'no-content'},signal}),'Jina');
  return (data.data||[]).slice(0,count).map((r:any)=>({title:clip(r.title,200),url:String(r.url||''),snippet:clip(r.description||r.content)}));
 }},
 {id:'tavily',keyEnv:'TAVILY_API_KEY',search:async(query,count,key,fetcher,signal)=>{
  const data=await json(await fetcher('https://api.tavily.com/search',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({query,max_results:count}),signal}),'Tavily');
  return (data.results||[]).slice(0,count).map((r:any)=>({title:clip(r.title,200),url:String(r.url||''),snippet:clip(r.content)}));
 }},
 {id:'exa',keyEnv:'EXA_API_KEY',search:async(query,count,key,fetcher,signal)=>{
  const data=await json(await fetcher('https://api.exa.ai/search',{method:'POST',headers:{'x-api-key':key,'Content-Type':'application/json'},body:JSON.stringify({query,numResults:count,contents:{text:{maxCharacters:700}}}),signal}),'Exa');
  return (data.results||[]).slice(0,count).map((r:any)=>({title:clip(r.title,200),url:String(r.url||''),snippet:clip(r.text||r.summary)}));
 }},
];
export function searchConfigured(env:(name:string)=>string|undefined){return SEARCH_PROVIDERS.some(p=>env(p.keyEnv));}
export async function webSearch(query:string,count:number,env:(name:string)=>string|undefined,fetcher:typeof fetch,signal?:AbortSignal){
 const errors:string[]=[];
 for(const provider of SEARCH_PROVIDERS){
  const key=env(provider.keyEnv);if(!key)continue;
  try{
   const results=(await provider.search(query,Math.max(1,Math.min(10,count||5)),key,fetcher,signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000))).filter(r=>/^https?:\/\//.test(r.url));
   return {provider:provider.id,results};
  }catch(error){if(signal?.aborted)throw error;errors.push(error instanceof Error?error.message:String(error));}
 }
 throw Error(errors.length?'WEB_SEARCH_FAILED: '+errors.join('; '):'WEB_SEARCH_NOT_CONFIGURED');
}
