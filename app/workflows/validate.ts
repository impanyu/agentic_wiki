import {COMPONENTS} from './catalog';
import {TOOLS} from './tools';
import {checkExpression,bindingsIn,stepRefs} from './expressions';
import {workflowSchema,LIMITS,type Workflow,type WorkflowNode} from './schema';
// Checks a workflow before it is staged, saved or run. Errors name the path and
// the fix, because they are read by the agent that wrote the workflow.
export function validateWorkflow(raw:unknown):{workflow:Workflow;errors:string[];warnings:string[]}{
 const size=JSON.stringify(raw??null).length;if(size>LIMITS.workflowBytes)throw Error('The workflow is larger than '+LIMITS.workflowBytes+' characters.');
 const parsed=workflowSchema.safeParse(raw);
 if(!parsed.success)throw Error('Invalid workflow: '+parsed.error.issues.slice(0,12).map(i=>(i.path.join('.')||'(root)')+': '+i.message).join('; '));
 const w=parsed.data,errors:string[]=[],warnings:string[]=[],ids=new Map<string,string>(),actions=new Set(Object.keys(w.actions));
 const stateKeys=new Set([...Object.keys(w.state),...Object.values(w.actions).flatMap(a=>Object.keys(a.set||{}))]);
 const expressions:{path:string;text:string}[]=[];let count=0;
 const walk=(node:WorkflowNode,path:string,depth:number)=>{
  count++;if(depth>LIMITS.depth)errors.push(path+': nesting is deeper than '+LIMITS.depth+' levels.');
  const spec=COMPONENTS[node.type];
  if(!spec){errors.push(path+': unknown component "'+node.type+'". Available: '+Object.keys(COMPONENTS).join(', ')+'.');return;}
  if(node.id){if(ids.has(node.id))errors.push(path+': id "'+node.id+'" is already used at '+ids.get(node.id)+'.');ids.set(node.id,path);}
  for(const key of Object.keys(node.props||{}))if(!(key in spec.props))errors.push(path+' ('+node.type+'): unknown prop "'+key+'". Props: '+Object.keys(spec.props).join(', ')+'.');
  for(const [event,action] of Object.entries(node.on||{})){if(!spec.events?.includes(event))errors.push(path+' ('+node.type+'): no "'+event+'" event'+(spec.events?.length?'; events: '+spec.events.join(', '):'')+'.');if(!actions.has(action))errors.push(path+': on.'+event+' runs unknown action "'+action+'".');}
  if(spec.events?.length&&node.on&&!node.id&&spec.value)warnings.push(path+': give this '+node.type+' an id so actions can read its value.');
  if(node.children?.length&&!spec.children)errors.push(path+' ('+node.type+'): this component has no children.');
  if(spec.childType)node.children?.forEach((c,i)=>{if(c.type!==spec.childType)errors.push(path+'.children['+i+']: '+node.type+' children must be '+spec.childType+' nodes.');});
  if(node.type==='tab'&&!path.match(/children\[\d+\]$/))errors.push(path+': tab nodes belong inside tabs.');
  for(const text of bindingsIn(node.props))expressions.push({path:path+'.props',text});
  if(node.visible!==undefined)for(const text of bindingsIn(node.visible))expressions.push({path:path+'.visible',text});
  node.children?.forEach((c,i)=>walk(c,path+'.children['+i+']',depth+1));
 };
 w.ui.forEach((n,i)=>walk(n,'ui['+i+']',1));
 if(count>LIMITS.nodes)errors.push('The page has '+count+' components; the limit is '+LIMITS.nodes+'.');
 if(actions.size>LIMITS.actions)errors.push('Use at most '+LIMITS.actions+' actions.');
 for(const [name,action] of Object.entries(w.actions)){
  const seen=new Set<string>();
  action.steps.forEach((s,i)=>{
   const path='actions.'+name+'.steps['+i+'] ('+s.id+')',tool=TOOLS[s.tool];
   if(seen.has(s.id))errors.push(path+': step id repeats.');
   if(!tool)errors.push(path+': unknown tool "'+s.tool+'". Tools: '+Object.keys(TOOLS).join(', ')+'.');
   for(const text of [...bindingsIn(s.args),...bindingsIn(s.when),...bindingsIn(s.each)]){expressions.push({path,text});for(const ref of stepRefs(text))if(!seen.has(ref))errors.push(path+': reads steps.'+ref+', which is not an earlier step of this action.');}
   if(s.tool==='code.run'){if(typeof s.args?.code!=='string'||!s.args.code.trim())errors.push(path+': code.run needs its source as a literal string in args.code (code is never assembled from data).');if(!['javascript','python'].includes(String(s.args?.language)))errors.push(path+': code.run needs args.language "javascript" or "python" as a literal.');if(s.each!==undefined)errors.push(path+': code.run cannot run inside each; pass the whole list as input and loop in the code.');}
   if(s.each!==undefined&&!bindingsIn(s.each).length)errors.push(path+': each must be a binding to a list; inside args use $item and $index.');
   if(name==='load'&&tool?.changes&&['files.write','files.zip','markdown.write'].includes(s.tool))errors.push(path+': the load action runs without a user action, so it cannot write files. Run it from a button or form.');
   seen.add(s.id);
  });
  if(action.steps.filter(s=>s.tool==='code.run').length>3)errors.push('actions.'+name+': use at most 3 code.run steps per action.');
  for(const text of bindingsIn(action.set))expressions.push({path:'actions.'+name+'.set',text});
  if(action.then&&!actions.has(action.then))errors.push('actions.'+name+'.then: unknown action "'+action.then+'".');
 }
 for(const {path,text} of expressions){
  const problem=checkExpression(text);if(problem){errors.push(path+': '+problem+' in "'+text.slice(0,120)+'".');continue;}
  const bare=missingDollar(text);if(bare){errors.push(path+': JSONata functions start with $: write $'+bare+'(…) instead of '+bare+'(…) in "'+text.slice(0,120)+'".');continue;}
  for(const m of text.matchAll(/\bvalues\.([A-Za-z][A-Za-z0-9_]*)/g))if(!ids.has(m[1]))errors.push(path+': values.'+m[1]+' refers to no component id.');
  for(const m of text.matchAll(/\bstate\.([A-Za-z][A-Za-z0-9_]*)/g))if(!stateKeys.has(m[1]))errors.push(path+': state.'+m[1]+' is neither in the initial state nor set by any action.');
 }
 if(!Object.keys(w.actions).length&&!expressions.length)warnings.push('The app has no actions and no bindings; it only shows fixed content.');
 return {workflow:w,errors:[...new Set(errors)].slice(0,40),warnings:warnings.slice(0,20)};
}
// Built-in functions written without $ parse but fail at run time ("Attempted to invoke a non-function").
const BUILTINS='not|count|sum|max|min|average|exists|keys|string|number|round|floor|ceil|abs|power|sqrt|substring|substringBefore|substringAfter|contains|split|join|length|lowercase|uppercase|trim|pad|replace|match|distinct|sort|reverse|filter|map|reduce|merge|lookup|append|now|millis|fromMillis|toMillis|boolean|type|spread|each|sift|zip|shuffle|formatNumber|formatInteger|parseInteger|single|eval|base64encode|base64decode|encodeUrl|decodeUrl';
const BARE=new RegExp('(?<![$\\w.\'"])('+BUILTINS+')\\s*\\(');
export function missingDollar(text:string){const stripped=text.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g,'""');const m=BARE.exec(stripped);return m?m[1]:null;}
export function assertWorkflow(raw:unknown){const r=validateWorkflow(raw);if(r.errors.length)throw Error('The workflow has problems: '+r.errors.join(' | '));return r;}
