// Pure table operations (no imports): column statistics, row ranges, column selection/renaming and CSV output.
export type Row=Record<string,unknown>;
const missing=(v:unknown)=>v==null||v==='';
export function columnStats(rows:Row[],columns:string[]){
 return columns.map(name=>{
  const values=rows.map(r=>r[name]),present=values.filter(v=>!missing(v));
  const nums=present.filter((v):v is number=>typeof v==='number'&&Number.isFinite(v));
  const base={name,missing:values.length-present.length,distinct:new Set(present.map(v=>typeof v==='object'?JSON.stringify(v):v)).size};
  if(nums.length&&nums.length>=present.length*0.8){
   let min=Infinity,max=-Infinity,sum=0;for(const n of nums){if(n<min)min=n;if(n>max)max=n;sum+=n;}
   return {...base,type:'number',min,max,mean:Number((sum/nums.length).toPrecision(8)),nonNumeric:present.length-nums.length};
  }
  const counts=new Map<string,number>();for(const v of present){const k=typeof v==='object'?JSON.stringify(v).slice(0,80):String(v).slice(0,80);counts.set(k,(counts.get(k)||0)+1);}
  const top=[...counts].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([value,count])=>({value,count}));
  return {...base,type:'text',top};
 });
}
// "" → none, "1-50" → rows 1..50 (1-based, inclusive), "all-if-small" → all when ≤ cap rows.
export function rowRange(spec:string,total:number,cap=200):{start:number;end:number;note?:string}{
 const s=spec.trim().toLowerCase();if(!s)return {start:0,end:0};
 if(s==='all-if-small'||s==='all')return total<=cap?{start:0,end:total}:{start:0,end:0,note:'The dataset has '+total+' rows (more than '+cap+'); ask for a range such as "1-50".'};
 const m=s.match(/^(\d+)\s*(?:-\s*(\d+))?$/);if(!m)throw Error('rows must be "", "all-if-small" or a range such as "1-50".');
 const start=Math.max(1,Number(m[1]))-1,end=Math.min(total,m[2]?Number(m[2]):start+1,start+cap);
 return {start,end,...(m[2]&&Number(m[2])-start>cap?{note:'Showing at most '+cap+' rows per call.'}:{})};
}
export function pickColumns(rows:Row[],available:string[],columns:string[],rename:Record<string,string>={}){
 const keys=columns.length?columns:available;
 const unknown=keys.filter(k=>!available.includes(k));if(unknown.length)throw Error('Unknown column(s): '+unknown.join(', ')+'. Columns: '+available.join(', '));
 const badRename=Object.keys(rename).filter(k=>!keys.includes(k));if(badRename.length)throw Error('rename names column(s) not in the output: '+badRename.join(', '));
 const names=keys.map(k=>String(rename[k]??k));
 return {columns:names,rows:rows.map(r=>Object.fromEntries(keys.map((k,i)=>[names[i],r[k]])))};
}
const cell=(v:unknown)=>{
 if(v==null)return '';
 const s=typeof v==='object'?JSON.stringify(v):String(v);
 return /[",\r\n]|^\s|\s$/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;
};
export function toCsv(rows:Row[],columns:string[]){return [columns.map(cell).join(','),...rows.map(r=>columns.map(c=>cell(r[c])).join(','))].join('\n')+'\n';}
// Rows trimmed to fit a character budget (for tool results).
export function fitRows(rows:Row[],maxChars:number){const out:Row[]=[];let size=2;for(const r of rows){const s=JSON.stringify(r).length+1;if(size+s>maxChars)break;size+=s;out.push(r);}return out;}
