import {database} from '@/db/store';
export function generationProgress(id:string,owner:string){
 let state:Record<string,any>={body:'',status:'Finding the right page…'},last=0,chain=Promise.resolve();
 const write=()=>{const data=JSON.stringify(state),now=Date.now();last=now;chain=chain.catch(()=>{}).then(async()=>{await database().prepare('INSERT INTO generation_progress(id,owner_id,data,expires) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,expires=excluded.expires WHERE owner_id=excluded.owner_id').bind(id,owner,data,now+600000).run();});};
 return {
  event(event:any){
   if(event.type==='start')state={...state,started:true,language:event.language,title:event.question,cancelToken:event.cancelToken};
   else if(event.type==='delta')state.body+=event.text;
   else if(event.type==='replace')state.body=event.text;
   else if(event.type==='status')state.status=event.message;
   else if(event.type==='metadata')state={...state,title:event.title,summary:event.summary,category:event.category,labels:event.labels};
   else if(event.type==='done')state={...state,done:true,pageId:event.page?.id,reused:!!event.reused,question:event.question};
   else if(event.type==='error')state={...state,error:event.message};
   if(Date.now()-last>500||['start','metadata','done','error'].includes(event.type))write();
  },
  async finish(){write();await chain.catch(()=>{});},
 };
}
