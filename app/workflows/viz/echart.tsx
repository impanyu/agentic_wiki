'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import type {VizProps} from './types';
import {needsEChartsGL,sanitizeEChartOption,withEChartDefaults} from './echart-sanitize';
import './viz.css';

export {sanitizeEChartOption} from './echart-sanitize';

type ECharts=typeof import('echarts');
type Chart=ReturnType<ECharts['init']>;

const FONT='Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const MUTED='#64748b',SPLIT='#eef1f6',AXIS='#e2e8f0';
const axis={axisLine:{show:true,lineStyle:{color:AXIS}},axisTick:{show:false},axisLabel:{color:MUTED,fontSize:11},splitLine:{show:true,lineStyle:{color:SPLIT}},splitArea:{show:false},nameTextStyle:{color:MUTED,fontSize:11}};
const WIKI_THEME={
 color:['#4f7cff','#22c3a6','#ff8a4c','#a46bff','#f2c94c','#ef5da8','#2bb3e0','#7bd389'],
 backgroundColor:'transparent',
 textStyle:{fontFamily:FONT,color:'#0f172a'},
 title:{left:0,top:0,textStyle:{fontSize:15,fontWeight:600,color:'#0f172a'},subtextStyle:{color:MUTED,fontSize:12}},
 legend:{icon:'roundRect',top:0,right:8,itemWidth:12,itemHeight:8,itemGap:14,textStyle:{color:'#475569',fontSize:12}},
 tooltip:{backgroundColor:'#fff',borderWidth:0,padding:10,textStyle:{color:'#0f172a',fontSize:12},
  extraCssText:'border-radius:10px;box-shadow:0 10px 30px -8px rgba(15,23,42,.18),0 2px 6px rgba(15,23,42,.06);',
  axisPointer:{lineStyle:{color:'#cbd5e1',width:1},crossStyle:{color:'#cbd5e1'},shadowStyle:{color:'rgba(79,124,255,.06)'}}},
 categoryAxis:{...axis,splitLine:{show:false}},valueAxis:{...axis,axisLine:{show:false}},logAxis:{...axis,axisLine:{show:false}},timeAxis:{...axis,splitLine:{show:false}},
 bar:{itemStyle:{borderRadius:4}},
 line:{smooth:false,symbol:'circle',symbolSize:6,showSymbol:false,lineStyle:{width:2}},
 pie:{itemStyle:{borderColor:'#fff',borderWidth:2,borderRadius:4}},
 radar:{lineStyle:{width:2},symbolSize:4},
 graph:{lineStyle:{color:'#cbd5e1'}},
 gauge:{axisLine:{lineStyle:{color:[[1,SPLIT]]}}},
 dataZoom:{borderColor:AXIS,fillerColor:'rgba(79,124,255,.1)',handleStyle:{color:'#fff',borderColor:'#94a3b8'},textStyle:{color:MUTED}},
 visualMap:{textStyle:{color:MUTED},inRange:{color:['#eef3ff','#4f7cff','#1e3a8a']}},
};

let echartsP:Promise<ECharts>|null=null;
let glP:Promise<unknown>|null=null;
// The prebuilt bundles of echarts and echarts-gl share one echarts instance (echarts-gl requires 'echarts').
// @ts-ignore
const loadECharts=()=>echartsP??=import('echarts/dist/echarts.js').then(m=>{const e=((m as any).default??m) as ECharts;e.registerTheme('wiki',WIKI_THEME);return e;});
// echarts-gl ships no types; it registers its series/components on the shared echarts instance.
// Its prebuilt bundle is used: the ES-module sources draw grid3D but not surface series under webpack.
// @ts-ignore
const loadGL=()=>glP??=loadECharts().then(()=>import('echarts-gl/dist/echarts-gl.js'));

const errMessage=(e:unknown)=>e instanceof Error?e.message:String(e);

export default function EChart({props,setValue,fire}:VizProps){
 const box=useRef<HTMLDivElement>(null);
 const chart=useRef<Chart|null>(null);
 const handlers=useRef({setValue,fire});handlers.current={setValue,fire};
 const [ready,setReady]=useState(0);
 const [error,setError]=useState('');
 const height=typeof props.height==='number'&&props.height>0?props.height:380;
 const renderer=props.renderer==='svg'?'svg':'canvas';
 const title=typeof props.title==='string'?props.title:'';
 const caption=typeof props.caption==='string'?props.caption:'';
 const key=useMemo(()=>{try{return JSON.stringify(props.option??null);}catch{return 'null';}},[props.option]);
 const option=useMemo(()=>withEChartDefaults(sanitizeEChartOption(JSON.parse(key))),[key]);

 // A chart that shows GL series must be created after echarts-gl registers, so 3D needs a new instance.
 const gl=needsEChartsGL(option);
 useEffect(()=>{
  let dead=false,ro:ResizeObserver|null=null;
  (gl?loadGL().then(loadECharts):loadECharts()).then(echarts=>{
   if(dead||!box.current)return;
   const c=echarts.init(box.current,'wiki',{renderer});chart.current=c;
   c.on('click',(p:any)=>{const v=p.data??{name:p.name,value:p.value,seriesName:p.seriesName};handlers.current.setValue(v);handlers.current.fire('select',v);});
   ro=new ResizeObserver(()=>c.resize());ro.observe(box.current);
   setReady(n=>n+1);
  }).catch(e=>!dead&&setError(errMessage(e)));
  return ()=>{dead=true;ro?.disconnect();chart.current?.dispose();chart.current=null;};
 },[renderer,gl]);

 useEffect(()=>{
  const c=chart.current;if(!c)return;let dead=false;
  (needsEChartsGL(option)?loadGL():Promise.resolve()).then(()=>{
   if(dead||c.isDisposed())return;
   c.setOption(option as any,{notMerge:true});setError('');
  }).catch(e=>!dead&&setError(errMessage(e)));
  return ()=>{dead=true;};
 },[option,ready]);

 return <figure className="wf-viz wf-echart">
  {title&&<div className="wf-viz-title">{title}</div>}
  <div className="wf-echart-wrap" style={{height}}>
   <div ref={box} className="wf-echart-canvas" role="img" aria-label={title||'Chart'}/>
   {error&&<div className="wf-viz-error" role="alert">Chart error: {error}</div>}
  </div>
  {caption&&<figcaption className="wf-viz-caption">{caption}</figcaption>}
 </figure>;
}
