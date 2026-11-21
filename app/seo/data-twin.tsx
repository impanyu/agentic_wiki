import type {ChartDefinition,ChartDataset} from '@/app/components-registry/chart-contracts';
// The data twin of a visualization: the same numbers as a plain HTML table (collapsed under the chart)
// and links to the raw data files, rendered on the server. Crawlers that do not run JavaScript (the
// AI search crawlers: GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot…) read the data even though
// they cannot see the chart. Every chart on a crawlable page gets one; a ranking needs none (its
// leaderboard already lists every row and criterion), only the link to its file.
export type TwinTable={columns:{key:string;label:string}[];rows:Record<string,unknown>[];total:number};
const MAX_ROWS=500,MAX_COLS=14;
const isRow=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const cell=(v:unknown)=>v==null?'':typeof v==='number'?(Number.isInteger(v)?v.toLocaleString('en'):String(Math.round(v*1e6)/1e6)):typeof v==='object'?'':String(v).slice(0,200);

// ```chart block → its dataset as a table.
export function chartTable(chart:ChartDefinition,dataset:ChartDataset):TwinTable{
 const columns=[{key:'x',label:chart.xLabel},...chart.series.map(s=>({key:s.key,label:s.label+(chart.unit?` (${s.axis==='right'&&chart.rightUnit?chart.rightUnit:chart.unit})`:'')}))];
 return {columns,rows:dataset.rows.slice(0,MAX_ROWS).map(r=>({x:r.x,...r.values})),total:dataset.rows.length};
}
// ```component block → the largest list of records among its state (after the load action) and literal props.
export function blockTable(code:string,state?:Record<string,unknown>):TwinTable|null{
 let raw:{state?:Record<string,unknown>;ui?:unknown};try{raw=JSON.parse(code);}catch{return null;}
 const lists:unknown[][]=[];
 const visit=(v:unknown,depth:number)=>{if(depth>6||v==null||typeof v!=='object')return;
  if(Array.isArray(v)){if(v.length&&v.slice(0,20).every(isRow))lists.push(v);else for(const x of v.slice(0,50))visit(x,depth+1);return;}
  for(const x of Object.values(v))visit(x,depth+1);};
 visit({...(raw.state||{}),...(state||{})},0);visit(raw.ui,0);
 const rows=lists.sort((a,b)=>b.length-a.length)[0] as Record<string,unknown>[]|undefined;
 if(!rows||rows.length<2)return null;
 const keys:string[]=[];
 for(const r of rows.slice(0,50))for(const [k,v] of Object.entries(r))if(!keys.includes(k)&&(v==null||typeof v!=='object')&&!/^(image|logo|flag|icon|url|href|question)$/i.test(k))keys.push(k);
 if(!keys.length)return null;
 return {columns:keys.slice(0,MAX_COLS).map(k=>({key:k,label:k.replace(/_/g,' ')})),rows:rows.slice(0,MAX_ROWS),total:rows.length};
}
// Names of the Page files a block reads (page_file.read steps).
export function blockFiles(code:string):string[]{
 return [...new Set([...code.matchAll(/"tool"\s*:\s*"page_file\.read"[^}]*?"name"\s*:\s*"([^"]+)"/g)].map(m=>m[1]))];
}
export const dataFilePath=(pageId:string,name:string)=>'/data/'+encodeURIComponent(pageId)+'/'+encodeURIComponent(name);

export function DataTwin({table,files=[],pageId,label}:{table:TwinTable|null;files?:string[];pageId:string;label:{data:string;download:string;of:(shown:number,total:number)=>string}}){
 if(!table&&!files.length)return null;
 return <div className="data-twin">
  {table&&<details><summary>{label.data}{table.total>table.rows.length?' · '+label.of(table.rows.length,table.total):''}</summary>
   <div className="data-twin-scroll"><table><thead><tr>{table.columns.map(c=><th key={c.key} scope="col">{c.label}</th>)}</tr></thead>
    <tbody>{table.rows.map((r,i)=><tr key={i}>{table.columns.map(c=><td key={c.key}>{cell(r[c.key])}</td>)}</tr>)}</tbody></table></div>
  </details>}
  {files.length>0&&<p className="data-twin-files">{files.map(f=><a key={f} href={dataFilePath(pageId,f)} download>{label.download} {f}</a>)}</p>}
 </div>;
}
