import {COMPONENTS} from './catalog';
import type {Workflow,WorkflowNode} from './schema';
// A form's value is the object of its inputs' values by id. It is derived, not
// typed, so it is added wherever values are read: bindings on the page, actions
// in the browser or on the server, and verification.
export function withFormValues(workflow:Pick<Workflow,'ui'>,values:Record<string,unknown>):Record<string,unknown>{
 const out={...values};
 const inputs=(nodes:WorkflowNode[],into:Record<string,unknown>)=>{for(const c of nodes){if(c.id&&c.type!=='form'&&COMPONENTS[c.type]?.value)into[c.id]=values[c.id];if(c.children)inputs(c.children,into);}};
 const visit=(nodes:WorkflowNode[])=>{for(const n of nodes){if(n.type==='form'&&n.id){const own=values[n.id]&&typeof values[n.id]==='object'?values[n.id] as Record<string,unknown>:{};const derived:Record<string,unknown>={};inputs(n.children||[],derived);out[n.id]={...derived,...Object.fromEntries(Object.entries(own).filter(([,v])=>v!==undefined))};}if(n.children)visit(n.children);}};
 visit(workflow.ui);return out;
}
