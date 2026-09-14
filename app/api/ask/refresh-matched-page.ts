import type {AnswerPage} from '@/app/page-types';
import {articleNodes} from '@/app/internal-links';
import {database,getPage,lock,unlock} from '@/db/store';
import {reviewAnswer} from './answer-quality';
import {research} from './ai';
import {recordAction,spawnAgent,type Agent} from '@/app/components-registry/agents';

export function needsReview(page:AnswerPage,fresh:boolean,now=Date.now()){
 if(!page.owned||page.kind!=='static'||page.labels?.templateId==='disambiguation-v1')return false;
 if(fresh)return true;
 const checked=Date.parse(page.checkedAt||page.updatedAt||page.createdAt);
 return !Number.isFinite(checked)||now-checked>30*24*60*60*1000;
}
// Keep destinations; only reposition the highlights whose text still exists.
export function relocateQuote(quote:string,old:{node:string;start:number;end:number}[],page:{title:string;summary:string;body:string}){
 const nodes=articleNodes(page),compact=(s:string)=>s.replace(/\s/g,'');
 if(old.length&&compact(old.map(s=>nodes.get(s.node)?.slice(s.start,s.end)||'').join(''))===compact(quote))return old;
 const chars:{node:string;offset:number;char:string}[]=[];
 for(const [node,text] of nodes)for(let offset=0;offset<text.length;offset++)if(!/\s/.test(text[offset]))chars.push({node,offset,char:text[offset]});
 const text=chars.map(c=>c.char).join(''),needle=compact(quote),start=text.indexOf(needle);
 if(!needle||start<0||text.indexOf(needle,start+1)>=0)return [];
 const segments:{node:string;start:number;end:number}[]=[];
 for(const c of chars.slice(start,start+needle.length)){const last=segments.at(-1);if(last?.node===c.node)last.end=c.offset+1;else segments.push({node:c.node,start:c.offset,end:c.offset+1});}
 return segments;
}

export async function refreshMatchedPage(page:AnswerPage,question:string,fresh:boolean,userId:string,agent:Agent){
 if(!needsReview(page,fresh))return page;
 const lease=await lock('refresh:'+page.id,180000);if(!lease)return page;
 try{
  const current=await getPage(page.id,userId);if(!current||!needsReview(current,fresh))return current||page;
  const signal=AbortSignal.timeout(150000),verdict=await reviewAnswer(question,current,fresh,signal);
  await recordAction(agent,'Review matched page',{pageId:page.id,accepted:verdict.accepted,reason:verdict.reason});
  if(verdict.accepted){await database().prepare("UPDATE pages SET checked_at=? WHERE id=? AND owner_id=?").bind(new Date().toISOString(),page.id,userId).run();return current;}
  const generator=await spawnAgent('content-update',userId,agent);
  await recordAction(agent,'Hand off content update',{agentId:generator.id,pageId:page.id,question});
  const answer=await research(current.question||question,current.language,undefined,signal,fresh);
  await recordAction(generator,'Research page revision',{pageId:page.id,title:answer.title,sources:answer.sources});
  const now=new Date().toISOString();
  const links=await database().prepare('SELECT id,quote,segments FROM internal_links WHERE source_id=?').bind(page.id).all<{id:string;quote:string;segments:string}>();
  await database().batch([
   database().prepare(`UPDATE pages SET title=?,summary=?,body=?,category=?,sources=?,labels=?,updated_at=?,checked_at=? WHERE id=? AND owner_id=? AND kind='static' AND EXISTS(SELECT 1 FROM generation_locks WHERE token=? AND expires>?)`).bind(answer.title,answer.summary,answer.body,answer.category,JSON.stringify(answer.sources),JSON.stringify({...current.labels,...answer.labels}),now,now,page.id,userId,lease,Date.now()),
   ...links.results.map(l=>database().prepare('UPDATE internal_links SET segments=? WHERE id=? AND EXISTS(SELECT 1 FROM pages WHERE id=? AND owner_id=? AND updated_at=?)').bind(JSON.stringify(relocateQuote(l.quote,JSON.parse(l.segments),answer)),l.id,page.id,userId,now)),
  ]);
  await recordAction(agent,'Update matched page in place',{pageId:page.id});
  return await getPage(page.id,userId)||current;
 }catch(e){await recordAction(agent,'Keep saved page after refresh failure',{pageId:page.id,error:e instanceof Error?e.message.slice(0,120):'Refresh failed'});return page;}
 finally{await unlock(lease);}
}
