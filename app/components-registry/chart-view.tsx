'use client';
import {useUi} from '@/app/i18n/client';
import {useState} from 'react';
import {ResponsiveContainer,LineChart,BarChart,Line,Bar,XAxis,YAxis,CartesianGrid,Tooltip,Brush} from 'recharts';
import type {ChartDefinition,ChartDataset} from './chart-contracts';
const colors=['var(--app-accent, #2563eb)','#e07622','#149174','#a14cbe','#da4569','#637b21','#526474','#a17c00'];
export function ChartView({chart,dataset,tableFirst=false}:{chart:ChartDefinition;dataset:ChartDataset;tableFirst?:boolean}){
 const {t,locale}=useUi();
 const [mode,setMode]=useState<'line'|'bar'>('line'),[hidden,setHidden]=useState<string[]>([]),[table,setTable]=useState(tableFirst);
 const rows=dataset.rows.map(r=>({x:r.x,...r.values}));
 const download=()=>{const cell=(v:unknown)=>'"'+String(v??'').replaceAll('"','""')+'"';const csv=[[chart.xLabel,...chart.series.map(s=>s.label+' ('+chart.unit+')')],...dataset.rows.map(r=>[r.x,...chart.series.map(s=>r.values[s.key])])].map(r=>r.map(cell).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='chart-data.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 const axes=<><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="x" tick={{fontSize:14}}/><YAxis width={75} tick={{fontSize:14}} domain={mode==='bar'?[0,'auto']:['auto','auto']}/><Tooltip contentStyle={{borderRadius:8,fontSize:14}}/><Brush dataKey="x" height={25} stroke="#718096"/></>;
 return <section className="interactive-chart" aria-label={chart.xLabel+' · '+chart.unit}>
  <div className="chart-toolbar"><span>{chart.unit}</span><div><button aria-pressed={mode==='line'} onClick={()=>setMode('line')}>{t('Line chart')}</button><button aria-pressed={mode==='bar'} onClick={()=>setMode('bar')}>{t('Bar chart')}</button><button aria-expanded={table} onClick={()=>setTable(!table)}>{t('Data table')}</button><button onClick={download}>{t('Download CSV')}</button></div></div>
  <div className="chart-series">{chart.series.map((s,i)=><button key={s.key} style={{color:colors[i],opacity:hidden.includes(s.key)?.4:1}} aria-pressed={!hidden.includes(s.key)} onClick={()=>setHidden(hidden.includes(s.key)?hidden.filter(k=>k!==s.key):[...hidden,s.key])}>● {s.label}</button>)}</div>
  <div style={{width:'100%',height:380,minWidth:0}}><ResponsiveContainer width="100%" height="100%">{mode==='line'?<LineChart data={rows} margin={{top:15,right:20,left:0,bottom:10}} accessibilityLayer>{axes}{chart.series.filter(s=>!hidden.includes(s.key)).map(s=><Line key={s.key} name={s.label} dataKey={s.key} type="linear" stroke={colors[chart.series.indexOf(s)]} strokeWidth={2.5} connectNulls={false} isAnimationActive={false}/>)}</LineChart>:<BarChart data={rows} margin={{top:15,right:20,left:0,bottom:10}} accessibilityLayer>{axes}{chart.series.filter(s=>!hidden.includes(s.key)).map(s=><Bar key={s.key} name={s.label} dataKey={s.key} fill={colors[chart.series.indexOf(s)]} isAnimationActive={false}/>)}</BarChart>}</ResponsiveContainer></div>
  {table&&<div className="chart-table"><table><thead><tr><th>{chart.xLabel}</th>{chart.series.map(s=><th key={s.key}>{s.label}</th>)}</tr></thead><tbody>{dataset.rows.map((r,i)=><tr key={i}><th>{r.x} <sup>{r.sources.map(n=><a key={n} href={'#source-'+n}>[{n}]</a>)}</sup></th>{chart.series.map(s=><td key={s.key}>{r.values[s.key]===null?'—':r.values[s.key]?.toLocaleString(undefined,{maximumFractionDigits:8})}</td>)}</tr>)}</tbody></table></div>}
 </section>;
}
