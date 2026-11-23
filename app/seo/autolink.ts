import type {Queryable} from '@/app/entity-db/client';
import {entityPath} from './assemble';
// Wikipedia-style links in running text: a mention of an entity that has its own page (a country, city, company,
// brand, person…) links to it. Names come from the entities with pages (names and aliases of 4+ characters, unique
// across types), matched longest-first on word boundaries; the first mention in each text links, never the page's
// own entity. The name index is rebuilt every 10 minutes.
type Part={text:string;href?:string};
let index:{at:number;names:Map<string,string>;maxWords:number}|null=null;let loading:Promise<void>|null=null;
const norm=(s:string)=>s.toLowerCase().normalize('NFKC');
async function build(db:Queryable){
 const rows=(await db.query<{type:string;name:string;num:string;aliases:string[]}>(`select type, name, num::text, aliases from entities where has_page limit 300000`)).rows;
 const seen=new Map<string,string|null>();let maxWords=1;
 for(const r of rows){const href=entityPath(r.type,r.name,r.num);
  for(const n of [r.name,...(r.aliases||[]).slice(0,5)]){const k=norm(String(n||'').trim());if(k.length<4||/^\d+$/.test(k))continue;
   seen.set(k,seen.has(k)&&seen.get(k)!==href?null:href);maxWords=Math.max(maxWords,Math.min(6,k.split(/\s+/).length));}}
 const names=new Map<string,string>();for(const [k,v] of seen)if(v)names.set(k,v);
 index={at:Date.now(),names,maxWords};
}
async function ready(db:Queryable){
 if(index&&Date.now()-index.at<600_000)return index;
 if(!loading)loading=build(db).catch(()=>{}).finally(()=>{loading=null;});
 if(!index)await loading;return index;
}
// Splits plain (unlinked) parts at entity mentions; parts that already link stay as they are.
export function linkParts(parts:Part[],names:Map<string,string>,maxWords:number,self:string,used:Set<string>):Part[]{
 const out:Part[]=[];
 for(const p of parts){
  if(p.href||!p.text){out.push(p);continue;}
  const tokens=[...p.text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’.&-]*/gu)];let cursor=0;let i=0;
  while(i<tokens.length){
   let hit:{end:number;href:string;len:number}|null=null;
   for(let w=Math.min(maxWords,tokens.length-i);w>=1&&!hit;w--){
    const start=tokens[i].index!,last=tokens[i+w-1],end=last.index!+last[0].length;
    const k=norm(p.text.slice(start,end).replace(/[.,]$/,''));const href=names.get(k);
    if(href&&href!==self&&!used.has(href))hit={end:start+k.length,href,len:w};
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
 return (parts:Part[])=>ix?linkParts(parts,ix.names,ix.maxWords,self,used):parts;
}
