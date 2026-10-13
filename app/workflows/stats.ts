// Common statistics for apps, so typical analysis needs neither hand-written
// JSONata nor code.run. Inputs are lists of records (objects); numbers held as
// text ("12.5", "1,234") are read as numbers, blanks and non-numbers are missing.
type Rec=Record<string,unknown>;
export const num=(v:unknown):number|null=>{if(typeof v==='number')return Number.isFinite(v)?v:null;if(typeof v==='boolean')return null;if(typeof v!=='string')return null;const s=v.trim().replace(/,(?=\d{3}(\D|$))/g,'');if(!s)return null;const n=Number(s);return Number.isFinite(n)?n:null;};
const rows=(v:unknown):Rec[]=>{if(!Array.isArray(v))throw Error('Pass rows: a list of objects (e.g. steps.read.records).');if(v.length>200_000)throw Error('At most 200,000 rows.');return v.filter(r=>r&&typeof r==='object'&&!Array.isArray(r)) as Rec[];};
const round=(n:number|null,d=6)=>n==null||!Number.isFinite(n)?null:Math.round(n*10**d)/10**d;
const sorted=(xs:number[])=>[...xs].sort((a,b)=>a-b);
export function quantile(s:number[],q:number){if(!s.length)return null;const p=(s.length-1)*q,lo=Math.floor(p),hi=Math.ceil(p);return s[lo]+(s[hi]-s[lo])*(p-lo);}
function summary(xs:number[],total:number){
 const s=sorted(xs),n=s.length,mean=n?s.reduce((a,b)=>a+b,0)/n:null;
 const variance=n>1&&mean!=null?s.reduce((a,b)=>a+(b-mean)**2,0)/(n-1):null;
 return {count:n,missing:total-n,sum:round(s.reduce((a,b)=>a+b,0)),mean:round(mean),median:round(quantile(s,0.5)),std:round(variance==null?null:Math.sqrt(variance)),min:n?s[0]:null,max:n?s[n-1]:null,q1:round(quantile(s,0.25)),q3:round(quantile(s,0.75))};
}
const fieldsOf=(list:Rec[])=>[...new Set(list.slice(0,1000).flatMap(r=>Object.keys(r)))];
const numericFields=(list:Rec[])=>fieldsOf(list).filter(f=>{let seen=0,ok=0;for(const r of list.slice(0,1000)){const v=r[f];if(v==null||v==='')continue;seen++;if(num(v)!=null)ok++;}return seen>0&&ok/seen>=0.9;});
export function describe(a:Rec){
 const list=rows(a.rows),fields:string[]=Array.isArray(a.fields)&&a.fields.length?a.fields.map(String):numericFields(list);
 const numeric=Object.fromEntries(fields.map(f=>[f,summary(list.map(r=>num(r[f])).filter((x):x is number=>x!=null),list.length)]));
 const others=fieldsOf(list).filter(f=>!fields.includes(f)).slice(0,30).map(f=>{const counts=new Map<string,number>();for(const r of list){const v=r[f];if(v==null||v==='')continue;const k=typeof v==='object'?JSON.stringify(v):String(v);counts.set(k,(counts.get(k)||0)+1);}return {field:f,distinct:counts.size,top:[...counts].sort((x,y)=>y[1]-x[1]).slice(0,5).map(([value,count])=>({value,count}))};});
 return {rows:list.length,numeric,fields:Object.keys(numeric).map(f=>({field:f,...numeric[f]})),categorical:others};
}
const AGG=new Set(['count','sum','mean','median','min','max','std','first','last','distinct']);
export function group(a:Rec){
 const list=rows(a.rows),by=(Array.isArray(a.by)?a.by:a.by!=null?[a.by]:[]).map(String);
 const metrics:{field?:string;op:string;as:string}[]=(Array.isArray(a.metrics)&&a.metrics.length?a.metrics:[{op:'count'}]).map((m:any)=>{const op=String(m?.op||'count');if(!AGG.has(op))throw Error('Unknown aggregate "'+op+'". Use '+[...AGG].join(', ')+'.');if(op!=='count'&&!m?.field)throw Error(op+' needs a field.');return {field:m?.field?String(m.field):undefined,op,as:String(m?.as||(op==='count'?'count':op+'_'+m.field))};});
 const groups=new Map<string,{key:Rec;items:Rec[]}>();
 for(const r of list){const key=Object.fromEntries(by.map(f=>[f,r[f]??null]));const k=JSON.stringify(by.map(f=>r[f]??null));let g=groups.get(k);if(!g)groups.set(k,g={key,items:[]});g.items.push(r);}
 const out=[...groups.values()].map(({key,items})=>{const row:Rec={...key};for(const m of metrics){const vals=m.field?items.map(r=>r[m.field!]):items;const ns=vals.map(num).filter((x):x is number=>x!=null);
  row[m.as]=m.op==='count'?(m.field?vals.filter(v=>v!=null&&v!=='').length:items.length):m.op==='first'?vals[0]??null:m.op==='last'?vals[vals.length-1]??null:m.op==='distinct'?new Set(vals.map(v=>JSON.stringify(v))).size:(()=>{const s=summary(ns,ns.length);return m.op==='sum'?s.sum:m.op==='mean'?s.mean:m.op==='median'?s.median:m.op==='min'?s.min:m.op==='max'?s.max:s.std;})();}
  return row;});
 const sort=a.sort?String(a.sort):null,desc=a.descending===true;
 if(sort)out.sort((x,y)=>{const p=x[sort],q=y[sort],np=num(p),nq=num(q);const c=np!=null&&nq!=null?np-nq:String(p??'').localeCompare(String(q??''));return desc?-c:c;});
 return a.limit?out.slice(0,Math.max(1,Number(a.limit))):out;
}
export function histogram(a:Rec){
 const list=rows(a.rows),field=String(a.field||'');if(!field)throw Error('histogram needs a field.');
 const xs=list.map(r=>num(r[field])).filter((x):x is number=>x!=null);if(!xs.length)return [];
 const min=a.min!=null?Number(a.min):Math.min(...xs),max=a.max!=null?Number(a.max):Math.max(...xs);
 const bins=Math.max(1,Math.min(200,Number(a.bins)||Math.ceil(Math.sqrt(xs.length))||1)),width=(max-min)/bins||1;
 const out=Array.from({length:bins},(_,i)=>({from:round(min+i*width),to:round(min+(i+1)*width),label:'',count:0}));
 for(const x of xs){if(x<min||x>max)continue;const i=Math.min(bins-1,Math.floor((x-min)/width));out[i].count++;}
 for(const b of out)b.label=b.from+'–'+b.to;
 return out;
}
function pairs(list:Rec[],x:string,y:string){const p:[number,number][]=[];for(const r of list){const a=num(r[x]),b=num(r[y]);if(a!=null&&b!=null)p.push([a,b]);}return p;}
function pearson(p:[number,number][]){const n=p.length;if(n<2)return null;const mx=p.reduce((s,[a])=>s+a,0)/n,my=p.reduce((s,[,b])=>s+b,0)/n;let sxy=0,sxx=0,syy=0;for(const [a,b] of p){sxy+=(a-mx)*(b-my);sxx+=(a-mx)**2;syy+=(b-my)**2;}return sxx&&syy?sxy/Math.sqrt(sxx*syy):null;}
export function correlate(a:Rec){
 const list=rows(a.rows),fields:string[]=Array.isArray(a.fields)&&a.fields.length?a.fields.map(String):numericFields(list).slice(0,20);
 const matrix=fields.map(f=>({field:f,...Object.fromEntries(fields.map(g=>[g,round(pearson(pairs(list,f,g)),4)]))}));
 const strongest=fields.flatMap((f,i)=>fields.slice(i+1).map(g=>({x:f,y:g,r:round(pearson(pairs(list,f,g)),4),n:pairs(list,f,g).length}))).filter(c=>c.r!=null).sort((p,q)=>Math.abs(q.r!)-Math.abs(p.r!));
 return {fields,matrix,pairs:strongest};
}
export function regress(a:Rec){
 const list=rows(a.rows),x=String(a.x||''),y=String(a.y||'');if(!x||!y)throw Error('regression needs x and y fields.');
 const p=pairs(list,x,y),n=p.length;if(n<2)throw Error('Need at least two rows with numbers in both '+x+' and '+y+'.');
 const mx=p.reduce((s,[u])=>s+u,0)/n,my=p.reduce((s,[,v])=>s+v,0)/n;let sxy=0,sxx=0,sst=0;for(const [u,v] of p){sxy+=(u-mx)*(v-my);sxx+=(u-mx)**2;sst+=(v-my)**2;}
 if(!sxx)throw Error(x+' has the same value in every row.');
 const slope=sxy/sxx,intercept=my-slope*mx,sse=p.reduce((s,[u,v])=>s+(v-(intercept+slope*u))**2,0);
 const xs=p.map(([u])=>u),lo=Math.min(...xs),hi=Math.max(...xs);
 return {n,slope:round(slope),intercept:round(intercept),r2:round(sst?1-sse/sst:1,4),r:round(pearson(p),4),line:[{[x]:lo,[y]:round(intercept+slope*lo)},{[x]:hi,[y]:round(intercept+slope*hi)}],predict:(Array.isArray(a.predict)?a.predict:[]).slice(0,100).map((v:unknown)=>{const u=num(v);return {[x]:u,[y]:u==null?null:round(intercept+slope*u)};})};
}
