import {z} from 'zod';
import {COMPONENTS} from './catalog';
import {TOOLS} from './tools';
import {validateWorkflow} from './validate';
import {runAction} from './executor';
import {evaluate} from './expressions';
import {applyPatch} from './patch';
import {verifyWorkflow,workflowReportText,workflowTestsSchema,type WorkflowTests} from './verify';
import type {Workflow,WorkflowNode} from './schema';
// The agents' workbench: the generator and in-page agents are "hyper coders"
// above the apps they build. These tools let them think (spec), explore the
// infrastructure (catalog, try tools, evaluate expressions on real data), edit
// a draft workflow, run it, and verify it, in whatever order they choose.
const list=z.array(z.string().trim().min(1).max(600)).max(20).default([]);
export const appSpecSchema=z.object({goal:z.string().trim().min(1).max(2000),users:z.string().max(600).default(''),inputs:list,dataSources:list,outputs:list,interactions:list,constraints:list,edgeCases:list,assumptions:list,gaps:list,acceptance:z.array(z.object({requirement:z.string().trim().min(1).max(600),test:workflowTestsSchema.element.optional()}).strict()).max(12).default([])}).strict();
export type AppSpec=z.infer<typeof appSpecSchema>;
type Ctx={userId:string;pageId:string;language:string;request:string;title:string;signal?:AbortSignal};
// Large values are shown as a preview so they fit the agent’s context.
const clip=(v:unknown,n:number)=>{let s:string;try{s=JSON.stringify(v)??'null';}catch{s=String(v);}return s.length<=n?v:{truncated:true,totalChars:s.length,preview:s.slice(0,n)};};
const short=(v:unknown,n:number)=>{let s:string;try{s=JSON.stringify(v)??'';}catch{s=String(v);}return s.length>n?s.slice(0,n)+'… ('+s.length+' chars)':s;};
const str={type:'string'};
const fn=(name:string,description:string,properties:Record<string,unknown>)=>({type:'function',name,description,strict:true,parameters:{type:'object',additionalProperties:false,properties,required:Object.keys(properties)}});
const parse=(text:unknown,label:string)=>{if(typeof text!=='string'||!text.trim())return undefined;try{return JSON.parse(text);}catch(e){throw Error(label+' is not valid JSON: '+(e instanceof Error?e.message:'error'));}};
export const WORKBENCH_TOOLS=[
 fn('wf_spec','Write or replace the app specification: your interpretation of what the user needs, before and while building. specJson = {goal, users, inputs[], dataSources[], outputs[], interactions[], constraints[], edgeCases[], assumptions[], gaps[] (needed components/tools that do not exist), acceptance:[{requirement, test?:{name, values, actions, expect}}]}. Turn ambiguities into app inputs with sensible defaults instead of guessing. The spec is saved with the app and used to verify it.',{specJson:str}),
 fn('wf_catalog','Search the infrastructure: UI components and backend tools. query = keywords (e.g. "upload csv", "time series chart", "arcgis publish") or an exact component/tool name for its full description; kind = component | tool | all.',{query:str,kind:{type:'string',enum:['component','tool','all']}}),
 fn('wf_get','Show the current draft workflow, its validation problems and the spec.',{}),
 fn('wf_set','Replace the whole draft workflow. workflowJson = {kind:"workflow-app", title, state, ui, actions, layout}. Returns validation problems.',{workflowJson:str}),
 fn('wf_edit','Edit the draft workflow with a list of operations (applied in order; returns validation problems). opsJson = [ {op:"add_node", parent:"<node id>"|null (top level), index?:number, node}, {op:"update_props", id, props (merged; null removes a prop)}, {op:"set_node", id, node}, {op:"remove_node", id}, {op:"move_node", id, parent, index?}, {op:"set_action", name, action}, {op:"remove_action", name}, {op:"set_state", key, value}, {op:"set_layout", layout}, {op:"set_title", title}, or JSON-patch {op:"add"|"replace"|"remove", path:"/ui/0/props/x", value} ]. Give nodes ids to edit them later.',{opsJson:str}),
 fn('wf_validate','Check the draft workflow: components, props, events, bindings, step references.',{}),
 fn('wf_try_tool','Run one infrastructure tool now to see the real data it returns (changes are skipped), e.g. connectors.list, files.list, files.read, resources.browse, connectors.call with a read tool. argsJson is its arguments object.',{tool:str,argsJson:str}),
 fn('wf_eval','Evaluate a JSONata expression to test a binding. scopeJson is the scope object, or empty to use the scope of the last wf_run ({state, values, steps, event}).',{expression:str,scopeJson:str}),
 fn('wf_run','Run one action of the draft for real (changes skipped) and see the resulting state and every step’s output. valuesJson = component values by id (e.g. an uploaded file resource), stateJson = state to start from (empty: the draft’s initial state, or the state after the previous wf_run when continue is true).',{action:str,valuesJson:str,stateJson:str,continue:{type:'boolean'}}),
 fn('wf_verify','Verify the draft end to end: runs tests (testsJson, or empty to use the spec’s acceptance tests) through the executor, renders the real components with the resulting state at desktop and phone width, and reviews the screenshots against the request and every spec requirement. An app is accepted only after it passes.',{testsJson:str}),
];
function findNode(nodes:WorkflowNode[],id:string):{list:WorkflowNode[];index:number;node:WorkflowNode}|null{for(let i=0;i<nodes.length;i++){const n=nodes[i];if(n.id===id)return {list:nodes,index:i,node:n};const inner=n.children?findNode(n.children,id):null;if(inner)return inner;}return null;}
function applyOps(w:any,ops:any[]){
 const doc=JSON.parse(JSON.stringify(w));doc.ui??=[];doc.actions??={};doc.state??={};
 const node=(id:string)=>{const f=findNode(doc.ui,String(id));if(!f)throw Error('No node with id "'+id+'". Use wf_get to see ids.');return f;};
 const childrenOf=(parent:unknown)=>{if(parent==null||parent==='')return doc.ui as WorkflowNode[];const f=node(String(parent));f.node.children??=[];return f.node.children;};
 for(const op of ops){
  switch(op?.op){
   case 'add_node':{const list=childrenOf(op.parent);const i=op.index==null?list.length:Math.max(0,Math.min(list.length,Number(op.index)));list.splice(i,0,op.node);break;}
   case 'update_props':{const f=node(op.id);f.node.props={...(f.node.props||{})};for(const [k,v] of Object.entries(op.props||{})){if(v===null)delete f.node.props[k];else f.node.props[k]=v;}break;}
   case 'set_node':{const f=node(op.id);f.list[f.index]=op.node;break;}
   case 'remove_node':{const f=node(op.id);f.list.splice(f.index,1);break;}
   case 'move_node':{const f=node(op.id);f.list.splice(f.index,1);const list=childrenOf(op.parent);const i=op.index==null?list.length:Math.max(0,Math.min(list.length,Number(op.index)));list.splice(i,0,f.node);break;}
   case 'set_action':doc.actions[String(op.name)]=op.action;break;
   case 'remove_action':delete doc.actions[String(op.name)];break;
   case 'set_state':doc.state[String(op.key)]=op.value;break;
   case 'set_layout':doc.layout=op.layout;break;
   case 'set_title':doc.title=String(op.title||'');break;
   case 'add':case 'replace':case 'remove':return applyOps(applyPatch(doc,[op]),ops.slice(ops.indexOf(op)+1));
   default:throw Error('Unknown op "'+op?.op+'".');
  }
 }
 return doc;
}
function search(query:string,kind:string){
 const q=query.trim().toLowerCase(),words=q.split(/[\s,]+/).filter(Boolean);
 const exactComponent=COMPONENTS[q],exactTool=TOOLS[q];
 if(exactComponent&&kind!=='tool')return {component:{name:q,...exactComponent}};
 if(exactTool&&kind!=='component')return {tool:{name:q,description:exactTool.description,args:exactTool.args,returns:exactTool.returns,...(exactTool.changes?{changes:'only from user actions; drive/connector changes become approval proposals'}:{})}};
 const score=(text:string)=>words.reduce((n,w)=>n+(text.includes(w)?1:0),0);
 const components=kind==='tool'?[]:Object.entries(COMPONENTS).map(([name,c])=>({name,category:c.category,description:c.description,events:c.events,value:c.value,s:score((name+' '+c.category+' '+c.description+' '+Object.keys(c.props).join(' ')).toLowerCase())})).filter(c=>!words.length||c.s>0).sort((a,b)=>b.s-a.s).slice(0,12).map(({s:_s,...c})=>c);
 const tools=kind==='component'?[]:Object.entries(TOOLS).map(([name,t])=>({name,description:t.description,s:score((name+' '+t.description).toLowerCase())})).filter(t=>!words.length||t.s>0).sort((a,b)=>b.s-a.s).slice(0,10).map(({s:_s,...t})=>t);
 return {components,tools,note:'Ask for an exact name to get its full props/args.'};
}
export type Workbench={tools:typeof WORKBENCH_TOOLS;has:(name:string)=>boolean;execute:(name:string,args:Record<string,any>)=>Promise<{data:unknown}>;workflow:()=>Workflow|undefined;spec:()=>AppSpec|undefined;passed:(w:unknown)=>boolean;tests:()=>WorkflowTests};
export function createWorkbench(ctx:Ctx,initial?:{workflow?:unknown;spec?:unknown}):Workbench{
 let draft:any=initial?.workflow?JSON.parse(JSON.stringify(initial.workflow)):undefined,spec:AppSpec|undefined;
 try{if(initial?.spec)spec=appSpecSchema.parse(initial.spec);}catch{}
 let last:{state:Record<string,unknown>;values:Record<string,unknown>;steps:Record<string,unknown>;event:unknown}|null=null,lastTests:WorkflowTests=[];
 const verified=new Set<string>();
 const check=()=>{if(!draft)return {errors:['No draft yet: use wf_set or wf_edit.'],warnings:[]};try{const r=validateWorkflow(draft);return {errors:r.errors,warnings:r.warnings};}catch(e){return {errors:[e instanceof Error?e.message:'Invalid workflow'],warnings:[]};}};
 const toolCtx=(explicit:boolean)=>({userId:ctx.userId,pageId:ctx.pageId,language:ctx.language,explicit,verification:true,signal:ctx.signal});
 const specTests=():WorkflowTests=>(spec?.acceptance||[]).flatMap(a=>a.test?[{...a.test,name:a.test.name||a.requirement.slice(0,100)}]:[]).slice(0,6);
 const execute=async(name:string,a:Record<string,any>)=>{
  if(name==='wf_spec'){spec=appSpecSchema.parse(parse(a.specJson,'specJson'));return {data:{saved:true,spec,acceptanceTests:specTests().length,hint:'Explore data with wf_try_tool, build with wf_set/wf_edit, test with wf_run, finish with wf_verify.'}};}
  if(name==='wf_catalog')return {data:search(String(a.query||''),String(a.kind||'all'))};
  if(name==='wf_get')return {data:{workflow:draft??null,...check(),spec:spec??null}};
  if(name==='wf_set'){draft=parse(a.workflowJson,'workflowJson');draft.kind??='workflow-app';return {data:check()};}
  if(name==='wf_edit'){const ops=parse(a.opsJson,'opsJson');if(!Array.isArray(ops)||!ops.length)throw Error('opsJson must be a non-empty array.');draft=applyOps(draft??{kind:'workflow-app',state:{},ui:[],actions:{}},ops);return {data:check()};}
  if(name==='wf_validate')return {data:check()};
  if(name==='wf_try_tool'){const tool=TOOLS[String(a.tool)];if(!tool)throw Error('Unknown tool. Search with wf_catalog.');if(['files.write','files.zip','markdown.write'].includes(String(a.tool)))return {data:{skipped:'This tool writes a Page file; it runs only inside the app from a user action. Test it with wf_run.'}};const r=await tool.run(parse(a.argsJson,'argsJson')||{},toolCtx(false));return {data:{result:clip(r,30000)}};}
  if(name==='wf_eval'){const scope=parse(a.scopeJson,'scopeJson')??last??{};return {data:{value:clip(await evaluate(String(a.expression),scope),20000)}};}
  if(name==='wf_run'){
   const {workflow,errors}=(()=>{try{const r=validateWorkflow(draft);return r;}catch(e){return {workflow:null,errors:[e instanceof Error?e.message:'Invalid workflow']};}})();
   if(!workflow||errors.length)return {data:{ran:false,errors}};
   const values=parse(a.valuesJson,'valuesJson')||{},state=parse(a.stateJson,'stateJson')??(a.continue&&last?last.state:undefined),action=String(a.action),event={type:action==='load'?'load':'click',source:'workbench'};
   const r=await runAction(workflow,action,{state,values,event},toolCtx(action!=='load'),{keepSteps:true});
   last={state:r.state,values,steps:r.steps,event};
   return {data:{error:r.error??null,state:clip(r.state,12000),steps:Object.fromEntries(Object.entries(r.steps).map(([k,v])=>[k,clip(v,3000)])),trace:r.trace.map(t=>({step:t.step,tool:t.tool,status:t.status,ms:t.ms,error:t.error,items:t.items})),proposals:r.proposals.length}};
  }
  if(name==='wf_verify'){
   const tests=workflowTestsSchema.parse(parse(a.testsJson,'testsJson')||specTests());lastTests=tests;
   const requirements=(spec?.acceptance||[]).map(x=>x.requirement).concat(spec?.outputs||[]).slice(0,16);
   const report=await verifyWorkflow(draft,{request:ctx.request,title:draft?.title||ctx.title,pageId:ctx.pageId,language:ctx.language,requirements,goal:spec?.goal},{userId:ctx.userId,signal:ctx.signal},tests);
   if(report.passed)verified.add(JSON.stringify(validateWorkflow(draft).workflow));
   return {data:JSON.parse(workflowReportText(report))};
  }
  throw Error('Unknown workbench tool.');
 };
 return {tools:WORKBENCH_TOOLS,has:n=>WORKBENCH_TOOLS.some(t=>t.name===n),execute,workflow:()=>{try{return validateWorkflow(draft).workflow;}catch{return undefined;}},spec:()=>spec,passed:w=>{try{return verified.has(JSON.stringify(validateWorkflow(w).workflow));}catch{return false;}},tests:()=>lastTests.length?lastTests:specTests()};
}
