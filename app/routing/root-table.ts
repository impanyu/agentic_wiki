import {getPage} from '@/db/store';
import {matchByProfile} from './profiles';
import {recordAction,type Agent} from '@/app/agents/runtime';
import {storagePageMismatch} from '@/app/storage/page-scope';
type Intent={route:'wiki'|'app';kind:'article'|'application'|'chart';service:'none';fresh:boolean};
// One router compares the request with the profiles (what each page covers or each app does) of
// every page it may open; wiki pages and apps compete in the same top five.
export async function resolveRootRoute(question:string,vector:number[],language:string,userId:string,agent:Agent,signal?:AbortSignal,skipMatch=false,excludePageId?:string){
 const id=skipMatch?null:await matchByProfile(question,vector,language,userId,agent,signal,excludePageId);
 const page=id?await getPage(id,userId):null;
 if(page&&!storagePageMismatch(question,page)){
  const intent:Intent={route:page.kind==='dynamic'?'app':'wiki',kind:page.kind==='dynamic'?(page.dynamic?.capability==='chart'?'chart':'application'):'article',service:'none',fresh:page.kind!=='dynamic'&&/\b(latest|current|currently|today|tonight|now|recent|price|weather|news)\b|最新|目前|今天|现在|当前|实时/i.test(question)};
  await recordAction(agent,'Route to existing page',{question,pageId:page.id,pageType:intent.route});
  return {intent,pageId:page.id};
 }
 await recordAction(agent,'Hand off new page to generator',{question});
 return {intent:null,pageId:null};
}
