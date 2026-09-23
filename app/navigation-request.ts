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

// After a dropped stream (background tab, suspended mobile browser) the server
// keeps generating; poll the progress record until the page is saved or the
// generation reports an error. Never repeats the POST.
export async function waitForGenerationResult<T>(generationId:string,signal:AbortSignal,timeoutMs=600000,intervalMs=2000):Promise<{page:T;reused?:boolean}|undefined>{
 const deadline=Date.now()+timeoutMs;
 while(!signal.aborted&&Date.now()<deadline){
  try{
   const response=await navigationRequest('/api/ask?generationId='+encodeURIComponent(generationId),{cache:'no-store',signal});
   if(response.status===404||response.status===403)return;
   if(response.ok){const progress=await response.json() as {done?:boolean;page?:T;reused?:boolean;error?:string;pending?:boolean};if(progress.done&&progress.page)return {page:progress.page,reused:progress.reused};if(progress.error)return;}
  }catch(error){if(signal.aborted)return;}
  await new Promise<void>((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(signal.reason||new DOMException('Aborted','AbortError'));};const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},intervalMs);if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});}).catch(()=>{});
 }
}
// Recover the saved result using a read-only request; never repeat generation.
export async function recoverGenerationResult<T>(generationId:string,signal:AbortSignal):Promise<{page:T;reused?:boolean}|undefined>{
 try{
  const response=await navigationRequest('/api/ask?generationId='+encodeURIComponent(generationId),{cache:'no-store',signal});
  if(!response.ok||signal.aborted)return;
  const progress=await response.json() as {done?:boolean;page?:T;reused?:boolean};
  if(progress.done&&progress.page)return {page:progress.page,reused:progress.reused};
 }catch{}
}
