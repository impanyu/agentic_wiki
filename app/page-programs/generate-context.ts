import {partialJsonString} from '@/app/chat/partial-json';
import {indexGenerationPolicy} from '@/app/disambiguation/graph';
import {spawnAgent,recordAction,askAgent,type Agent} from '@/app/agents/runtime';
import type {AgentContext} from '@/app/components-registry/registry';
import type {TemplateId} from '@/app/templates/catalog';
import {output,type ResearchUpdate} from '@/app/api/ask/ai';
import {codeSchema} from '@/app/sandboxes/contracts';
import {runProgram} from '@/app/sandboxes/service';
import {validateGenerationDraft,materializeGenerationDraft,type GenerationDraft} from './generation-draft';
import {generationInstructions} from './generation-instructions';
import {generationContract} from './generation-contracts';
export type GenerationBrief={question:string;templateId?:TemplateId;fresh?:boolean;route?:string;service?:string};
const fn=(name:string,description:string,properties:Record<string,unknown>)=>({type:'function',name,description,strict:true,parameters:{type:'object',additionalProperties:false,properties,required:Object.keys(properties)}});
const tools=[fn('read_generation_contract','Read artifact formats. Choose only the format you need.',{kind:{type:'string',enum:['program','chart','form','converter','custom_style']}}),fn('validate_page_draft','Validate a draft without saving it. Returns concrete structural errors; does not judge factual accuracy.',{draftJson:{type:'string'}}),fn('test_page_program','Test generated JavaScript or Python in the configured isolated sandbox. No network or server secrets; no page is saved.',{programJson:{type:'string'},inputJson:{type:'string'}})];
export async function generateContext(brief:GenerationBrief,context:AgentContext,router:Agent,emit:((event:ResearchUpdate)=>void)|undefined,signal:AbortSignal){
 const indexPolicy=await indexGenerationPolicy(brief.question,context.userId);
 context={...context,indexLeafRequired:indexPolicy.leafRequired};
 const generator=await spawnAgent('content-generation',context.ownerId,router),ctx={...context,agent:generator};
 let draft:GenerationDraft|undefined,searched=false,dataConsulted=false,lastPreview=0;
 const checkedDrafts=new Map<string,GenerationDraft>();
 emit?.({type:'status',message:context.language.startsWith('zh')?'生成器正在处理请求…':'The generator is working on your request…'});
 const preview=(text:string)=>{
   if(!emit||Date.now()-lastPreview<100)return;
   const json=partialJsonString(text,'draftJson');if(!json||json.startsWith('draft:'))return;
   const title=partialJsonString(json,'title'),body=partialJsonString(json,'body');
   if(title!==undefined){lastPreview=Date.now();emit({type:'metadata',title,summary:partialJsonString(json,'summary')||'',category:partialJsonString(json,'category')||'',labels:{overview:'',contents:'',sources:''}});}
   if(body!==undefined){lastPreview=Date.now();emit({type:'replace',text:body});}
  };
 await askAgent(generator,generationInstructions,{question:brief.question,language:context.language,sourceDocument:context.sourceDocument,visibility:context.visibility,indexLeafRequired:context.indexLeafRequired,asOf:new Date().toISOString()},{type:'object',additionalProperties:false,properties:{draftJson:{type:'string'}},required:['draftJson']},signal,undefined,[],{
  context:ctx,extraTools:tools,
  onOutputText:preview,onToolArguments:(name,text)=>{if(name==='validate_page_draft')preview(text);},
  executeExtra:async(name,args)=>{
   if(name==='read_generation_contract')return {data:generationContract(args.kind)};
   if(name==='test_page_program')return {data:await runProgram(codeSchema.parse(JSON.parse(args.programJson)),JSON.parse(args.inputJson),ctx)};
   if(name==='validate_page_draft'){try{const checked=validateGenerationDraft(JSON.parse(args.draftJson),brief.question,ctx,true);if(checked.kind==='disambiguation')indexPolicy.validate(checked.entries!);const draftRef='draft:'+crypto.randomUUID();if(checkedDrafts.size>=16)checkedDrafts.delete(checkedDrafts.keys().next().value!);checkedDrafts.set(draftRef,checked);return {data:{valid:true,draftRef,note:'Structural validation only; factual claims still require consulted evidence.'}};}catch(e){return {data:{valid:false,error:e instanceof Error?e.message:'Invalid draft'}};}}
   throw Error('Unknown generation tool.');
  },
  onEvent:e=>{if(e.kind==='tool_finished'){const d=e.data as {tool:string;result:any};if(['call_connector','storage_execute','read_uploaded_file','execute_api','execute_code'].includes(d.tool)&&d.result&&!d.result.error&&!d.result.confirmationRequired)dataConsulted=true;}if(e.kind==='tool_started')emit?.({type:'status',message:context.language.startsWith('zh')?'生成器正在使用工具…':'The generator is using a tool…'});if(e.kind==='validation_failed')emit?.({type:'status',message:context.language.startsWith('zh')?'生成器正在修正草稿…':'The generator is correcting its draft…'});},
  validateFinal:async(response,trace)=>{
   searched ||= trace.webSearched;
   try{const encoded=JSON.parse(output(response)).draftJson;const raw=typeof encoded==='string'&&encoded.startsWith('draft:')?checkedDrafts.get(encoded):JSON.parse(encoded);if(!raw)throw Error('Unknown draft reference. Submit the complete draft or a reference returned in this run.');draft=validateGenerationDraft(raw,brief.question,ctx,searched,dataConsulted);if(draft.kind==='disambiguation')indexPolicy.validate(draft.entries!);}catch(e){return e instanceof Error?e.message:'Invalid page draft';}
  }
 });
 if(!draft)throw Error('INCOMPLETE_ANSWER');
 const result=await materializeGenerationDraft(draft,ctx);
 emit?.({type:'metadata',title:result.answer.title,summary:result.answer.summary,category:result.answer.category,labels:{overview:draft.labels.overview,contents:draft.labels.contents||'',sources:draft.labels.sources||''}});
 if(result.answer.body)emit?.({type:'replace',text:result.answer.body});
 await recordAction(generator,'Completed page draft',{kind:draft.kind,title:draft.title});
 return {...result,generatorId:generator.id,generationIntent:draft.intent};
}
