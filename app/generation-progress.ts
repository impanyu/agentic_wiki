import {database} from '@/db/store';
// historyKey: the reader's visit-history key; a page finished in the background is added to
// their recently visited pages so it shows up on the home page even if they left.
export function generationProgress(id:string,owner:string,historyKey?:string){
 let state:Record<string,any>={body:'',status:'Finding the right page…'},last=0,chain=Promise.resolve();
 const write=()=>{const data=JSON.stringify(state),now=Date.now();last=now;chain=chain.catch(()=>{}).then(async()=>{await database().prepare('INSERT INTO generation_progress(id,owner_id,data,expires) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,expires=excluded.expires WHERE owner_id=excluded.owner_id').bind(id,owner,data,now+600000).run();});};
 return {
  event(event:any){
   if(event.type==='start')state={...state,started:true,language:event.language,title:event.question,question:event.question,startedAt:Date.now(),cancelToken:event.cancelToken};
   else if(event.type==='delta')state.body+=event.text;
   else if(event.type==='replace')state.body=event.text;
   else if(event.type==='status')state.status=event.message;
   else if(event.type==='metadata')state={...state,title:event.title,summary:event.summary,category:event.category,labels:event.labels};
   else if(event.type==='done'){state={...state,done:true,pageId:event.page?.id,reused:!!event.reused,question:event.question||state.question};const page=event.page;if(historyKey&&page?.id){const now=Date.now();chain=chain.catch(()=>{}).then(async()=>{await database().prepare('INSERT INTO page_visits(id,owner_key,page_id,title,question,parameters,visited_at,recorded_at) VALUES(?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),historyKey,page.id,String(page.title||'').slice(0,500),String(state.question||page.title||'').slice(0,2000),JSON.stringify(page.parameters||{}),now,now).run();});}}
   else if(event.type==='error')state={...state,error:event.message};
   if(Date.now()-last>500||['start','metadata','done','error'].includes(event.type))write();
  },
  async finish(){write();await chain.catch(()=>{});},
 };
}
