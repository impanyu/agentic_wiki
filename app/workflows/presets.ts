import type {Workflow,WorkflowNode} from './schema';
// A wiki page is a workflow app with a preset backend: load reads the page's
// article through markdown.read, and the article component shows it. Pages
// without a workflow of their own render through this preset.
export const wikiWorkflow:Workflow={kind:'workflow-app',version:1,state:{article:null},layout:{plain:true},
 ui:[{id:'article',type:'article'}],
 actions:{load:{description:'Preset wiki backend: read this page’s article.',steps:[{id:'content',tool:'markdown.read'}],set:{article:{$:'steps.content'}}}}};
export function hasType(nodes:WorkflowNode[],type:string):boolean{return nodes.some(n=>n.type===type||(n.children?hasType(n.children,type):false));}
