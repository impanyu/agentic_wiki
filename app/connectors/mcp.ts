import {remoteRequest} from './http';
import {toolSchema,type RemoteTool} from './contracts';
export async function withMcp<T>(url:string,token:string|undefined,run:(rpc:(method:string,params:unknown)=>Promise<any>)=>Promise<T>,signal?:AbortSignal){
 let session='',version='2025-03-26';
 const headers=()=>({...token?{Authorization:'Bearer '+token}:{},...session?{'Mcp-Session-Id':session}:{},'MCP-Protocol-Version':version});
 async function rpc(method:string,params:unknown){const id=crypto.randomUUID();const r=await remoteRequest(url,headers(),{jsonrpc:'2.0',id,method,params},signal);if(r.headers['mcp-session-id'])session=String(r.headers['mcp-session-id']);if(!r.data||r.data.id!==id||r.data.error)throw Error('Connector could not complete '+method+'.');return r.data.result;}
 try{const init=await rpc('initialize',{protocolVersion:version,capabilities:{},clientInfo:{name:'AgenticWiki',version:'1.0.0'}});if(!['2025-03-26','2025-06-18','2025-11-25'].includes(init.protocolVersion))throw Error('Unsupported MCP protocol version.');version=init.protocolVersion;
  await remoteRequest(url,headers(),{jsonrpc:'2.0',method:'notifications/initialized'},signal);return await run(rpc);
 }finally{if(session)await remoteRequest(url,headers(),undefined,signal,'DELETE').catch(()=>{});}
}
export async function discoverMcp(url:string,token?:string,signal?:AbortSignal){return withMcp(url,token,async rpc=>{const tools:RemoteTool[]=[];let cursor:unknown;for(let page=0;page<10;page++){const result=await rpc('tools/list',cursor?{cursor}:{});for(const item of result.tools||[])tools.push(toolSchema.parse(item));if(tools.length>200||JSON.stringify(tools).length>250000)throw Error('Connector has too many tools.');cursor=result.nextCursor;if(!cursor)return tools;}throw Error('Connector tool list is too large.');},signal);}
export async function callMcp(url:string,token:string|undefined,name:string,args:unknown,signal?:AbortSignal){return withMcp(url,token,rpc=>rpc('tools/call',{name,arguments:args}),signal);}
