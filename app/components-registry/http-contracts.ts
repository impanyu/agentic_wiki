import {z} from 'zod';
const name=z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/);
export const httpOperationSchema=z.object({name,method:z.enum(['GET','POST','PUT','PATCH','DELETE']),path:z.string().startsWith('/').max(1000),parameters:z.array(z.object({name,location:z.enum(['query','body']),type:z.enum(['string','number','boolean','json']),required:z.boolean()})).max(30),response:z.enum(['json','text'])}).strict();
export const httpDefinitionSchema=z.object({operations:z.array(httpOperationSchema).min(1).max(20)}).strict();
export const executionInputSchema=z.object({operation:name,parameters:z.record(z.unknown()).default({})}).strict();
export type HttpDefinition=z.infer<typeof httpDefinitionSchema>;
export type ExecutionInput=z.infer<typeof executionInputSchema>;
export type SecretPolicy={userIds:string[];endpoints:{url:string;methods:string[]}[];auth:{location:'header'|'query';name:string;prefix?:string}};
export type ExecutionPolicy={anonymous:{url:string;methods:string[]}[];credentials:Record<string,SecretPolicy>};
export const policySchema=z.object({anonymous:z.array(z.object({url:z.string().url(),methods:z.array(z.string())})).default([]),credentials:z.record(z.object({userIds:z.array(z.string()),endpoints:z.array(z.object({url:z.string().url(),methods:z.array(z.string())})),auth:z.object({location:z.enum(['header','query']),name,prefix:z.string().max(100).optional()})})).default({})}).strict();
export class ApiExecutionError extends Error{constructor(public code:string){super(code);}}
export function safeEndpoint(base:string,path:string){
 let url:URL;try{const root=new URL(base);url=new URL(path,root.origin);if(url.origin!==root.origin||root.username||root.password||root.search||root.hash)throw 0;}catch{throw new ApiExecutionError('INVALID_API_ENDPOINT');}
 const host=url.hostname.toLowerCase();
 if(url.protocol!=='https:'||url.port&&url.port!=='443'||url.username||url.password||url.search||url.hash||!host.includes('.')||host.includes(':')||/^\d+(?:\.\d+)*$/.test(host)||/\.(?:localhost|local|internal|test|invalid)$/.test(host)||host==='localhost')throw new ApiExecutionError('INVALID_API_ENDPOINT');
 if(url.pathname!==path||path.includes('%')||path.includes('\\')||path.includes('//'))throw new ApiExecutionError('INVALID_API_ENDPOINT');
 return url;
}
export function endpointAllowed(entries:{url:string;methods:string[]}[],url:URL,method:string){return entries.some(e=>e.url===url.origin+url.pathname&&e.methods.includes(method));}
export function prepareRequest(base:string,definition:HttpDefinition,input:ExecutionInput){
 if(JSON.stringify(input.parameters).length>64000)throw new ApiExecutionError('API_INPUT_TOO_LARGE');
 const op=definition.operations.find(o=>o.name===input.operation);if(!op)throw new ApiExecutionError('UNKNOWN_API_OPERATION');
 const url=safeEndpoint(base,op.path),body:Record<string,unknown>={};
 if(new Set(op.parameters.map(p=>p.name)).size!==op.parameters.length)throw new ApiExecutionError('INVALID_API_PARAMETERS');
 if(Object.keys(input.parameters).some(key=>!op.parameters.some(p=>p.name===key)))throw new ApiExecutionError('UNKNOWN_API_PARAMETER');
 for(const p of op.parameters){const v=input.parameters[p.name];if(v===undefined){if(p.required)throw new ApiExecutionError('MISSING_API_PARAMETER');continue;}if(p.type!=='json'&&typeof v!==p.type)throw new ApiExecutionError('INVALID_API_PARAMETER');if(p.location==='body'){if(op.method==='GET')throw new ApiExecutionError('INVALID_API_BODY');body[p.name]=v;}else url.searchParams.set(p.name,p.type==='json'?JSON.stringify(v):String(v));}
 return {op,url,body};
}
