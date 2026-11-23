// A small in-memory cache for page data that is expensive to compute and changes slowly (rankings, entity pages,
// topic trees): a value is fresh for ttlMs, at most max values, and concurrent requests for the same key share one
// computation. Stale-while-revalidate: an expired value that loaded fine is still served at once while one
// background load replaces it (up to staleMs, default 12 × ttlMs), so readers never wait for a refresh. Errors are
// not cached.
export function ttlCache<V>(ttlMs:number,max=200,staleMs=ttlMs*12){
 type Entry={at:number;value:Promise<V>;ok:boolean;refreshing:boolean};
 const store=new Map<string,Entry>();
 const put=(key:string,value:Promise<V>)=>{
  const e:Entry={at:Date.now(),value,ok:false,refreshing:false};
  store.set(key,e);
  value.then(()=>{e.ok=true;},()=>{if(store.get(key)===e)store.delete(key);});
  while(store.size>max)store.delete(store.keys().next().value!);
  return e;
 };
 return {
  get(key:string,load:()=>Promise<V>):Promise<V>{
   const hit=store.get(key);
   const age=hit?Date.now()-hit.at:Infinity;
   if(hit&&age<ttlMs){store.delete(key);store.set(key,hit);return hit.value;}
   if(hit&&hit.ok&&age<staleMs){
    if(!hit.refreshing){hit.refreshing=true;
     const next=load();next.then(()=>{if(store.get(key)===hit){const e=put(key,next);e.ok=true;}},()=>{hit.refreshing=false;});}
    return hit.value;
   }
   return put(key,load()).value;
  },
  clear(){store.clear();},
 };
}
