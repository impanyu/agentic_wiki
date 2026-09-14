import {ApiExecutionError,endpointAllowed,prepareRequest,type ExecutionInput,type HttpDefinition,type ExecutionPolicy} from './http-contracts';
// Dependencies are injected for tests. Production secret lookup is exclusively server-side.
export async function sendApiRequest(args:{baseUrl:string;definition:HttpDefinition;input:ExecutionInput;userId:string;secretRef?:string;policy:ExecutionPolicy;readSecret:(ref:string)=>string|undefined;fetcher:typeof fetch;signal?:AbortSignal}){
 const {op,url,body}=prepareRequest(args.baseUrl,args.definition,args.input);
 const endpoint=new URL(url.origin+url.pathname),headers=new Headers({Accept:op.response==='json'?'application/json':'text/plain'});
 let secret='';
 if(args.secretRef){
  const grant=args.policy.credentials[args.secretRef];
  if(!grant||!grant.userIds.includes(args.userId)||!endpointAllowed(grant.endpoints,endpoint,op.method))throw new ApiExecutionError('CREDENTIAL_NOT_AUTHORIZED_FOR_API');
  secret=args.readSecret(args.secretRef)||'';if(!secret)throw new ApiExecutionError('CREDENTIAL_SECRET_MISSING');
  if(secret.length>16384||/[\r\n]/.test(secret))throw new ApiExecutionError('INVALID_CREDENTIAL_SECRET');
  const value=(grant.auth.prefix||'')+secret;
  if(grant.auth.location==='header'){
   if(['host','cookie','content-length','connection','transfer-encoding'].includes(grant.auth.name.toLowerCase()))throw new ApiExecutionError('INVALID_AUTH_CONFIGURATION');
   try{headers.set(grant.auth.name,value);}catch{throw new ApiExecutionError('INVALID_AUTH_CONFIGURATION');}
  }else url.searchParams.set(grant.auth.name,value);
 }else if(!endpointAllowed(args.policy.anonymous,endpoint,op.method))throw new ApiExecutionError('API_ENDPOINT_NOT_ENABLED');
 const redact=(text:string)=>{if(!secret)return text;for(const value of new Set([secret,encodeURIComponent(secret),JSON.stringify(secret).slice(1,-1),new URLSearchParams({v:secret}).toString().slice(2),encodeURIComponent(secret).replace(/%[0-9A-F]{2}/g,s=>s.toLowerCase()),btoa(unescape(encodeURIComponent(secret)))]))if(value)text=text.split(value).join('[redacted]');return text;};
 let response:Response;
 try{if(op.method!=='GET')headers.set('Content-Type','application/json');response=await args.fetcher(url,{method:op.method,headers,body:op.method==='GET'?undefined:JSON.stringify(body),redirect:'manual',signal:args.signal?AbortSignal.any([args.signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)});}catch{throw new ApiExecutionError('API_REQUEST_FAILED');}
 if(response.status>=300&&response.status<400){await response.body?.cancel();throw new ApiExecutionError('API_REDIRECT_BLOCKED');}
 // Never forward upstream headers or untrusted error bodies, which may echo authentication.
 if(!response.ok){await response.body?.cancel();throw new ApiExecutionError('API_HTTP_'+response.status);}
 const reader=response.body?.getReader(),parts:Uint8Array[]=[];let length=0;
 try{if(reader)while(true){const chunk=await reader.read();if(chunk.done)break;length+=chunk.value.byteLength;if(length>256*1024){await reader.cancel();throw new ApiExecutionError('API_RESPONSE_TOO_LARGE');}parts.push(chunk.value);}}catch(e){if(e instanceof ApiExecutionError)throw e;throw new ApiExecutionError('API_RESPONSE_FAILED');}
 const bytes=new Uint8Array(length);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
 const text=redact(new TextDecoder().decode(bytes));let data:unknown=text;
 if(op.response==='json'){try{data=text.trim()?JSON.parse(text):null;}catch{throw new ApiExecutionError('INVALID_API_RESPONSE');}}
 return {status:response.status,data};
}
