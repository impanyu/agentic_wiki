import jsonata from 'jsonata';
import {isBinding,LIMITS} from './schema';
// JSONata is an interpreter over JSON with no I/O: an expression can only read
// the scope it is given. Each evaluation is boxed in time and recursion depth
// (evaluation is synchronous-heavy, so the time box also protects the server).
type Compiled=ReturnType<typeof jsonata>;
const cache=new Map<string,Compiled>();
export function compile(text:string):Compiled{
 if(text.length>LIMITS.expressionChars)throw Error('Expression is longer than '+LIMITS.expressionChars+' characters.');
 let c=cache.get(text);if(!c){c=jsonata(text);cache.set(text,c);if(cache.size>2000)cache.delete(cache.keys().next().value!);}
 return c;
}
export function checkExpression(text:string){try{compile(text);return null;}catch(e){const err=e as {message?:string;position?:number};return (err.message||'Invalid expression')+(err.position!==undefined?' at character '+err.position:'');}}
export async function evaluate(text:string,scope:unknown,bindings:Record<string,unknown>={},timeoutMs=1000){
 compile(text);
 // A fresh instance per evaluation: the limit hooks are per run, and JSONata looks them up by symbol.
 const expr=jsonata(text),start=Date.now();let depth=0;
 expr.assign(Symbol.for('jsonata.__evaluate_entry') as unknown as string,()=>{depth++;if(depth>500)throw Error('Expression recursion is too deep.');if(Date.now()-start>timeoutMs)throw Error('Expression took longer than '+timeoutMs+' ms.');});
 expr.assign(Symbol.for('jsonata.__evaluate_exit') as unknown as string,()=>{depth--;});
 // Results are plain JSON: JSONata marks arrays with internal flags and may return functions.
 try{const r=await expr.evaluate(scope,bindings);return r===undefined?undefined:JSON.parse(JSON.stringify(r));}
 catch(e){const err=e as {message?:string};throw Error('Expression "'+text.slice(0,120)+'" failed: '+(err.message||'error'));}
}
// Resolves bindings anywhere inside a value (props, args, state updates).
export async function resolve(value:unknown,scope:unknown,bindings:Record<string,unknown>={}):Promise<unknown>{
 if(isBinding(value))return evaluate(value.$,scope,bindings);
 if(Array.isArray(value))return Promise.all(value.map(v=>resolve(v,scope,bindings)));
 if(value&&typeof value==='object'){const out:Record<string,unknown>={};for(const [k,v] of Object.entries(value))out[k]=await resolve(v,scope,bindings);return out;}
 return value;
}
export function bindingsIn(value:unknown,out:string[]=[]):string[]{
 if(isBinding(value))out.push(value.$);
 else if(Array.isArray(value))value.forEach(v=>bindingsIn(v,out));
 else if(value&&typeof value==='object')Object.values(value).forEach(v=>bindingsIn(v,out));
 return out;
}
// Step ids an expression reads through steps.<id>.
export const stepRefs=(text:string)=>[...text.matchAll(/\bsteps\.([A-Za-z][A-Za-z0-9_]*)/g)].map(m=>m[1]);
