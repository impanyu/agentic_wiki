import {blockWorkflow,componentBlocks,excludedComponents} from './component-block';
import {validateWorkflow} from './validate';
// Problems in an article's ```component blocks, phrased for the agent that wrote them.
export function componentBlockErrors(body:string):string[]{
 const errors:string[]=[];
 for(const b of componentBlocks(body)){
  const at='Component block at line '+b.line+': ';
  if(!b.closed){errors.push(at+'close it with a ``` line.');continue;}
  let raw:unknown;try{raw=JSON.parse(b.code);}catch(e){errors.push(at+'invalid JSON ('+(e instanceof Error?e.message:'parse error')+').');continue;}
  try{
   const w=blockWorkflow(raw),excluded=excludedComponents(w);
   if(excluded.length)errors.push(at+excluded.join(', ')+' cannot be used in an article.');
   const r=validateWorkflow(w);for(const e of r.errors.slice(0,6))errors.push(at+e);
   for(const e of unsetState(w))errors.push(at+e);
  }catch(e){errors.push(at+(e instanceof Error?e.message.slice(0,600):'invalid block'));}
 }
 return errors.slice(0,12);
}

// A binding to a state value that starts empty and that no action ever sets shows nothing:
// the usual slip is a load step whose result is never stored.
function unsetState(w:ReturnType<typeof blockWorkflow>):string[]{
 const used=new Set([...JSON.stringify(w.ui).matchAll(/\bstate\.([A-Za-z_][A-Za-z0-9_]*)/g)].map(m=>m[1]));
 const set=new Set(Object.values(w.actions||{}).flatMap(a=>Object.keys(((a as {set?:Record<string,unknown>}).set)||{})));
 const empty=(v:unknown)=>v==null||v===''||(Array.isArray(v)&&!v.length)||(typeof v==='object'&&!Array.isArray(v)&&!Object.keys(v as object).length);
 return [...used].filter(n=>!set.has(n)&&empty((w.state as Record<string,unknown>)?.[n])).map(n=>'state.'+n+' is shown but starts empty and no action sets it: store a step result, e.g. "set":{"'+n+'":{"$":"steps.<stepId>"}} in the load action, or name the step "'+n+'".');
}
