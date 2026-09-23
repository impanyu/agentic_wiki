// In-flight page-agent turns, per page and user, so a reader who leaves the page
// and comes back can watch the reply that is still being generated.
type Running={message:string;reply:string;startedAt:string;activity:string[]};
const turns=new Map<string,Running>();
const key=(pageId:string,userId:string)=>pageId+'\n'+userId;
export function runningTurn(pageId:string,userId:string){return turns.get(key(pageId,userId))||null;}
export function trackTurn(pageId:string,userId:string,message:string){
 const k=key(pageId,userId),entry:Running={message,reply:'',startedAt:new Date().toISOString(),activity:[]};turns.set(k,entry);
 return {event(event:unknown){const e=event as {type?:string;text?:unknown};if(e?.type==='reply'&&typeof e.text==='string')entry.reply=e.text;const m=(event as {message?:unknown}).message;if(e?.type==='activity'&&typeof m==='string'){entry.activity.push(m);if(entry.activity.length>40)entry.activity.shift();}},async finish(){if(turns.get(k)===entry)turns.delete(k);}};
}
