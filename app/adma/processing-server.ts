import {lock,unlock} from '@/db/store';
import {z} from 'zod';
import {processingCatalog,processingRunName} from './processing-catalog';
import {processingInput} from './processing';
import {remoteRequest} from '@/app/connectors/http';
import {vaultPath,vaultRead,vaultWrite} from '@/app/storage/vault';
export async function executeProcessing(userId:string,connectorId:string,token:string,name:string,args:unknown,signal?:AbortSignal){
 const request=async(path:string,body?:unknown)=>(await remoteRequest('https://adma.aisoup.net/api/v1/'+path,{Authorization:'Token '+token,Accept:'application/json'},body,signal,body?'POST':'GET')).data;
 if(name==='list_processing_tools'){z.object({}).strict().parse(args);const live=await request('tools/');return {...live,contracts:processingCatalog};}
 if(name==='processing_status'){
  const {task_id}=z.object({task_id:z.string().uuid()}).strict().parse(args),saved=await vaultRead(await vaultPath(userId,'adma-job-'+connectorId+'-'+task_id));
  if(!saved||saved.connectorId!==connectorId)throw Error('This ADMA task is not registered to your account and connector.');
  return {...await request('tools/'+saved.slug+'/status/'+task_id+'/'),task_id,tool:saved.slug};
 }
 const spec=processingCatalog.find(s=>processingRunName(s.slug)===name);if(!spec)throw Error('Unknown ADMA processing tool.');const {operation_id,...raw}=z.object({operation_id:z.string().uuid()}).passthrough().parse(args),data=processingInput(spec.slug,raw);
 const operationPath=await vaultPath(userId,'adma-operation-'+connectorId+'-'+operation_id),fingerprint=JSON.stringify([spec.slug,data]),lease=await lock(operationPath,90000);if(!lease)throw Error('This operation is still being submitted.');
 try{const prior=await vaultRead(operationPath);if(prior){if(prior.fingerprint!==fingerprint)throw Error('Operation ID already used with different inputs.');if(prior.result)return prior.result;throw Error('Submission outcome is uncertain. Check ADMA before starting a new operation.');}
 // ADMA tasks inherit the primary input owner/visibility. Fail closed rather than
 // letting a public input cause another user's files or public output to be written.
 for(const field of spec.fields.filter(f=>f.type==='file'||f.type==='folder'))if(data[field.name]){
  const value=await request((field.type==='file'?'files/':'folders/')+data[field.name]+(field.type==='file'?'/metadata/':'/info/'));
  if(value?.is_public!==false)throw Error('Use private input files and a private output folder owned by your ADMA account. Copy shared data into your workspace first.');
 }
 await vaultWrite(operationPath,{fingerprint,state:'submitting'});
 const result=await request('tools/'+spec.slug+'/run/',data);
 if(result?.success!==true||!z.string().uuid().safeParse(result.task_id).success)throw Error('ADMA did not acknowledge a task. Check ADMA before submitting again.');
 await vaultWrite(await vaultPath(userId,'adma-job-'+connectorId+'-'+result.task_id),{slug:spec.slug,connectorId,createdAt:new Date().toISOString()});
 const response={...result,tool:spec.slug,status:'SUBMITTED'};await vaultWrite(operationPath,{fingerprint,result:response});return response;
 }finally{await unlock(lease);}
}
