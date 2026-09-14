import {askAgent,type Agent} from '@/app/components-registry/agents';
import type {AgentContext} from '@/app/components-registry/registry';
import type {DynamicConfig,ConverterLabels} from '@/app/dynamic/units';
export async function composeChat(question:string,context:AgentContext,router:Agent,signal?:AbortSignal){
 const d=await askAgent(router,'Prepare a conversational app workspace for this task in language '+context.language+'. Return a short title and summary explaining how its session agent can help. This uses a pre-coded chat interface and authorized backend tools. Do not claim actions have already completed, unavailable APIs are connected, or a custom visual interface exists.',{question},{type:'object',additionalProperties:false,properties:{title:{type:'string'},summary:{type:'string'}},required:['title','summary']},signal);
 const config:DynamicConfig={template:'agent-chat-v1',executor:'page-agent-v1',version:1,capability:'application',labels:{overview:'',invalid:context.language.startsWith('zh')?'请重试。':'Please try again.'} as ConverterLabels};
 return {title:String(d.title).slice(0,200),summary:String(d.summary).slice(0,800),config,components:[],parameters:{}};
}
