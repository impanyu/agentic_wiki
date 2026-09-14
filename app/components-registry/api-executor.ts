import {env} from '@/server/runtime';
import {database} from '@/db/store';
import {getComponent,type AgentContext} from './registry';
import {externalApiSchema} from './api-discovery';
import {ApiExecutionError,executionInputSchema,policySchema,type ExecutionPolicy} from './http-contracts';
import {sendApiRequest} from './http-transport';
import type {ComponentRef} from './contracts';
// Exact endpoints, methods and secret principals are configured by the operator, never by an agent.
function executionPolicy():ExecutionPolicy{
 const vars=env as unknown as Record<string,string>;
 try{return policySchema.parse(JSON.parse(vars.COMPONENT_API_POLICY||process.env.COMPONENT_API_POLICY||'{"anonymous":[],"credentials":{}}'));}catch{throw new ApiExecutionError('INVALID_SERVER_API_POLICY');}
}
export async function executeApi(ref:ComponentRef,raw:unknown,context:Pick<AgentContext,'userId'|'agent'>,options:{allowWrite?:boolean;signal?:AbortSignal}={}){
 if(context.agent&&context.agent.ownerId!==context.userId)throw new ApiExecutionError('AGENT_PRINCIPAL_MISMATCH');
 const c=await getComponent(ref,context,'api_adapter'),definition=externalApiSchema.parse(JSON.parse(c.payload)),input=executionInputSchema.parse(raw);
 if(definition.execution!=='http'||!definition.http)throw new ApiExecutionError('API_OPERATION_CONFIGURATION_REQUIRED');
 const operation=definition.http.operations.find(o=>o.name===input.operation);if(!operation)throw new ApiExecutionError('UNKNOWN_API_OPERATION');
 // The direct UI can confirm writes. Autonomous notebook calls are read-only.
 if(operation.method!=='GET'&&!options.allowWrite)throw new ApiExecutionError('API_WRITE_REQUIRES_USER_CONFIRMATION');
 let secretRef:string|undefined;
 if(definition.authentication!=='none'){
  const link=await database().prepare("SELECT component_id id,version FROM component_dependencies WHERE parent_id=? AND role='credential'").bind(c.id).first<ComponentRef>();
  if(!link)throw new ApiExecutionError('API_CREDENTIAL_LINK_MISSING');
  const credential=await getComponent(link,context,'credential');
  if(credential.visibility!=='private'||credential.owner_id!==context.userId)throw new ApiExecutionError('CREDENTIAL_ACCESS_DENIED');
  const payload=JSON.parse(credential.payload);if(!/^COMPONENT_SECRET_[A-Z0-9_]+$/.test(payload.secretRef))throw new ApiExecutionError('INVALID_SECRET_REFERENCE');secretRef=payload.secretRef;
 }
 return sendApiRequest({baseUrl:definition.baseUrl,definition:definition.http,input,userId:context.userId,secretRef,policy:executionPolicy(),readSecret:ref=>(env as unknown as Record<string,string>)[ref]||process.env[ref],fetcher:fetch,signal:options.signal});
}
