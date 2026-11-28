// Source health: every request the collectors make to an outside host is counted per host and day (calls, answered,
// denied = login wall / challenge / 401 / 403, limited = 429, failed = other errors and timeouts), so the source
// registry (registry.ts) knows which links are open and which are stuck. Counted in memory and written once a
// minute; never on the request's path. Our own model, search and storage endpoints are not sources.
export type Outcome='ok'|'denied'|'limited'|'failed';
type Count={calls:number;ok:number;denied:number;limited:number;failed:number;lastStatus:number|null;lastError:string;lastOk:number;last:number};
const buf=new Map<string,Count>();
let timer:ReturnType<typeof setTimeout>|null=null;
const SKIP=/(^|\.)(jina\.ai|exa\.ai|tavily\.com|openai\.com|deepseek\.com|anthropic\.com|googleapis\.com|aisoup\.net|localhost)$/i;

export function hostOf(url:string|URL):string{try{return (typeof url==='string'?new URL(url):url).hostname.toLowerCase().replace(/^www\./,'');}catch{return '';}}
export function outcomeOf(status:number|null|undefined):Outcome{
 if(!status)return 'failed';if(status>=200&&status<400)return 'ok';
 if(status===401||status===403||status===451)return 'denied';if(status===429)return 'limited';return 'failed';
}
// One request's outcome. reclassify: a request already counted as answered turned out to be a challenge page.
export function noteFetch(url:string|URL,outcome:Outcome,{status=null,error='',reclassify=false}:{status?:number|null;error?:string;reclassify?:boolean}={}){
 const host=hostOf(url);if(!host||SKIP.test(host))return;
 let c=buf.get(host);if(!c){c={calls:0,ok:0,denied:0,limited:0,failed:0,lastStatus:null,lastError:'',lastOk:0,last:0};buf.set(host,c);}
 if(reclassify){if(c.ok>0)c.ok--;}else c.calls++;
 c[outcome]++;c.last=Date.now();if(status)c.lastStatus=status;
 if(outcome==='ok')c.lastOk=Date.now();else if(error)c.lastError=error.slice(0,300);
 if(!timer){timer=setTimeout(()=>{timer=null;void flush();},60_000);timer.unref?.();}
}
export async function flush(){
 if(!buf.size)return;
 const rows=[...buf.entries()];buf.clear();
 try{
  const {entityDb}=await import('@/app/entity-db/client');const db=await entityDb();
  for(const [host,c] of rows){
   await db.query(`insert into source_health(host,day,calls,ok,denied,limited,failed,last_status,last_error,last_ok_at,last_at)
     values ($1,current_date,$2,$3,$4,$5,$6,$7,$8,case when $9::bigint>0 then to_timestamp($9::bigint/1000.0) end,to_timestamp($10::bigint/1000.0))
     on conflict (host,day) do update set calls=source_health.calls+excluded.calls, ok=greatest(0,source_health.ok+excluded.ok), denied=source_health.denied+excluded.denied,
      limited=source_health.limited+excluded.limited, failed=source_health.failed+excluded.failed, last_status=coalesce(excluded.last_status,source_health.last_status),
      last_error=case when excluded.last_error<>'' then excluded.last_error else source_health.last_error end,
      last_ok_at=greatest(source_health.last_ok_at,excluded.last_ok_at), last_at=excluded.last_at`,
    [host,c.calls,c.ok,c.denied,c.limited,c.failed,c.lastStatus,c.lastError,c.lastOk,c.last]);
  }
 }catch(e){console.error('[source-health] flush failed',(e as Error).message);}
}
