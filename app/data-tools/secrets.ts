import {looseJson} from './args';
// Keys for data sources that need one (an API key, a token): the operators store each as SOURCE_KEY_<NAME> in the
// server's environment when an agent asks for access; agents write {{secret:SOURCE_KEY_<NAME>}} in a URL or header
// and the value is put in only when the request is sent. Agents never see a value: saved recipes, dataset sources,
// logs and error messages keep the placeholder.
const PLACEHOLDER=/\{\{\s*secret:([A-Z][A-Z0-9_]{2,80})\s*\}\}/g;
// Besides SOURCE_KEY_*, the keys the platform already holds for public data APIs may be used the same way.
const SHARED=new Set(['YOUTUBE_API_KEY','GITHUB_TOKEN','OPENALEX_API_KEY','COINGECKO_API_KEY']);
const allowed=(name:string)=>name.startsWith('SOURCE_KEY_')||SHARED.has(name);
export function resolveSecrets(text:string):string{
 return text.replace(PLACEHOLDER,(_m,name:string)=>{
  if(!allowed(name))throw Error('{{secret:'+name+'}}: only SOURCE_KEY_… names (and the shared data-API keys) can be used.');
  const v=process.env[name];if(!v)throw Error('{{secret:'+name+'}} is not configured yet. Ask the operators for it with request_access (they store it under that name); use another source meanwhile.');
  return v;
 });
}
export function redactSecrets(text:string):string{
 let out=text;
 for(const [k,v] of Object.entries(process.env))if(v&&v.length>=8&&allowed(k)&&out.includes(v))out=out.split(v).join('{{secret:'+k+'}}');
 return out;
}
export const hasSecrets=(text:string)=>/\{\{\s*secret:/.test(text);
// The names of the keys that are configured (never their values), for team_state.
export function secretNames():string[]{return Object.keys(process.env).filter(k=>allowed(k)&&!!process.env[k]).sort();}
// Request headers an agent may set (with secrets): auth and API-key headers, Accept, a few API-specific ones.
export function resolveHeaders(json:string):Record<string,string>|undefined{
 if(!json||!json.trim())return undefined;
 let o:unknown;try{o=looseJson(json);if(o===undefined)return undefined;}catch{throw Error('headers: a JSON object string, e.g. \'{"Authorization":"Bearer {{secret:SOURCE_KEY_EXAMPLE}}"}\'.');}
 if(!o||typeof o!=='object'||Array.isArray(o))throw Error('headers: a JSON object string.');
 const out:Record<string,string>={};
 for(const [k,v] of Object.entries(o as Record<string,unknown>)){
  if(!/^[A-Za-z0-9-]{1,60}$/.test(k)||/^(host|cookie|content-length|connection|transfer-encoding|proxy-.*)$/i.test(k))throw Error('headers: '+k+' cannot be set.');
  out[k]=resolveSecrets(String(v??'').slice(0,2000));
 }
 return out;
}
