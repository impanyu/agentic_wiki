import {z} from 'zod';
import {processingCatalog,processingRunName} from './processing-catalog';
import type {RemoteTool} from '@/app/connectors/contracts';
const id=z.string().uuid();
export function processingInput(slug:string,raw:unknown){
 const spec=processingCatalog.find(s=>s.slug===slug);if(!spec)throw Error('Unknown ADMA tool.');
 const shape:Record<string,z.ZodTypeAny>={};
 for(const f of spec.fields){let schema:z.ZodTypeAny=f.type==='file'||f.type==='folder'?id:f.type==='number'?z.number().finite():z.string().trim().min(1).max(2000);if(f.type==='select')schema=z.enum(f.options as [string,...string[]]);shape[f.name]=f.required?schema:schema.optional();}
 const data=z.object(shape).strict().parse(raw);
 if(slug==='si-tool'){
  const required=String(data.workflow).endsWith('_uav')?['ndre_shp_id']:['nir_tif_id','rededge_tif_id'];
  if(String(data.workflow).startsWith('sbf_'))required.push('indicator_shp_id');else required.push('field_column');
  for(const name of required)if(!data[name])throw Error('Missing SI input: '+name);
 }
 if(slug==='valid-yield-extractor'&&data.rate_tolerance!==undefined&&(data.rate_tolerance<0||data.rate_tolerance>1))throw Error('Rate tolerance must be between 0 and 1.');
 return data;
}
export const processingTools:RemoteTool[]=[{name:'list_processing_tools',description:'List available ADMA processing tools and their parameter contracts. Includes Seeding Tool, Shape to JSON, SI Tool, Yield Summary and Valid Yield Extractor.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true}},...processingCatalog.map(spec=>({name:processingRunName(spec.slug),description:spec.name+': '+spec.description+' Starts an asynchronous job and writes output files. Requires explicit user intent. Inputs and output folder must be private and owned by this account; first copy public data into your private ADMA workspace. Save the returned task_id and call processing_status later; never resubmit just to poll.',inputSchema:{type:'object',properties:{operation_id:{type:'string',format:'uuid',description:'Unique operation ID; reuse this exact ID and inputs for retries to avoid duplicate jobs.'},...Object.fromEntries(spec.fields.map(f=>[f.name,{type:f.type==='number'?'number':'string',description:f.label,...(f.type==='file'||f.type==='folder'?{format:'uuid'}:{}),...(f.options?{enum:f.options}:{})}]))},required:['operation_id',...spec.fields.filter(f=>f.required).map(f=>f.name)],additionalProperties:false},annotations:{readOnlyHint:false}})),{name:'processing_status',description:'Read status and output of an ADMA processing job started by this user through this connector. Does not start another job.',inputSchema:{type:'object',properties:{task_id:{type:'string',format:'uuid'}},required:['task_id'],additionalProperties:false},annotations:{readOnlyHint:true}}];
