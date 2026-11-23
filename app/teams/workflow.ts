// A small workflow engine (the model of LangGraph's StateGraph, without its dependencies): a workflow is a graph of
// named nodes over one shared state. Each node does its work and returns what it adds to the state; an edge says
// which node runs next — a fixed node, or a decision over the state (a branch; edges back make loops, which the
// decision bounds by counting visits). After every node the state and the next node are checkpointed, so a run cut
// off by a restart resumes at the next node. The graph is data too: it can be validated, listed and drawn.
export const END='end';
export type State=Record<string,unknown>&{_visits?:Record<string,number>};
export type NodeDef<S extends State,C>={
 id:string;
 // Who does it (editor, collector, reviewer, manager, system) and what it delivers, for the charter and the diagram.
 role:string;title:string;
 run:(s:S,ctx:C)=>Promise<Partial<S>|void>;
 // A failed node is recorded as skipped and the run goes on ("skip"), or the run stops ("stop").
 onFail?:'skip'|'stop';
};
type Route<S>={to:(s:S)=>string;targets:string[];label?:string};
export class WorkflowStopped extends Error{constructor(public node:string,message:string){super(message);}}
export class Workflow<S extends State,C>{
 readonly nodes=new Map<string,NodeDef<S,C>>();readonly routes=new Map<string,Route<S>>();start='';
 constructor(readonly id:string,readonly title:string){}
 node(def:NodeDef<S,C>){if(this.nodes.has(def.id))throw Error('Duplicate node '+def.id);if(!this.start)this.start=def.id;this.nodes.set(def.id,def);return this;}
 // a → b → c …: fixed edges.
 then(...ids:string[]){for(let i=0;i+1<ids.length;i++){const to=ids[i+1];this.routes.set(ids[i],{to:()=>to,targets:[to]});}return this;}
 // A decision: the next node is chosen from targets by the state.
 branch(from:string,targets:string[],to:(s:S)=>string,label?:string){this.routes.set(from,{to,targets,label});return this;}
 // Every edge leads to a node of the graph or to END, every node has a way out, and every node can be reached.
 validate(){
  const problems:string[]=[];
  for(const id of this.nodes.keys())if(!this.routes.has(id))problems.push('Node '+id+' has no edge (use then(id, END)).');
  for(const [from,r] of this.routes){if(!this.nodes.has(from))problems.push('Edge from unknown node '+from+'.');for(const t of r.targets)if(t!==END&&!this.nodes.has(t))problems.push('Edge '+from+' → unknown node '+t+'.');}
  const seen=new Set<string>([this.start]);const stack=[this.start];
  while(stack.length){const r=this.routes.get(stack.pop()!);for(const t of r?.targets||[])if(t!==END&&!seen.has(t)){seen.add(t);stack.push(t);}}
  for(const id of this.nodes.keys())if(!seen.has(id))problems.push('Node '+id+' cannot be reached.');
  return problems;
 }
 next(from:string,s:S){const r=this.routes.get(from);if(!r)throw Error('No edge from '+from);const t=r.to(s);if(!r.targets.includes(t))throw Error('Edge '+from+' chose '+t+', not one of '+r.targets.join(', '));return t;}
 async run(state:S,ctx:C,{at,checkpoint,log=()=>{},maxSteps=80}:{at?:string;checkpoint?:(s:S,next:string)=>Promise<void>;log?:(e:Record<string,unknown>)=>void;maxSteps?:number}={}):Promise<S>{
  let cur=at||this.start;
  if(at&&at!==this.start)log({event:'resumed',step:at});
  for(let steps=0;cur!==END;steps++){
   if(steps>=maxSteps)throw new WorkflowStopped(cur,'Workflow '+this.id+' exceeded '+maxSteps+' steps');
   const node=this.nodes.get(cur);if(!node)throw Error('Unknown node '+cur);
   state._visits={...state._visits,[cur]:(state._visits?.[cur]||0)+1};
   log({event:'stage_started',step:cur,role:node.role});
   try{const patch=await node.run(state,ctx);if(patch)Object.assign(state,patch);log({event:'stage_finished',step:cur});}
   catch(e){const msg=(e as Error).message.slice(0,500);log({event:'stage_failed',step:cur,error:msg});
    if(node.onFail!=='skip')throw new WorkflowStopped(cur,msg);
    (state as State)[cur]={skipped:msg};}
   const next=this.next(cur,state);
   await checkpoint?.(state,next);
   cur=next;
  }
  return state;
 }
 // Where a checkpoint written before this engine (stage results keyed by node id, no next node) resumes: the first
 // node along the fixed edges that has no result yet.
 resumePoint(s:S):string{
  let cur=this.start;
  for(let i=0;i<this.nodes.size&&cur!==END&&cur in s;i++){try{cur=this.next(cur,s);}catch{return cur;}}
  return cur;
 }
 // Mermaid flowchart of the graph (nodes with their role, decisions labelled with their targets).
 mermaid(){
  const lines=['flowchart TD'];const q=(t:string)=>'"'+t.replace(/"/g,"'")+'"';
  for(const n of this.nodes.values())lines.push('  '+n.id.replace(/-/g,'_')+'['+q(n.role+': '+n.title)+']');
  lines.push('  end_(["end"])');
  for(const [from,r] of this.routes)for(const t of r.targets)lines.push('  '+from.replace(/-/g,'_')+(r.targets.length>1?' -.-> ':' --> ')+(t===END?'end_':t.replace(/-/g,'_')));
  return lines.join('\n');
 }
 describe(){return {id:this.id,title:this.title,start:this.start,nodes:[...this.nodes.values()].map(n=>({id:n.id,role:n.role,title:n.title,onFail:n.onFail||'stop'})),
  edges:[...this.routes].map(([from,r])=>({from,to:r.targets,decision:r.targets.length>1?(r.label||'decision'):undefined}))};}
}
export const visits=(s:State,id:string)=>s._visits?.[id]||0;
