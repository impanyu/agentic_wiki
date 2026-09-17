import {registeredAdmaPage} from '@/app/page-programs/deferred';
import {executeContextIndex} from '@/app/context-index/server';
import {runPageProgram} from '@/app/page-programs/runtime';
import {executeCodeComponent} from '@/app/sandboxes/service';
import {sandboxSchema} from './sandbox-contracts';
import {env} from '@/server/runtime';
import {chartSchema,validateChartData} from './chart-contracts';
import {executeApi} from './api-executor';
import {getComponent} from './registry';
import {executeProgram,validateParameters,formSchema,type Parameters} from './contracts';
import {runDestination} from '@/app/dynamic/execute';
import type {AnswerPage} from '@/app/page-types';
export async function hydrateComponents(page:AnswerPage,userId:string){
 const config=page.dynamic;if(!config?.components)return page;
 const front=await getComponent(config.components.frontend,{userId},'frontend_template');
 const f=JSON.parse(front.payload);
 if(config.template==='page-program-v1'){if(f.kind!=='registered'||f.implementation!=='page-view-v1')throw Error('INVALID_TEMPLATE');return page;}
 else if(config.template==='google-drive-folders-v1'){if(f.kind!=='registered'||f.implementation!=='google-drive-folders-v1')throw new Error('INVALID_TEMPLATE');config.driveLabels=f.labels;}
 else if(config.template==='component-sandbox-v1')config.sandbox=sandboxSchema.parse(f);
 else if(config.template==='component-chart-v1'){
  config.chart=chartSchema.parse(f);if(!config.components.data)throw new Error('MISSING_CHART_DATA');
  const data=JSON.parse((await getComponent(config.components.data,{userId},'data')).payload);
  if(typeof data.location!=='string'||!data.location.startsWith('r2://FILES/datasets/'))throw new Error('INVALID_CHART_DATA');
  const file=await (env as unknown as {FILES:R2Bucket}).FILES.get(data.location.slice('r2://FILES/'.length));
  if(!file||file.size>256000)throw new Error('CHART_DATA_UNAVAILABLE');config.dataset=validateChartData(config.chart,await file.json());
 }else if(config.template==='component-form-v1')config.form=formSchema.parse(f);
 else if(f.kind!=='registered'||f.implementation!=='unit-converter-v1')throw new Error('INVALID_TEMPLATE');
 // Only safe presentation is sent to the browser. Backend definitions and credentials stay server-side.
 return page;
}
export async function executePage(page:AnswerPage,input:unknown,userId:string){
 page=registeredAdmaPage(page);
 if(page.dynamic?.template==='file-browser-v1')return {...page,runtimePending:false,runtimeError:undefined};
 const config=page.dynamic;if(!config)throw new Error('NOT_APPLICATION');
 if(config.template==='context-index-v1')return executeContextIndex(page,input,userId);
 if(config.template==='page-program-v1')return runPageProgram(page,input,userId);
 if(config.template==='unit-converter-v1'){
  if(config.components?.backend){const b=JSON.parse((await getComponent(config.components.backend,{userId},'backend_code')).payload);if(b.kind!=='registered'||b.implementation!=='unit-converter-v1')throw new Error('INVALID_BACKEND');}
  return {...page,runtime:runDestination(config.executor,input)};
 }
 if(!config.components?.workflow||!config.form)throw new Error('MISSING_WORKFLOW');
 const parameters=validateParameters(config.form,input);
 const workflow=JSON.parse((await getComponent(config.components.workflow,{userId},'workflow')).payload);
 if(workflow.kind!=='workflow'||!Array.isArray(workflow.steps)||!workflow.steps.length||workflow.steps.length>12)throw new Error('INVALID_WORKFLOW');
 let result:Parameters={};
 for(const step of workflow.steps){
  const backend=await getComponent(step.component,{userId});
  if(backend.type==='api_adapter'){
   const available={...parameters,...result};
   if(typeof step.operation!=='string'||!step.bindings||!step.outputs||typeof step.bindings!=='object'||typeof step.outputs!=='object')throw new Error('INVALID_API_STEP');
   const values=Object.fromEntries(Object.entries(step.bindings).map(([name,input])=>{if(typeof input!=='string'||!Object.hasOwn(available,input))throw new Error('MISSING_API_INPUT');return [name,available[input]];}));
   const response=await executeApi(step.component,{operation:step.operation,parameters:values},{userId});
   for(const [name,pointer]of Object.entries(step.outputs)){
    if(!/^[a-z][a-z0-9_]{0,39}$/.test(name)||typeof pointer!=='string'||!pointer.startsWith('/'))throw new Error('INVALID_API_OUTPUT');
    let value:unknown=response.data;for(const part of pointer.slice(1).split('/').map(p=>p.replaceAll('~1','/').replaceAll('~0','~'))){if(!value||typeof value!=='object'||!Object.hasOwn(value,part))throw new Error('MISSING_API_OUTPUT');value=(value as Record<string,unknown>)[part];}
    if(!['string','number','boolean'].includes(typeof value)||typeof value==='number'&&!Number.isFinite(value))throw new Error('INVALID_API_OUTPUT');result[name]=value as string|number|boolean;
   }
  }else if(backend.type==='backend_code'){
   if(JSON.parse(backend.payload).kind==='sandbox-program'){const execution=await executeCodeComponent(step.component,{...parameters,...result},{userId});if(!execution.ok)throw new Error('SANDBOX_PROGRAM_FAILED');const output=execution.result;if(!output||typeof output!=='object'||Array.isArray(output)||Object.values(output).some(v=>!['string','number','boolean'].includes(typeof v)))throw new Error('INVALID_PROGRAM_OUTPUT');result={...result,...output};}
   else result={...result,...executeProgram(JSON.parse(backend.payload),{...parameters,...result})};
  }
  else throw new Error('INVALID_WORKFLOW_COMPONENT');
 }
 return {...page,parameters,applicationResult:result};
}
