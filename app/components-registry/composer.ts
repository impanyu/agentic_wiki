import {composeBackend} from '@/app/sandboxes/backend-composer';
import {composeChat} from '@/app/templates/chat-composer';
import {discoverApis} from './api-discovery';
import {z} from 'zod';
import {formSchema,validateProgram,executeProgram,validateParameters,type FormDefinition,type Parameters} from './contracts';
import {askAgent,spawnAgent,recordAction,type Agent} from '@/app/agents/runtime';
import {searchComponent,rememberComponent,createComponent,type AgentContext,type Component} from './registry';
import type {DynamicConfig} from '@/app/dynamic/units';
const obj=(properties:Record<string,unknown>,required=Object.keys(properties))=>({type:'object',additionalProperties:false,properties,required});
const str={type:'string'};
export async function planApplication(question:string,context:AgentContext,router:Agent,signal?:AbortSignal,discoveries:{role:string;component:Component}[]=[]){
 const decision=await askAgent(router,'Plan implementation for the requested page. application=true when the user wants an interactive tool, simulation, editor, game, calculator or executable experience, not reference prose. expressionForm=true only for numerical calculators and text transformations fully expressible as arithmetic/string expressions on a form. serverProgram=true for requests requiring generated Python/JavaScript backend programs, data processing, or algorithms beyond expression forms that should execute server-side. Browser-only interactive games, editors or simulations use serverProgram=false. Use the pre-coded conversational workspace for other tasks. Never generate frontend HTML, CSS or JavaScript. discoverApis=true if external services are required. Do not downgrade an unsupported application to an article promising future implementation.',{question},obj({application:{type:'boolean'},expressionForm:{type:'boolean'},serverProgram:{type:'boolean'},discoverApis:{type:'boolean'}}),signal);
 if(decision.discoverApis)discoveries.push(...await discoverApis(question,context,router,signal));
 if(!decision.application)return null;
 if(decision.serverProgram)return composeBackend(question,context,router,signal);
 if(!decision.expressionForm)return composeChat(question,context,router,signal);
 const coder=router;
 context={...context,agent:coder};
 await recordAction(router,'Delegate application composition',{agentId:coder.id,role:coder.role});

 const schema=obj({title:str,summary:str,submit:str,invalid:str,frontendQuestion:str,backendQuestion:str,fields:{type:'array',items:obj({name:str,label:str,type:{type:'string',enum:['number','text']},default:{type:['string','number','null']}})},outputs:{type:'array',items:obj({name:str,label:str})},programJson:str,exampleInputJson:str,exampleOutputJson:str});
 let draft:any;
 for(let attempt=0;attempt<2;attempt++){
  draft=await askAgent(coder,`Compose a complete reusable application in language ${context.language}. All labels and component descriptions must use this language. Use only a declarative form and a backend expression program; no JavaScript, imports, arbitrary API calls, markup or external actions. Field names and output names must match /^[a-z][a-z0-9_]{0,39}$/. programJson is JSON {"kind":"expression-program","outputs":{name:expression,...}}. Expressions are literal numbers or strings; {"input":"field_name"}; {"step":"earlier_output_name"}; or {"op":"operation","args":[expressions]}. Supported ops: add,multiply,min,max,concat (one or more args); subtract,divide,power (2 args); sqrt,abs,round,lowercase,uppercase,length,trim (1 arg). Numeric ops require numbers. Outputs execute in insertion order and may refer to earlier outputs. Use conventional explicit units in labels. Every displayed output must exist in program. Provide one independently calculated exampleInputJson and exampleOutputJson with all outputs for validation. Defaults are only values explicitly in the question or null. frontendQuestion must completely describe the form field names/types/units and output names; backendQuestion must completely describe operation, formula, input/output names and units WITHOUT example-specific values, enabling reuse. Do not claim unsupported features.`,{question,attempt},schema,signal,undefined,[],{context,reasoningEffort:'medium'});
  try{
   const form=formSchema.parse({kind:'form',submit:draft.submit,fields:draft.fields,outputs:draft.outputs});
   const program=validateProgram(JSON.parse(draft.programJson),form.fields.map(f=>f.name));
   if(form.outputs.some(o=>!(o.name in program.outputs)))throw new Error('Missing output');
   const example=validateParameters(form,JSON.parse(draft.exampleInputJson));
   const actual=executeProgram(program,example),expected=JSON.parse(draft.exampleOutputJson);
   if(Object.keys(actual).some(k=>typeof actual[k]==='number'?typeof expected[k]!=='number'||Math.abs(Number(actual[k])-expected[k])>1e-8*Math.max(1,Math.abs(expected[k])):actual[k]!==expected[k]))throw new Error('Example failed');
   let frontend=await searchComponent(draft.frontendQuestion,'frontend_template',context);
   if(frontend){try{const saved=formSchema.parse(JSON.parse(frontend.payload));if(JSON.stringify(saved.fields.map(f=>[f.name,f.type]))!==JSON.stringify(form.fields.map(f=>[f.name,f.type]))||JSON.stringify(saved.outputs.map(o=>o.name))!==JSON.stringify(form.outputs.map(o=>o.name)))frontend=null;}catch{frontend=null;}}
   if(frontend)await rememberComponent(draft.frontendQuestion,frontend,context);
   else frontend=await createComponent(draft.frontendQuestion,'frontend_template',{...form,fields:form.fields.map(f=>({...f,default:null}))},context);
   let backend=await searchComponent(draft.backendQuestion,'backend_code',context);
   if(backend){try{const saved=validateProgram(JSON.parse(backend.payload),form.fields.map(f=>f.name));if(JSON.stringify(saved)!==JSON.stringify(program))backend=null;}catch{backend=null;}}
   if(backend)await rememberComponent(draft.backendQuestion,backend,context);
   else backend=await createComponent(draft.backendQuestion,'backend_code',program,context);
   const workflowQuestion=draft.backendQuestion+' — workflow';
   let workflow=await searchComponent(workflowQuestion,'workflow',context);
   if(workflow&&JSON.parse(workflow.payload).steps?.[0]?.component?.id!==backend.id)workflow=null;
   if(workflow)await rememberComponent(workflowQuestion,workflow,context);
   else workflow=await createComponent(workflowQuestion,'workflow',{kind:'workflow',steps:[{name:'calculate',component:{id:backend.id,version:backend.version}}]},context,[{role:'calculate',component:backend}]);
   const labels={invalid:draft.invalid,unavailable:draft.invalid,overview:'',value:'',from:'',to:'',convert:draft.submit,swap:'',result:'',working:'',choose:'',length:'',mass:'',volume:'',time:'',temperature:''};
   const config:DynamicConfig={template:'component-form-v1',executor:'component-workflow-v1',version:1,capability:'application',labels,components:{frontend:{id:frontend.id,version:frontend.version},workflow:{id:workflow.id,version:workflow.version}},form:JSON.parse(frontend.payload)};
   const parameters:Parameters={};for(const field of form.fields)if(field.default!==null)parameters[field.name]=field.default;
   await recordAction(coder,'Validate and register components',{frontend:frontend.id,backend:backend.id,workflow:workflow.id,validated:true});
   await recordAction(router,'Receive coding agent result',{agentId:coder.id,components:config.components});
   return {title:z.string().min(1).max(200).parse(draft.title),summary:z.string().min(1).max(800).parse(draft.summary),config,parameters,components:[{role:'frontend',component:frontend},{role:'workflow',component:workflow}]};
  }catch(error){await recordAction(coder,'Validate generated application',{error:error instanceof Error?error.message:'Invalid program'});if(attempt===1)throw error;}
 }
 return null;
}
export async function extractApplicationInputs(question:string,form:FormDefinition,router:Agent){
 const d=await askAgent(router,'Extract only explicitly supplied form values from the question. Never calculate results, infer missing values, or invent defaults. Return JSON object as inputJson, with numeric fields as numbers. Omit missing values.',{question,fields:form.fields},obj({inputJson:str}));
 const parsed=z.record(z.union([z.string(),z.number().finite(),z.null()])).parse(JSON.parse(d.inputJson));
 return Object.fromEntries(Object.entries(parsed).filter(([,value])=>value!==null)) as Parameters;
}
export async function composeConverter(config:DynamicConfig,context:AgentContext){
 const description=context.language.startsWith('zh')?'物理单位换算器：长度、质量、体积、时间和温度':'Physical unit converter: length, mass, volume, time and temperature';
 const refs:{role:string;component:Component}[]=[];
 for(const [type,role] of [['frontend_template','frontend'],['backend_code','backend']] as const){
  const question=description+(role==='frontend'?' — form':' — calculation');
  let c=await searchComponent(question,type,context);
  if(!c)c=await createComponent(question,type,{kind:'registered',implementation:'unit-converter-v1',...(role==='frontend'?{labels:config.labels}:{})},context);
  else await rememberComponent(question,c,context);
  refs.push({role,component:c});
 }
 config.components={frontend:{id:refs[0].component.id,version:refs[0].component.version},backend:{id:refs[1].component.id,version:refs[1].component.version}};
 return refs;
}
