// Structure summary of any data, however large: field names, types, how often
// each field is present, array lengths, value ranges and a few samples. JSON
// held in a string is described too. Agents read this instead of raw data.
type Acc={n:number;types:Map<string,number>;min?:number;max?:number;samples:Set<string>;lenMin?:number;lenMax?:number;items?:Acc;keys?:Map<string,Acc>;strMin?:number;strMax?:number;inner?:Acc;innerKind?:string};
const acc=():Acc=>({n:0,types:new Map(),samples:new Set()});
const typeOf=(v:unknown)=>v===null?'null':Array.isArray(v)?'array':typeof v;
const DATE=/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
function visit(a:Acc,v:unknown,depth:number,budget:{nodes:number}){
 if(budget.nodes--<=0)return;
 a.n++;const t=typeOf(v);a.types.set(t,(a.types.get(t)||0)+1);
 if(t==='number'){const x=v as number;a.min=a.min===undefined?x:Math.min(a.min,x);a.max=a.max===undefined?x:Math.max(a.max,x);if(a.samples.size<3)a.samples.add(String(x));}
 else if(t==='boolean'){if(a.samples.size<2)a.samples.add(String(v));}
 else if(t==='string'){const s=v as string;a.strMin=Math.min(a.strMin??s.length,s.length);a.strMax=Math.max(a.strMax??0,s.length);if(a.samples.size<3)a.samples.add(s.length>60?s.slice(0,60)+'…':s);
  // JSON (or JSON Lines) inside a string, such as a file read through a connector.
  if(depth<3&&s.length>1&&/^\s*[\[{]/.test(s)&&s.length<=20*1024*1024){try{const parsed=JSON.parse(s);a.inner??=acc();a.innerKind='json';visit(a.inner,parsed,depth+1,budget);}catch{const lines=s.split(/\r?\n/).filter(l=>l.trim());if(lines.length>1){try{const rows=lines.slice(0,500).map(l=>JSON.parse(l));a.inner??=acc();a.innerKind='json lines ('+lines.length+')';visit(a.inner,rows,depth+1,budget);}catch{}}}}}
 else if(t==='array'){const arr=v as unknown[];a.lenMin=Math.min(a.lenMin??arr.length,arr.length);a.lenMax=Math.max(a.lenMax??0,arr.length);if(depth<8){a.items??=acc();const step=Math.max(1,Math.floor(arr.length/200));for(let i=0;i<arr.length;i+=step)visit(a.items,arr[i],depth+1,budget);}}
 else if(t==='object'&&depth<8){a.keys??=new Map();for(const [k,x] of Object.entries(v as object).slice(0,200)){let c=a.keys.get(k);if(!c){if(a.keys.size>=80)continue;c=acc();a.keys.set(k,c);}visit(c,x,depth+1,budget);}}
}
function render(a:Acc,parentCount:number):Record<string,unknown>{
 const types=[...a.types.keys()],out:Record<string,unknown>={type:types.length===1?types[0]:types.join('|')};
 if(parentCount&&a.n<parentCount)out.present=a.n+'/'+parentCount;
 if(a.min!==undefined)out.range=[a.min,a.max];
 if(a.lenMin!==undefined)out.length=a.lenMin===a.lenMax?a.lenMin:[a.lenMin,a.lenMax];
 if(a.samples.size)out.samples=[...a.samples];
 if(a.strMin!==undefined&&[...a.samples].every(s=>DATE.test(s)))out.format='date/time';
 if(a.items)out.items=render(a.items,0);
 if(a.keys)out.fields=Object.fromEntries([...a.keys].map(([k,c])=>[k,render(c,a.types.get('object')||0)]));
 if(a.inner){out.contains=a.innerKind;out.parsed=render(a.inner,0);}
 return out;
}
export function describeData(value:unknown){const a=acc();visit(a,value,0,{nodes:200000});return render(a,0);}
