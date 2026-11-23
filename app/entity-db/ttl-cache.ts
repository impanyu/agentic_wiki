// A small in-memory cache for page data that is expensive to compute and changes slowly (rankings, entity pages,
// topic trees): a value is kept for ttlMs, at most max values, and concurrent requests for the same key share one
// computation. Errors are not cached.
export function ttlCache<V>(ttlMs:number,max=200){
 const store=new Map<string,{at:number;value:Promise<V>}>();
 return {
  get(key:string,load:()=>Promise<V>):Promise<V>{
   const hit=store.get(key);
   if(hit&&Date.now()-hit.at<ttlMs){store.delete(key);store.set(key,hit);return hit.value;}
   const value=load();
   store.set(key,{at:Date.now(),value});
   value.catch(()=>{if(store.get(key)?.value===value)store.delete(key);});
   while(store.size>max)store.delete(store.keys().next().value!);
   return value;
  },
  clear(){store.clear();},
 };
}
