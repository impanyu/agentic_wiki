import {classifyAmbiguity,indexAnswer} from '@/app/disambiguation';
import {spawnAgent,recordAction,askAgent,type Agent} from '@/app/components-registry/agents';
import type {AgentContext,Component} from '@/app/components-registry/registry';
import {composeChart} from '@/app/components-registry/chart-composer';
import {composeChat} from '@/app/templates/chat-composer';
import {composePageProgram} from './composer';
import {research,parseConversion,converterDefinition,type ResearchUpdate} from '@/app/api/ask/ai';
import {composeConverter} from '@/app/components-registry/composer';
import {sandboxStatus} from '@/app/sandboxes/service';
import type {TemplateId} from '@/app/templates/catalog';
import type {DynamicConfig} from '@/app/dynamic/units';
import type {AnswerPage} from '@/app/page-types';

export type GenerationBrief={question:string;templateId:TemplateId;fresh:boolean;route?:string;service?:string};
type Definition={title:string;summary:string;config:DynamicConfig;parameters:Record<string,string|number|boolean|null>;components:{role:string;component:Component}[];body?:string;sources?:AnswerPage['sources']};
export async function generateContext(brief:GenerationBrief,context:AgentContext,router:Agent,emit:((event:ResearchUpdate)=>void)|undefined,signal:AbortSignal){
 const generator=await spawnAgent(['wiki-v1','disambiguation-v1'].includes(brief.templateId)?'content-generation':'app-generation',context.ownerId,router);
 const generationContext={...context,agent:generator};
 await recordAction(router,'Hand off context generation',{agentId:generator.id,...brief});
 await recordAction(generator,'Generation brief',brief);
 let templateId=brief.templateId,definition:Definition|undefined;
 let implementation:string=brief.route==='session'?'chat':templateId;
 if(brief.route==='session')templateId='chat-v1';
 if(brief.route!=='session'&&!['wiki-v1','disambiguation-v1'].includes(templateId)){
  const plan=await askAgent(generator,'Choose how to create this context from its intent. You may use a pre-coded app for common tasks or commission a generated Python/JavaScript backend that combines available tools. files for simple file/folder browsing; chart for a researched fixed numerical chart; converter for physical units; chat for open-ended conversation or clarification; program for custom logic, multi-step data retrieval, or a composed app. Never force every request into a known app. Generated programs can call storage, external APIs, context search, running-job listing, research and LLM tools and render a pre-coded template. If isolated execution is unavailable, choose an appropriate registered app when it fulfills the request, otherwise chat as a working fallback that explains missing capabilities. Preserve explicit requested output. Return the implementation and most suitable template.',{...brief,execution:sandboxStatus(context.userId)},{type:'object',additionalProperties:false,properties:{implementation:{type:'string',enum:['files','chart','converter','chat','program']},templateId:{type:'string',enum:['files-v1','dashboard-v1','table-v1','form-v1','chat-v1']}},required:['implementation','templateId']},signal);
  implementation=plan.implementation;templateId=plan.templateId;
 }

 if(brief.service==='context_pages'||brief.service==='user_jobs'){
  const jobs=brief.service==='user_jobs',zh=context.language.startsWith('zh');
  templateId='wiki-v1';
  definition={title:jobs?(zh?'运行中的任务':'Running tasks'):(zh?'我的页面索引':'My page index'),summary:jobs?(zh?'你当前运行的任务和沙箱。':'Your currently running tasks and sandboxes.'):(zh?'按当前条件检索你创建的页面。':'Your saved pages matching the current filters.'),config:{template:'context-index-v1',executor:'context-index-v1',indexKind:jobs?'jobs':'pages',version:1,capability:'application',labels:{overview:'',invalid:'Could not load contexts.'} as DynamicConfig['labels'],inputFields:jobs?[]:[{name:'page_kind',type:'string',description:'static for wiki pages, dynamic for apps or chat, all if unspecified.',required:false},{name:'topic_terms',type:'string',description:'JSON array of concise synonymous topic keywords, including English and Chinese translations where useful. Only for an explicitly requested topic; [] if no topic filter.',required:false}]},parameters:{},components:[]};
  return {templateId,definition,answer:{title:definition.title,summary:definition.summary,body:'',category:zh?'索引':'Index',sources:[],labels:{overview:''}}};
 }
 if(templateId==='disambiguation-v1'){
  const index=await classifyAmbiguity(brief.question,context.language,generator,true);
  return {answer:indexAnswer(index),definition,templateId};
 }
 if(templateId==='wiki-v1'){
  const answer=await research(brief.question,context.language,emit,signal,brief.fresh);
  await recordAction(generator,'Compose researched article',{title:answer.title,sources:answer.sources});
  return {answer,definition,templateId};
 }
 if(implementation==='files'){
  templateId='files-v1';
  // Registered storage adapters run as the visiting user; no generated code or sandbox is needed.
  definition=await composeChat(brief.question,generationContext,generator,signal);
  definition.config={...definition.config,template:'file-browser-v1',executor:'registered-file-browser-v1',inputFields:[{name:'provider',type:'string',description:'Storage provider ID: google, dropbox, or onedrive.',required:false},{name:'parent',type:'string',description:'Explicit folder ID or root. Never invent an ID from a folder name.',required:false},{name:'search',type:'string',description:'Explicit file or folder name to search for in the current listing.',required:false}]};
 }else if(implementation==='chat'){templateId='chat-v1';definition=await composeChat(brief.question,generationContext,generator,signal);}
 else if(implementation==='chart'){if(!['dashboard-v1','table-v1'].includes(templateId))templateId='dashboard-v1';definition=await composeChart(brief.question,generationContext,generator,signal);}
 else {
  const conversion=implementation==='converter'?await parseConversion(brief.question):null;
  if(conversion?.intent==='unit_conversion'){
   templateId='form-v1';
   const converter=await converterDefinition(context.language);
   definition={...converter,components:await composeConverter(converter.config,generationContext),parameters:conversion.input||{}};
  }else{
   const execution=sandboxStatus(context.userId);
   if(execution.configured&&execution.allowed)definition=await composePageProgram(brief.question,templateId,generationContext,generator,signal);
   else {
    templateId='chat-v1';
    await recordAction(generator,'Use conversation fallback',{requestedTemplate:brief.templateId,reason:'Custom execution is unavailable; continue the task with the session agent and available tools.'});
    definition=await composeChat(brief.question,generationContext,generator,signal);
   }
  }
 }
 if(!definition)throw new Error('Context generation did not return a definition.');
 await recordAction(generator,'Created context definition',{templateId,executor:definition.config.executor});
 return {templateId,definition,answer:{title:definition.title,summary:definition.summary,body:definition.body||'',category:context.language.startsWith('zh')?'工作空间':'Workspace',sources:definition.sources||[],labels:{overview:definition.config.labels.overview}}};
}
