import jsonata from 'jsonata';
// JSONata evaluation for data tools: time-boxed, depth-limited, plain-JSON results and errors that
// say where the expression failed and what data was available.
export type Row=Record<string,unknown>;
export async function evaluateJsonata(text:string,scope:unknown,bindings:Record<string,unknown>={},timeoutMs=10_000,describeScope?:()=>string):Promise<unknown>{
 if(text.length>20_000)throw Error('The expression is longer than 20,000 characters.');
 const explain=(e:unknown)=>{
  const err=e as {message?:string;position?:number;token?:string;code?:string};
  const at=err.position!==undefined?' at character '+err.position+' (near "'+text.slice(Math.max(0,err.position-20),err.position+10)+'")':'';
  return Error('JSONata '+(err.code?err.code+' ':'')+'error'+at+': '+(err.message||'invalid expression')+(describeScope?'. Available: '+describeScope():''));
 };
 let expr:ReturnType<typeof jsonata>;try{expr=jsonata(text);}catch(e){throw explain(e);}
 const start=Date.now();let depth=0;
 expr.assign(Symbol.for('jsonata.__evaluate_entry') as unknown as string,()=>{depth++;if(depth>800)throw Error('Expression recursion is too deep.');if(Date.now()-start>timeoutMs)throw Error('Expression took longer than '+timeoutMs/1000+' s; simplify it or filter the data first.');});
 expr.assign(Symbol.for('jsonata.__evaluate_exit') as unknown as string,()=>{depth--;});
 for(const [k,v] of Object.entries(bindings))expr.assign(k,v);
 let r:unknown;
 try{r=await Promise.race([expr.evaluate(scope),new Promise((_,reject)=>setTimeout(()=>reject(Error('Expression took longer than '+timeoutMs/1000+' s.')),timeoutMs+1000))]);}
 catch(e){throw explain(e);}
 return r===undefined?undefined:JSON.parse(JSON.stringify(r));
}
// The result as table rows: an array of objects (a single object becomes one row).
export function resultRows(result:unknown,maxRows:number):{rows:Row[];truncated:boolean}{
 if(result===undefined||result===null)return {rows:[],truncated:false};
 const list=Array.isArray(result)?result:[result];
 const bad=list.find(x=>!x||typeof x!=='object'||Array.isArray(x));
 if(bad!==undefined)throw Error('The expression must return an array of row objects, e.g. data.{"name":name,"value":value}; it returned '+(Array.isArray(bad)?'an array of arrays':typeof bad)+' items.');
 return {rows:list.slice(0,maxRows) as Row[],truncated:list.length>maxRows};
}
