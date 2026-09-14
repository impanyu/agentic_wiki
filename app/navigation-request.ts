// Only use for idempotent requests; never replay answer generation automatically.
export async function navigationRequest(url:string,init:RequestInit={}){
 for(let attempt=0;;attempt++){
  try{
   const response=await fetch(url,init);
   if(attempt>=2||![502,503,504].includes(response.status))return response;
   await response.body?.cancel();
  }catch(error){
   if(init.signal?.aborted||!(error instanceof TypeError)||attempt>=2)throw error;
  }
  await new Promise<void>((resolve,reject)=>{
   const signal=init.signal;
   const abort=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(signal?.reason||new DOMException('Aborted','AbortError'));};
   const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},300*(attempt+1));
   if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  });
 }
}
export function navigationError(error:unknown,fallback:string){
 return error instanceof TypeError&&/load failed|failed to fetch|network|fetch failed/i.test(error.message)
  ? 'The connection was interrupted. Please click the link or submit your question again.'
  :error instanceof Error?error.message:fallback;
}
