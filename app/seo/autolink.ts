import type {Queryable} from '@/app/entity-db/client';
import {entityPath} from './assemble';
// Wikipedia-style links in running text: a mention of an entity that has its own page (a country, city, company,
// brand, person…) links to it. Names come from the entities with pages (names and aliases of 4+ characters, unique
// across types), matched longest-first on word boundaries; the first mention in each text links, never the page's
// own entity. Only proper-name mentions link: the words must be written as the name is (case included: "connected"
// is not the film "Connected"), and a mention that is only part of a longer name ("Street" in "Saint Jacques
// Street") does not link. The name index is rebuilt every 10 minutes.
type Part={text:string;href?:string};
let index:{at:number;names:Map<string,string>;forms:Map<string,Set<string>>;maxWords:number}|null=null;let loading:Promise<void>|null=null;
const norm=(s:string)=>s.toLowerCase().normalize('NFKC');
async function build(db:Queryable){
 const rows=(await db.query<{type:string;name:string;num:string;aliases:string[]}>(`select type, name, num::text, aliases from entities where has_page limit 300000`)).rows;
 const seen=new Map<string,string|null>(),forms=new Map<string,Set<string>>();let maxWords=1;
 for(const r of rows){const href=entityPath(r.type,r.name,r.num);
  for(const n of [r.name,...(r.aliases||[]).slice(0,5)]){const o=String(n||'').trim().replace(/\s+/g,' '),k=norm(o);if(k.length<4||/^\d+$/.test(k))continue;
   // A name written all in lower case is a common word, not a proper name.
   if(!/\p{Lu}/u.test(o))continue;
   seen.set(k,seen.has(k)&&seen.get(k)!==href?null:href);(forms.get(k)??forms.set(k,new Set()).get(k)!).add(o);maxWords=Math.max(maxWords,Math.min(6,k.split(/\s+/).length));}}
 const names=new Map<string,string>();for(const [k,v] of seen)if(v)names.set(k,v);
 index={at:Date.now(),names,forms,maxWords};
}
async function ready(db:Queryable){
 if(index&&Date.now()-index.at<600_000)return index;
 if(!loading)loading=build(db).catch(()=>{}).finally(()=>{loading=null;});
 if(!index)await loading;return index;
}
// Splits plain (unlinked) parts at entity mentions; parts that already link stay as they are.
const upper=(t:string|undefined)=>!!t&&/^\p{Lu}/u.test(t);
// A word that opens its text or a sentence is capitalized for that reason alone.
const sentenceStart=(text:string,at:number)=>{const b=text.slice(0,at).trimEnd();return !b||/[.!?:;"“(]$/.test(b);};
export function linkParts(parts:Part[],names:Map<string,string>,maxWords:number,self:string,used:Set<string>,forms?:Map<string,Set<string>>):Part[]{
 const out:Part[]=[];
 for(const p of parts){
  if(p.href||!p.text){out.push(p);continue;}
  const tokens=[...p.text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’.&-]*/gu)];let cursor=0;let i=0;
  while(i<tokens.length){
   let hit:{end:number;href:string;len:number}|null=null;
   for(let w=Math.min(maxWords,tokens.length-i);w>=1&&!hit;w--){
    const start=tokens[i].index!,last=tokens[i+w-1],end=last.index!+last[0].length;
    const raw=p.text.slice(start,end).replace(/[.,]$/,''),k=norm(raw);const href=names.get(k);
    if(!href||href===self||used.has(href))continue;
    // Written as the name is written (case included).
    if(forms&&!forms.get(k)?.has(raw.replace(/\s+/g,' ')))continue;
    // Not a piece of a longer capitalized name: the words right before and after (only a space between) are not capitalized.
    const prev=tokens[i-1],next=tokens[i+w];
    if(forms&&prev&&/^\s+$/.test(p.text.slice(prev.index!+prev[0].length,start))&&upper(prev[0])&&!sentenceStart(p.text,prev.index!))continue;
    if(forms&&next&&/^\s+$/.test(p.text.slice(start+raw.length,next.index!))&&upper(next[0]))continue;
    hit={end:start+raw.length,href,len:w};
   }
   if(hit){const start=tokens[i].index!;if(start>cursor)out.push({text:p.text.slice(cursor,start)});out.push({text:p.text.slice(start,hit.end),href:hit.href});used.add(hit.href);cursor=hit.end;i+=hit.len;}
   else i++;
  }
  if(cursor<p.text.length)out.push({text:p.text.slice(cursor)});
 }
 return out;
}
export async function autolinker(db:Queryable,self:string){
 const ix=await ready(db).catch(()=>null);const used=new Set<string>();
 return (parts:Part[])=>ix?linkParts(parts,ix.names,ix.maxWords,self,used,ix.forms):parts;
}
