import {z} from 'zod';
// Public, transparent ranking metrics. A derived metric is DECLARATIVE: a JSON definition naming
// observed (or other derived) metrics, per-input transforms, a normalisation, a combination rule,
// weights and a missing-data rule. No code runs; this module validates and evaluates it.
export const METRIC_KEY=/^[a-z][a-z0-9_]{0,63}$/;
// Denominators used by the per_capita and per_km2 transforms (observed metric keys).
export const DENOMINATORS={per_capita:'population',per_km2:'area_km2'} as const;
const metricRef=z.string().regex(/^[a-z][a-z0-9_]{0,63}(@\d+)?$/,'metric key like "gdp_ppp" (optionally "key@2" for a derived metric version)');
const period=z.union([z.enum(['latest','same']),z.string().regex(/^\d{4}([-/][\w]{1,4})?$/,'"latest", "same" or a period such as "2023"')]);
export const derivedInput=z.object({
 metric:metricRef,
 version:z.number().int().positive().optional(),
 period:period.default('latest'),
 transform:z.enum(['none','log','per_capita','per_km2','rank_pct']).default('none'),
 label:z.string().max(120).optional(),
}).strict();
export const derivedDefinition=z.object({
 inputs:z.array(derivedInput).min(1).max(20),
 normalize:z.enum(['none','minmax','zscore','rank_pct']).default('none'),
 combine:z.enum(['weighted_sum','weighted_geomean','ratio','difference']),
 weights:z.array(z.number().finite()).max(20).optional(),
 missing:z.enum(['skip_entity','reweight','zero']).default('skip_entity'),
 min_inputs:z.number().int().min(1).max(20).optional(),
 scope:z.object({type:z.string().regex(/^[a-z][a-z0-9_]{0,40}$/),filter:z.record(z.unknown()).optional()}).strict(),
}).strict().superRefine((d,ctx)=>{
 const n=d.inputs.length;
 if(d.combine==='weighted_sum'||d.combine==='weighted_geomean'){
  if(!d.weights)ctx.addIssue({code:'custom',path:['weights'],message:'weights are required for '+d.combine+' (one per input).'});
  else if(d.weights.length!==n)ctx.addIssue({code:'custom',path:['weights'],message:`weights has ${d.weights.length} numbers for ${n} inputs.`});
  else if(d.weights.every(w=>w===0))ctx.addIssue({code:'custom',path:['weights'],message:'at least one weight must be non-zero.'});
 }else{
  if(n!==2)ctx.addIssue({code:'custom',path:['inputs'],message:d.combine+' takes exactly 2 inputs (numerator/minuend first).'});
  if(d.weights)ctx.addIssue({code:'custom',path:['weights'],message:'weights apply only to weighted_sum and weighted_geomean.'});
 }
 if(d.min_inputs&&d.min_inputs>n)ctx.addIssue({code:'custom',path:['min_inputs'],message:'min_inputs exceeds the number of inputs.'});
 const seen=new Set<string>();
 d.inputs.forEach((i,k)=>{const id=i.metric+'|'+i.transform+'|'+i.period;if(seen.has(id))ctx.addIssue({code:'custom',path:['inputs',k],message:'duplicate input.'});seen.add(id);});
});
export type DerivedDefinition=z.infer<typeof derivedDefinition>;
export type DerivedInput=z.infer<typeof derivedInput>;
export function parseDefinition(raw:unknown):DerivedDefinition{
 const r=derivedDefinition.safeParse(typeof raw==='string'?JSON.parse(raw):raw);
 if(!r.success)throw Error('Invalid derived metric definition: '+r.error.issues.map(i=>(i.path.join('.')||'definition')+': '+i.message).join('; '));
 return r.data;
}
// "gdp@2" → {key:'gdp',version:2}
export function parseMetricRef(ref:string):{key:string;version?:number}{
 const m=/^([a-z][a-z0-9_]{0,63})(?:@(\d+))?$/.exec(ref.trim());
 if(!m)throw Error('Invalid metric key "'+ref+'": use lower-case letters, digits and _ (e.g. "population", "hdi@2").');
 return m[2]?{key:m[1],version:Number(m[2])}:{key:m[1]};
}

export type Point={value:number;period:string};
export type EvalData={inputs:Map<string,Point>[];denominators:{population:Map<string,Point>;area_km2:Map<string,Point>}};
export type EvalOptions={weights?:number[];drop?:number};

function transform(kind:DerivedInput['transform'],values:Map<string,Point>,d:EvalData['denominators']):Map<string,Point>{
 const out=new Map<string,Point>();
 if(kind==='rank_pct')return percentRanks(values);
 for(const [id,p] of values){
  let v:number|null=p.value;
  if(kind==='log')v=p.value>0?Math.log(p.value):null;
  else if(kind==='per_capita'||kind==='per_km2'){const den=(kind==='per_capita'?d.population:d.area_km2).get(id)?.value;v=den&&den>0?p.value/den:null;}
  if(v!=null&&Number.isFinite(v))out.set(id,{value:v,period:p.period});
 }
 return out;
}
// Percentile rank in [0,1]: highest value → 1, ties share the average position.
function percentRanks(values:Map<string,Point>):Map<string,Point>{
 const list=[...values].sort((a,b)=>a[1].value-b[1].value),n=list.length,out=new Map<string,Point>();
 for(let i=0;i<n;){let j=i;while(j+1<n&&list[j+1][1].value===list[i][1].value)j++;const pct=n===1?1:((i+j)/2)/(n-1);for(let k=i;k<=j;k++)out.set(list[k][0],{value:pct,period:list[k][1].period});i=j+1;}
 return out;
}
function normalize(kind:DerivedDefinition['normalize'],values:Map<string,Point>):Map<string,Point>{
 if(kind==='none'||values.size===0)return values;
 if(kind==='rank_pct')return percentRanks(values);
 const xs=[...values.values()].map(p=>p.value),out=new Map<string,Point>();
 if(kind==='minmax'){const lo=Math.min(...xs),hi=Math.max(...xs);for(const [id,p] of values)out.set(id,{value:hi===lo?1:(p.value-lo)/(hi-lo),period:p.period});return out;}
 const mean=xs.reduce((a,b)=>a+b,0)/xs.length,sd=Math.sqrt(xs.reduce((a,b)=>a+(b-mean)**2,0)/xs.length);
 for(const [id,p] of values)out.set(id,{value:sd===0?0:(p.value-mean)/sd,period:p.period});
 return out;
}
const maxPeriod=(ps:string[])=>ps.reduce((a,b)=>b>a?b:a,'');
// Evaluates a definition over prepared inputs (one map entity → latest point per input, already
// restricted to the scope). options.weights overrides the weights, options.drop removes one input
// (both for sensitivity analysis). Returns entity → {value, period, inputsUsed}.
// A composite index (weighted_sum, weighted_geomean) is a score from 0 to 100, higher is better: inputs on a 0–1 scale
// (minmax, rank_pct) give 100 × their weighted mean, a negative weight marking a measure where lower is better (its
// scale reversed, 1 − x); other inputs (z-scores, raw values) are combined as defined and the result is rescaled so
// the lowest scores 0 and the highest 100. Ratios and differences stay real quantities.
export const isComposite=(def:Pick<DerivedDefinition,'combine'>)=>def.combine==='weighted_sum'||def.combine==='weighted_geomean';
export function evaluateDefinition(def:DerivedDefinition,data:EvalData,options:EvalOptions={}):Map<string,Point&{inputsUsed:number}>{
 const raw=evaluateRaw(def,data,options);
 if(!isComposite(def))return raw;
 if(unitScale(def)){for(const p of raw.values())p.value=Math.round(p.value*100*1e6)/1e6;return raw;}
 const xs=[...raw.values()].map(p=>p.value);if(!xs.length)return raw;
 const lo=Math.min(...xs),hi=Math.max(...xs);
 for(const p of raw.values())p.value=hi===lo?100:Math.round((p.value-lo)/(hi-lo)*100*1e6)/1e6;
 return raw;
}
const unitScale=(def:DerivedDefinition)=>def.normalize==='minmax'||def.normalize==='rank_pct';
// The formula in readers' words, shown with the index ("Score 0–100 = 100 × (40% × rating + …)").
export function formulaText(def:DerivedDefinition,label:(key:string)=>string):string{
 if(!isComposite(def)){const [a,b]=def.inputs.map(i=>inputText(i,label));return def.combine==='ratio'?`${a} ÷ ${b}.`:`${a} − ${b}.`;}
 const ws=def.weights||def.inputs.map(()=>1),tot=ws.reduce((x,w)=>x+Math.abs(w),0)||1;
 const terms=def.inputs.map((i,k)=>`${Math.round(Math.abs(ws[k])/tot*100)}% × ${inputText(i,label)}${ws[k]<0?' (lower is better)':''}`);
 const mean=def.combine==='weighted_geomean'?'weighted geometric mean':'weighted average';
 const scale=def.normalize==='minmax'?'each measure first rescaled from 0 (lowest member) to 1 (highest)':def.normalize==='rank_pct'?'each measure first turned into a percentile (0 lowest, 1 highest)':def.normalize==='zscore'?'each measure first standardized (z-score)':'';
 const missing=def.missing==='skip_entity'?' Members missing any of these measures are not scored.':def.missing==='reweight'?' A missing measure is left out and the other weights are scaled up.':' A missing measure counts as 0.';
 return `Score from 0 to 100, higher is better: the ${mean} of ${terms.join(', ')}`+(scale?`, ${scale}`:'')+(unitScale(def)?', times 100.':'; the result is rescaled so the lowest member scores 0 and the highest 100.')+missing;
}
function inputText(i:DerivedInput,label:(key:string)=>string):string{
 const l=i.label||label(i.metric.split('@')[0]);
 return i.transform==='log'?`log(${l})`:i.transform==='per_capita'?`${l} per person`:i.transform==='per_km2'?`${l} per km²`:i.transform==='rank_pct'?`percentile of ${l}`:l;
}
function evaluateRaw(def:DerivedDefinition,data:EvalData,options:EvalOptions={}):Map<string,Point&{inputsUsed:number}>{
 const idx=def.inputs.map((_,i)=>i).filter(i=>i!==options.drop);
 const weights0=options.weights||def.weights||def.inputs.map(()=>1);
 // On a 0–1 scale a negative weight is a measure where lower is better: its scale reversed, its weight positive.
 const flip=unitScale(def)&&isComposite(def);
 const weights=flip?weights0.map(w=>Math.abs(w)):weights0;
 const series=idx.map(i=>{const n=normalize(def.normalize,transform(def.inputs[i].transform,data.inputs[i]||new Map(),data.denominators));
  if(!flip||(weights0[i]??0)>=0)return n;const out=new Map<string,Point>();for(const [id,p] of n)out.set(id,{value:1-p.value,period:p.period});return out;});
 const ids=new Set<string>();for(const s of series)for(const id of s.keys())ids.add(id);
 const geo=def.combine==='weighted_geomean',floor=def.normalize==='minmax'||def.normalize==='rank_pct'?0.01:0;
 const needed=def.missing==='skip_entity'?idx.length:Math.min(idx.length,def.min_inputs??1);
 const out=new Map<string,Point&{inputsUsed:number}>();
 for(const id of ids){
  const present=series.map(s=>s.get(id));const count=present.filter(Boolean).length;
  if(count<needed||count===0)continue;
  if(def.combine==='ratio'||def.combine==='difference'){
   if(idx.length<2)continue;const a=present[0],b=present[1];if(!a||!b)continue;
   const v=def.combine==='ratio'?(b.value===0?null:a.value/b.value):a.value-b.value;
   if(v!=null&&Number.isFinite(v))out.set(id,{value:v,period:maxPeriod([a.period,b.period]),inputsUsed:2});continue;
  }
  let num=0,den=0,ok=true;const periods:string[]=[];
  present.forEach((p,k)=>{const w=weights[idx[k]]??0;
   let x:number|null=p?p.value:def.missing==='zero'?0:null;
   if(x==null)return;// reweight: skip the input, its weight drops out
   if(p)periods.push(p.period);
   if(geo){x=Math.max(x,floor);if(x<=0){ok=false;return;}num+=w*Math.log(x);}else num+=w*x;
   den+=Math.abs(w);});
  if(!ok||den===0)continue;
  const v=geo?Math.exp(num/den):num/den;
  if(Number.isFinite(v))out.set(id,{value:v,period:maxPeriod(periods),inputsUsed:count});
 }
 return out;
}
// Competition ranks (1,2,2,4) for a value map; order 'desc' means higher is better.
export function competitionRanks(values:Map<string,{value:number}>,order:'desc'|'asc'='desc'):Map<string,number>{
 const list=[...values].sort((a,b)=>order==='desc'?b[1].value-a[1].value:a[1].value-b[1].value),ranks=new Map<string,number>();
 list.forEach(([id,p],i)=>ranks.set(id,i>0&&list[i-1][1].value===p.value?ranks.get(list[i-1][0])!:i+1));
 return ranks;
}
