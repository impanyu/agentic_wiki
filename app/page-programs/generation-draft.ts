import {z} from 'zod';
import {env} from '@/server/runtime';
import {generationIntentSchema} from './generation-intent';
import {normalizeCustomStyle} from './custom-style';
import {indexSchema,indexAnswer} from '@/app/disambiguation';
import {namedConnectors,pageStorageProviders,requestsDataResult} from '@/app/storage/page-scope';
import {codeSchema} from '@/app/sandboxes/contracts';
import {sandboxStatus} from '@/app/sandboxes/service';
import {inputFieldsSchema} from './inputs';
import {chartSchema,validateChartData} from '@/app/components-registry/chart-contracts';
import {formSchema,validateProgram,validateParameters,executeProgram,parametersSchema} from '@/app/components-registry/contracts';
import {createComponent,type AgentContext,type Component} from '@/app/components-registry/registry';
import type {DynamicConfig,ConverterLabels} from '@/app/dynamic/units';
import type {TemplateId} from '@/app/templates/catalog';
const source=z.object({title:z.string().min(1).max(500),url:z.string().url().refine(u=>/^https?:\/\//.test(u))});
const draftSchema=z.object({kind:z.enum(['article','disambiguation','chat','files','index','program','chart','form','converter','native']),title:z.string().min(1).max(200),summary:z.string().min(1).max(1200),body:z.string().max(40000).default(''),category:z.string().max(100).default(''),sources:z.array(source).max(40).default([]),labels:z.record(z.string().max(500)),intent:generationIntentSchema,entries:indexSchema.shape.entries.optional(),templateId:z.enum(['files-v1','dashboard-v1','table-v1','form-v1','chat-v1','geo-v1','data-tools-v1']).optional(),nativeApp:z.enum(['map','table','json','text','image','pdf','archive','hub']).optional(),program:codeSchema.optional(),inputFields:inputFieldsSchema.optional(),chart:z.unknown().optional(),dataset:z.unknown().optional(),form:formSchema.optional(),expression:z.unknown().optional(),examples:z.array(z.object({input:parametersSchema,output:parametersSchema})).max(4).optional(),parameters:parametersSchema.default({})}).strict();
export type GenerationDraft=z.infer<typeof draftSchema>;
export function validateGenerationDraft(raw:unknown,question:string,context:AgentContext,webSearched:boolean,dataConsulted=false){
 const d=draftSchema.parse(raw);
 if(d.intent.visualTheme==='custom')d.intent.visualDesign=normalizeCustomStyle(d.intent.visualDesign);
 const ambiguous=d.intent.needsDisambiguation||!d.intent.singleMeaningCertain||new Set(d.intent.interpretations.map(x=>x.trim().toLowerCase())).size>1;
 if(ambiguous&&d.kind!=='disambiguation'&&!context.sourceDocument&&!context.indexLeafRequired)throw Error('Multiple plausible interpretations require a disambiguation page.');
 if(d.kind==='disambiguation'){
  if(context.indexLeafRequired)throw Error('INDEX_DEPTH_LIMIT: create substantive content explaining the remaining meanings on this page; do not create another index.');
  const entries=d.entries||[],keys=entries.map(e=>e.question.trim().toLowerCase());
  if(entries.length<2||new Set(keys).size!==keys.length||keys.includes(question.trim().toLowerCase()))throw Error('An index needs distinct, unambiguous destinations, not the original query.');
  d.intent.needsDisambiguation=true;d.intent.singleMeaningCertain=false;d.intent.outputKind='article';
 }else if(d.kind==='article'){
  if(d.body.trim().length<80||!d.sources.length)throw Error('A reference article needs substantive content and cited sources.');
  if(!webSearched&&!context.sourceDocument)throw Error('Research the reference subject with web search before finalizing factual content.');
  if(context.sourceDocument&&!d.body.includes(context.sourceDocument.url))throw Error('Identify and cite the supplied document URL in the article.');
  d.intent.outputKind='article';
 }else{
  d.intent.outputKind=d.kind==='chart'?'chart':d.kind==='chat'?'conversation':'application';
  if(d.kind==='files'&&requestsDataResult(question))throw Error('A file browser cannot fulfill an analytical result request. Read the authorized source data and build the requested chart or program; if data is unavailable, explain the missing data honestly.');
  if(d.kind==='files'&&!namedConnectors(question).includes('adma')&&!pageStorageProviders(question).length)throw Error('This connector is not a registered storage browser. Use a program or a truthful chat workspace.');
  if(d.kind==='native'&&!d.nativeApp)throw Error('A native app requires nativeApp.');
  if(d.kind==='program'){
   if(['geo-v1','data-tools-v1'].includes(d.templateId||''))throw Error('Native templates require kind=native.');
   if(!d.program||!d.inputFields||!d.templateId)throw Error('A program needs code, inputFields and templateId.');
   const status=sandboxStatus(context.userId);if(!status.configured||!status.allowed)throw Error('Sandbox unavailable. Choose an honest supported alternative.');
  }
  if(d.kind==='chart'){d.chart=chartSchema.parse(d.chart);d.dataset=validateChartData(d.chart as any,d.dataset);if(!webSearched&&!dataConsulted)throw Error('Read the chart observations using authorized connector/file tools or web research before finalizing the dataset.');}
  if(d.kind==='form'){
   if(!d.form||!d.examples?.length)throw Error('An expression form needs its form definition and independently calculated examples.');
   const program=validateProgram(d.expression,d.form.fields.map(f=>f.name));
   for(const e of d.examples){const actual=executeProgram(program,validateParameters(d.form,e.input));for(const o of d.form.outputs){const a=actual[o.name],b=e.output[o.name];if(a===undefined||b===undefined||(typeof a==='number'?typeof b!=='number'||Math.abs(a-b)>1e-8*Math.max(1,Math.abs(b)):a!==b))throw Error('Expression example failed. Correct the expression or expected output.');}}
   d.expression=program;
  }
  if(d.kind==='index'&&!['context_pages','user_jobs'].includes(d.intent.service))throw Error('Choose the index service.');
  if(d.kind==='converter')for(const k of ['overview','value','from','to','convert','swap','result','working','choose','invalid','unavailable','length','mass','volume','time','temperature'])if(!d.labels[k])throw Error('Missing localized converter label: '+k);
 }
 if(!d.labels.overview||!d.labels.invalid)throw Error('Supply localized overview and invalid labels.');
 return d;
}
// Materialization contains no model calls. The agent has already chosen and authored its artifact.
export async function materializeGenerationDraft(d:GenerationDraft,context:AgentContext){
 const answer={title:d.title,summary:d.summary,body:d.body,category:d.category,sources:d.sources,labels:d.labels};
 if(d.kind==='article')return {answer,definition:undefined,templateId:'wiki-v1' as TemplateId};
 if(d.kind==='disambiguation')return {answer:indexAnswer({needed:true,title:d.title,summary:d.summary,entries:d.entries!}),definition:undefined,templateId:'disambiguation-v1' as TemplateId};
 let templateId:TemplateId=d.templateId||'chat-v1';
 const components:{role:string;component:Component}[]=[];
 let config:DynamicConfig={template:'agent-chat-v1',executor:'page-agent-v1',version:1,capability:'application',labels:d.labels as ConverterLabels,visualTheme:d.intent.visualTheme,visualDesign:d.intent.visualDesign};
 const save=async(role:string,question:string,type:string,payload:unknown)=>{const c=await createComponent(question,type,payload,context);components.push({role,component:c});return {id:c.id,version:c.version};};
 if(d.kind==='native'){templateId=d.nativeApp==='map'?'geo-v1':'data-tools-v1';config={...config,template:'native-app-v1',executor:'native-app-v1',nativeApp:d.nativeApp};}
 if(d.kind==='files'){templateId='files-v1';config={...config,template:'file-browser-v1',executor:'registered-file-browser-v1',inputFields:[{name:'provider',type:'string',description:'google, dropbox, onedrive or adma',required:false},{name:'parent',type:'string',description:'Explicit folder ID or root.',required:false},{name:'search',type:'string',description:'Explicit file name query.',required:false}]};}
 if(d.kind==='index'){templateId='wiki-v1';config={...config,template:'context-index-v1',executor:'context-index-v1',indexKind:d.intent.service==='user_jobs'?'jobs':'pages',inputFields:d.intent.service==='user_jobs'?[]:[{name:'page_kind',type:'string',description:'static, dynamic or all',required:false},{name:'topic_terms',type:'string',description:'JSON array of synonymous topic keywords; [] for all',required:false}]};}
 if(d.kind==='converter'){templateId='form-v1';config={...config,template:'unit-converter-v1',executor:'unit-converter-v1',capability:'unit-converter-v1'};}
 if(d.kind==='program'){
  const backend=await save('backend',d.title+' — page view program','backend_code',d.program);
  const frontend=await save('frontend','Pre-coded page view '+templateId,'frontend_template',{kind:'registered',implementation:'page-view-v1',templateId});
  config={...config,template:'page-program-v1',executor:'isolated-page-program-v1',inputFields:d.inputFields,components:{frontend,backend}};
 }
 if(d.kind==='chart'){
  templateId=d.templateId==='table-v1'?'table-v1':'dashboard-v1';
  const chart=d.chart as z.infer<typeof chartSchema>,dataset=validateChartData(chart,d.dataset);
  const frontend=await save('frontend','Interactive chart '+JSON.stringify(chart),'frontend_template',chart);
  const files=(env as unknown as {FILES:R2Bucket}).FILES,key='datasets/'+crypto.randomUUID(),body=JSON.stringify(dataset);await files.put(key,body,{httpMetadata:{contentType:'application/json'}});
  let data;try{data=await save('data',d.title+' — dataset '+key.split('/')[1],'data',{kind:'data-reference',location:'r2://FILES/'+key,format:'json',fileName:'chart-data.json',mimeType:'application/json',size:new TextEncoder().encode(body).length,description:d.title});}catch(e){await files.delete(key);throw e;}
  config={...config,template:'component-chart-v1',executor:'chart-view-v1',capability:'chart',components:{frontend,data}};
 }
 if(d.kind==='form'){
  templateId='form-v1';const frontend=await save('frontend',d.title+' — form','frontend_template',d.form),backend=await save('backend',d.title+' — expression','backend_code',d.expression),workflow=await save('workflow',d.title+' — workflow','workflow',{kind:'workflow',steps:[{name:'run',component:backend}]});
  config={...config,template:'component-form-v1',executor:'component-workflow-v1',form:d.form,components:{frontend,workflow}};
 }
 return {answer,templateId,definition:{title:d.title,summary:d.summary,body:d.body,sources:d.sources,config,parameters:d.parameters,components}};
}
