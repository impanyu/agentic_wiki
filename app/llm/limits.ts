// Live per-model rate tracking: sliding-minute RPM/TPM, daily RPD with the provider's reset
// time, concurrency slots and 429 cooldowns. In-process only (one server process per VM).
import type {ModelEntry} from './catalog';

const pacificDate=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'});
export function dayKey(now:number,reset:'utc'|'pacific'='utc'){return reset==='pacific'?pacificDate.format(new Date(now)):new Date(now).toISOString().slice(0,10);}
// First instant after `now` whose day key differs (handles DST without a timezone library).
export function nextDayReset(now:number,reset:'utc'|'pacific'='utc'){
 if(reset==='utc'){const d=new Date(now);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()+1);}
 const today=dayKey(now,reset);let t=Math.floor(now/3600000)*3600000;
 while(dayKey(t,reset)===today)t+=3600000;
 let lo=t-3600000,hi=t;while(hi-lo>1000){const mid=Math.floor((lo+hi)/2);if(dayKey(mid,reset)===today)lo=mid;else hi=mid;}
 return Math.ceil(hi/1000)*1000;
}
export function monthKey(now:number){return new Date(now).toISOString().slice(0,7);}
export function nextMonth(now:number){const d=new Date(now);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1);}

type State={window:{t:number;tokens:number}[];day:string;dayCount:number;active:number;cooldownUntil:number;cooldownReason:string};
export type Block={reason:string;retryAt:number};
export class RateTracker{
 private states=new Map<string,State>();
 constructor(private now:()=>number=Date.now){}
 private state(entry:ModelEntry){
  let s=this.states.get(entry.id);if(!s){s={window:[],day:'',dayCount:0,active:0,cooldownUntil:0,cooldownReason:''};this.states.set(entry.id,s);}
  const now=this.now(),day=dayKey(now,entry.limits.dayReset);
  if(s.day!==day){s.day=day;s.dayCount=0;}
  s.window=s.window.filter(w=>w.t>now-60000);
  return s;
 }
 // Why this model cannot take a request of ~tokens right now, or null when it can.
 blocked(entry:ModelEntry,tokens=0):Block|null{
  const s=this.state(entry),now=this.now(),l=entry.limits;
  if(s.cooldownUntil>now)return {reason:'cooldown:'+s.cooldownReason,retryAt:s.cooldownUntil};
  if(l.rpd&&s.dayCount>=l.rpd)return {reason:'rpd',retryAt:nextDayReset(now,l.dayReset)};
  if(l.rpm&&s.window.length>=l.rpm)return {reason:'rpm',retryAt:s.window[0].t+60000};
  if(l.tpm&&s.window.length&&s.window.reduce((n,w)=>n+w.tokens,0)+tokens>l.tpm)return {reason:'tpm',retryAt:s.window[0].t+60000};
  if(l.concurrency&&s.active>=l.concurrency)return {reason:'concurrency',retryAt:now+250};
  return null;
 }
 acquire(entry:ModelEntry,tokens:number){
  const s=this.state(entry),slot={t:this.now(),tokens};s.window.push(slot);s.dayCount++;s.active++;
  let released=false;
  return (actualTokens?:number)=>{if(released)return;released=true;s.active=Math.max(0,s.active-1);if(typeof actualTokens==='number')slot.tokens=actualTokens;};
 }
 cooldown(entry:ModelEntry,ms:number,reason:string){
  const s=this.state(entry),until=this.now()+ms;if(until>s.cooldownUntil){s.cooldownUntil=until;s.cooldownReason=reason;}
 }
 exhaustDay(entry:ModelEntry){const s=this.state(entry);this.cooldown(entry,nextDayReset(this.now(),entry.limits.dayReset)-this.now(),'daily quota');s.dayCount=Math.max(s.dayCount,entry.limits.rpd||s.dayCount);}
 snapshot(){return Object.fromEntries([...this.states].map(([id,s])=>[id,{rpmUsed:s.window.length,tokensLastMinute:s.window.reduce((n,w)=>n+w.tokens,0),today:s.dayCount,active:s.active,cooldownUntil:s.cooldownUntil?new Date(s.cooldownUntil).toISOString():null,cooldownReason:s.cooldownReason||null}]));}
}
// Retry-After is seconds or an HTTP date.
export function retryAfterMs(header:string|null|undefined,now:number){
 if(!header)return null;
 const seconds=Number(header);if(Number.isFinite(seconds))return Math.max(0,seconds*1000);
 const date=Date.parse(header);return Number.isFinite(date)?Math.max(0,date-now):null;
}
