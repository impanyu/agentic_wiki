import {z} from 'zod';
const key=z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);
// A series may use a second, right-hand axis (axis:"right") with its own unit (rightUnit), so
// measures in different units (°C and m/s) can share one chart.
export const chartSchema=z.object({kind:z.literal('chart'),xLabel:z.string().min(1).max(120),unit:z.string().max(120),rightUnit:z.string().max(120).optional(),series:z.array(z.object({key,label:z.string().min(1).max(120),axis:z.enum(['left','right']).optional()})).min(1).max(8),labels:z.object({line:z.string(),bar:z.string(),data:z.string(),download:z.string()})}).strict().superRefine((v,c)=>{if(v.series.some(s=>s.axis==='right')&&!v.rightUnit?.trim())c.addIssue({code:'custom',message:'A series on the right axis needs chart.rightUnit (the unit of that axis).'});if(v.series.every(s=>s.axis==='right'))c.addIssue({code:'custom',message:'Put at least one series on the left axis.'});if(new Set(v.series.map(s=>s.key)).size!==v.series.length)c.addIssue({code:'custom',message:'Duplicate series'});});
export const datasetSchema=z.object({rows:z.array(z.object({x:z.string().min(1).max(120),values:z.record(z.number().finite().nullable()),sources:z.array(z.number().int().positive()).min(1)})).min(1).max(200),sources:z.array(z.object({title:z.string().min(1),url:z.string().url().refine(u=>u.startsWith('https://'))})).min(1).max(40),notes:z.string().max(4000)}).strict();
export type ChartDefinition=z.infer<typeof chartSchema>;
export type ChartDataset=z.infer<typeof datasetSchema>;
export function validateChartData(chart:ChartDefinition,input:unknown){const data=datasetSchema.parse(input);for(const row of data.rows){if(Object.keys(row.values).length!==chart.series.length||chart.series.some(s=>!Object.hasOwn(row.values,s.key))||row.sources.some(n=>n>data.sources.length))throw new Error('Invalid chart data mapping');}if(!data.rows.some(r=>Object.values(r.values).some(v=>v!==null)))throw new Error('No verified observations');return data;}

// Every fenced ```chart block in Markdown must hold a valid {chart,dataset}; returns one message per
// broken block (with its position) so an agent can fix it before a page is saved.
export function chartBlockErrors(body:string):string[]{
 const lines=body.split('\n'),errors:string[]=[];let n=0;
 for(let i=0;i<lines.length;i++){
  if(!/^```chart\s*$/.test(lines[i].trim()))continue;n++;
  const end=lines.findIndex((l,j)=>j>i&&l.trim()==='```');
  if(end<0){errors.push('Chart block '+n+' is not closed with a ``` line.');break;}
  try{const raw=JSON.parse(lines.slice(i+1,end).join('\n')) as {chart?:unknown;dataset?:unknown};validateChartData(chartSchema.parse(raw.chart),raw.dataset);}
  catch(e){errors.push('Chart block '+n+' is invalid and would show as raw text: '+chartProblem(e));}
  i=end;
 }
 return errors;
}
export function chartProblem(e:unknown){
 if(e instanceof z.ZodError)return e.issues.slice(0,4).map(x=>(x.path.join('.')||'chart')+': '+x.message).join('; ')+'. Each row needs sources with at least one 1-based index into dataset.sources, and dataset.sources needs at least one {title,url:https}.';
 return e instanceof Error?e.message:String(e);
}
