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
  }catch(e){errors.push(at+(e instanceof Error?e.message.slice(0,600):'invalid block'));}
 }
 return errors.slice(0,12);
}
