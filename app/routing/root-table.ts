import {getPage} from '@/db/store';
import {matchQuestion} from '@/app/api/ask/question-search';
import {recordAction,type Agent} from '@/app/agents/runtime';
import {storagePageMismatch} from '@/app/storage/page-scope';
type Intent={route:'wiki'|'app';kind:'article'|'application'|'chart';service:'none';fresh:boolean};
// One router searches one accessible question pool. Legacy routing tables are
// not consulted: wiki pages, apps and chat workspaces compete in the same top five.
export async function resolveRootRoute(question:string,vector:number[],language:string,userId:string,agent:Agent,signal?:AbortSignal,skipMatch=false){
 const id=skipMatch?null:await matchQuestion(question,vector,language,userId,agent,signal);
 const page=id?await getPage(id,userId):null;
 if(page&&!storagePageMismatch(question,page)){
  const intent:Intent={route:page.kind==='dynamic'?'app':'wiki',kind:page.kind==='dynamic'?(page.dynamic?.capability==='chart'?'chart':'application'):'article',service:'none',fresh:page.kind!=='dynamic'&&/\b(latest|current|currently|today|tonight|now|recent|price|weather|news)\b|最新|目前|今天|现在|当前|实时/i.test(question)};
  await recordAction(agent,'Route to existing page',{question,pageId:page.id,pageType:intent.route});
  return {intent,pageId:page.id};
 }
 await recordAction(agent,'Hand off new page to generator',{question});
 return {intent:null,pageId:null};
}
