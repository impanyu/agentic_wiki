import {canWritePage} from '@/app/page-permissions';
import {database,getPage} from '@/db/store';
import {getComponent} from '@/app/components-registry/registry';
import {fileContext,listContextFiles,type FilePart} from '@/app/context-files/server';
import type {Agent} from '@/app/agents/runtime';
export const pageContextTool={type:'function',name:'read_page_context',description:'Read this page, its app code, any historical chat messages, or uploaded files. History supports keyword search and pagination over the entire saved history. Files lists all accessible attachments; file reads a selected attachment. Only this page and the current user permissions are available.',strict:true,parameters:{type:'object',additionalProperties:false,properties:{resource:{type:'string',enum:['page','code','history','files','file']},query:{type:'string'},before:{type:['integer','null']},fileId:{type:['string','null']}},required:['resource','query','before','fileId']}};
export async function readPageContext(agent:Agent,args:{resource:string;query?:string;before?:number|null;fileId?:string|null},scopedPageId?:string):Promise<{data:unknown;parts?:FilePart[]}>{
 const pageId=scopedPageId||agent.role.replace(/^(comments|page):/,'');
 if(pageId===agent.role)throw Error('Page context is unavailable.');
 const page=await getPage(pageId,agent.ownerId);if(!page)throw Error('Page context is inaccessible.');
 if(args.resource==='page')return {data:{title:page.title,summary:page.summary,body:page.body,sources:page.sources,definition:page.dynamic}};
 if(args.resource==='files')return {data:await listContextFiles(page.id,agent.ownerId)};
 if(args.resource==='file'){
  if(!args.fileId)throw Error('Choose a file ID from the page file list.');
  const result=await fileContext(page.id,agent.ownerId,[args.fileId]);return {data:result.metadata,parts:result.parts};
 }
 if(args.resource==='code'){
  const code=[];
  for(const [role,ref] of Object.entries(page.dynamic?.components||{})){
   if(!ref)continue;
   const component=await getComponent(ref,{userId:agent.ownerId});
   if(['backend_code','frontend_template','workflow'].includes(component.type))code.push({role,type:component.type,title:component.title,payload:JSON.parse(component.payload)});
  }
  return {data:{definition:page.dynamic,code}};
 }
 if(args.resource!=='history')throw Error('Unknown context resource.');
 const before=args.before??Number.MAX_SAFE_INTEGER;if(!Number.isSafeInteger(before)||before<1)throw Error('Invalid history cursor.');
 const query=String(args.query||'').slice(0,500);
 const result=page.kind==='static'?await database().prepare('SELECT sequence,author_name author,message,reply,created_at FROM wiki_comments WHERE page_id=? AND sequence<? AND (?=\'\' OR instr(lower(message||char(10)||reply),lower(?))>0) ORDER BY sequence DESC LIMIT 31').bind(page.id,before,query,query).all():await database().prepare('SELECT t.sequence,t.message,t.reply,t.created_at FROM page_chat_turns t JOIN agent_instances a ON a.id=t.session_id WHERE a.role=? AND a.owner_id=? AND t.sequence<? AND (?=\'\' OR instr(lower(t.message||char(10)||t.reply),lower(?))>0) ORDER BY t.sequence DESC LIMIT 31').bind('page:'+page.id,agent.ownerId,before,query,query).all();
 const rows=result.results as {sequence:number}[];return {data:{messages:rows.slice(0,30).reverse(),before:rows.length>30?rows[29].sequence:null}};
}
