import {spawnAgent,recordAction,askAgent,type Agent} from '@/app/agents/runtime';
import type {AgentContext} from '@/app/components-registry/registry';
import type {TemplateId} from '@/app/templates/catalog';
import {output,type ResearchUpdate} from '@/app/api/ask/ai';
import {codeSchema} from '@/app/sandboxes/contracts';
import {runProgram} from '@/app/sandboxes/service';
import {validateGenerationDraft,materializeGenerationDraft,type GenerationDraft} from './generation-draft';
import {generationInstructions} from './generation-instructions';
import {generationContract} from './generation-contracts';
export type GenerationBrief={question:string;templateId:TemplateId;fresh:boolean;route?:string;service?:string};
const fn=(name:string,description:string,properties:Record<string,unknown>)=>({type:'function',name,description,strict:true,parameters:{type:'object',additionalProperties:false,properties,required:Object.keys(properties)}});
const tools=[fn('read_generation_contract','Read artifact formats. Choose only the format you need.',{kind:{type:'string',enum:['program','chart','form','converter','custom_style']}}),fn('validate_page_draft','Validate a draft without saving it. Returns concrete structural errors; does not judge factual accuracy.',{draftJson:{type:'string'}}),fn('test_page_program','Test generated JavaScript or Python in the configured isolated sandbox. No network or server secrets; no page is saved.',{programJson:{type:'string'},inputJson:{type:'string'}})];
export async function generateContext(brief:GenerationBrief,context:AgentContext,router:Agent,emit:((event:ResearchUpdate)=>void)|undefined,signal:AbortSignal){
 const generator=await spawnAgent('content-generation',context.ownerId,router),ctx={...context,agent:generator};
 let draft:GenerationDraft|undefined,searched=false;
 emit?.({type:'status',message:context.language.startsWith('zh')?'生成器正在处理请求…':'The generator is working on your request…'});
 await askAgent(generator,generationInstructions,{question:brief.question,language:context.language,initialRoutingHint:brief,sourceDocument:context.sourceDocument,visibility:context.visibility,asOf:new Date().toISOString()},{type:'object',additionalProperties:false,properties:{draftJson:{type:'string'}},required:['draftJson']},signal,undefined,[],{
  context:ctx,extraTools:tools,
  executeExtra:async(name,args)=>{
   if(name==='read_generation_contract')return {data:generationContract(args.kind)};
   if(name==='test_page_program')return {data:await runProgram(codeSchema.parse(JSON.parse(args.programJson)),JSON.parse(args.inputJson),ctx)};
   if(name==='validate_page_draft'){try{validateGenerationDraft(JSON.parse(args.draftJson),brief.question,ctx,true);return {data:{valid:true,note:'Structural validation only; factual claims still require consulted evidence.'}};}catch(e){return {data:{valid:false,error:e instanceof Error?e.message:'Invalid draft'}};}}
   throw Error('Unknown generation tool.');
  },
  onEvent:e=>{if(e.kind==='tool_started')emit?.({type:'status',message:context.language.startsWith('zh')?'生成器正在使用工具…':'The generator is using a tool…'});if(e.kind==='validation_failed')emit?.({type:'status',message:context.language.startsWith('zh')?'生成器正在修正草稿…':'The generator is correcting its draft…'});},
  validateFinal:async(response,trace)=>{
   searched ||= trace.webSearched;
   try{draft=validateGenerationDraft(JSON.parse(JSON.parse(output(response)).draftJson),brief.question,ctx,searched);}catch(e){return e instanceof Error?e.message:'Invalid page draft';}
  }
 });
 if(!draft)throw Error('INCOMPLETE_ANSWER');
 const result=await materializeGenerationDraft(draft,ctx);
 emit?.({type:'metadata',title:result.answer.title,summary:result.answer.summary,category:result.answer.category,labels:{overview:draft.labels.overview,contents:draft.labels.contents||'',sources:draft.labels.sources||''}});
 if(result.answer.body)emit?.({type:'replace',text:result.answer.body});
 await recordAction(generator,'Completed page draft',{kind:draft.kind,title:draft.title});
 return {...result,generatorId:generator.id,generationIntent:draft.intent};
}
