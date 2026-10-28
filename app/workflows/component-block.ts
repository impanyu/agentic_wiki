import {z} from 'zod';
import {workflowSchema,type Workflow,type WorkflowNode} from './schema';
// A ```component block embeds platform components in a wiki article. It is a
// workflow without a backend: every action runs in the reader's browser.
// Shared by the article renderer (browser) and the draft checks (server).
export const blockSchema=z.object({title:z.string().max(200).optional(),state:z.record(z.unknown()).optional(),ui:z.array(z.unknown()).min(1).max(60),actions:z.record(z.unknown()).optional(),layout:z.record(z.unknown()).optional()}).strict();
// Components that need a server or the page workspace are not available in articles.
export const BLOCK_EXCLUDED=new Set(['article','file_upload','resource_picker','log']);
export function blockWorkflow(raw:unknown):Workflow{
 const b=blockSchema.parse(raw);
 const actions=Object.fromEntries(Object.entries(b.actions||{}).map(([k,a])=>[k,{...(a as object),client:true}]));
 return workflowSchema.parse({kind:'workflow-app',title:b.title,state:b.state||{},ui:b.ui,actions,layout:{density:'normal',...(b.layout||{})}});
}
export function excludedComponents(w:Workflow){const found:string[]=[];const walk=(nodes:WorkflowNode[])=>{for(const n of nodes){if(BLOCK_EXCLUDED.has(n.type))found.push(n.type);if(n.children)walk(n.children);}};walk(w.ui);return [...new Set(found)];}
// Every ```component block of a Markdown body, with the line it starts on.
export function componentBlocks(body:string){
 const lines=body.split('\n'),out:{line:number;code:string;closed:boolean}[]=[];
 for(let i=0;i<lines.length;i++){if(!/^```component\s*$/.test(lines[i].trim()))continue;const end=lines.findIndex((v,at)=>at>i&&/^```\s*$/.test(v.trim()));out.push({line:i+1,code:lines.slice(i+1,end>i?end:lines.length).join('\n'),closed:end>i});if(end>i)i=end;}
 return out;
}
