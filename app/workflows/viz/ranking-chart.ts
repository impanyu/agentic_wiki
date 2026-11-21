// Chart options of the ranking component, shared by the browser (interactive ECharts canvas) and the
// server (the same chart rendered to SVG for the crawlable page). No browser APIs here.
import {type Criterion,type Entry,escapeHtml} from './ranking-data';
export type Fmt=(n:number|null)=>string;
export const FONT='Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
export const PALETTE=['#4f7cff','#22c3a6','#ff8a4c','#a46bff','#f2c94c','#ef5da8','#2bb3e0','#7bd389'];
export const MAP_COLORS=['#e8efff','#b9cdff','#7d9dff','#4f7cff','#2f4fd6','#1e2f86'];
export const MAP_BOTTOM=44,MAP_ASPECT=2.28;
export const MEDAL=['#e8a400','#8d99ab','#c0773a'];
export const errMessage=(e:unknown)=>e instanceof Error?e.message:String(e);
export const rgba=(hex:string,a:number)=>{const n=parseInt(hex.slice(1),16);return `rgba(${n>>16&255},${n>>8&255},${n&255},${a})`;};
export const gradient=(hex:string,reverse=false)=>({type:'linear',x:0,y:0,x2:1,y2:0,colorStops:[{offset:0,color:reverse?hex:rgba(hex,.55)},{offset:1,color:reverse?rgba(hex,.55):hex}]});
export const NEG='#f43f5e';
export const clip=(s:string,n:number)=>s.length>n?s.slice(0,n-1)+'…':s;

export function tooltipHtml(e:Entry,c:Criterion,fmt:Fmt,rankLabel:string){
 return `<div style="font-family:${FONT};min-width:140px"><div style="font-weight:600;font-size:13px;color:#0f172a">${e.rank!=null?`<span style="color:#4f7cff">#${e.rank}</span> · `:''}${escapeHtml(e.name)}</div>`+
  `<div style="color:#64748b;font-size:11px;margin-top:4px">${escapeHtml(c.label)}${c.year?' · '+escapeHtml(c.year):''}</div>`+
  `<div style="font-weight:700;font-size:15px;color:#0f172a;margin-top:2px">${escapeHtml(e.value==null?rankLabel:fmt(e.value))}</div></div>`;
}
export const TOOLTIP={trigger:'item',confine:true,renderMode:'html',backgroundColor:'#fff',borderWidth:0,padding:[10,12],extraCssText:'border-radius:12px;box-shadow:0 12px 32px -8px rgba(15,23,42,.22),0 2px 6px rgba(15,23,42,.06);'};

// Horizontal bars, rank 1 on top; ranks sit in medal pills on the category axis.
export function barOption(o:{shown:Entry[];c:Criterion;fmt:Fmt;axisFmt:Fmt;colorOf:(e:Entry)=>string;window?:number;compact?:boolean;noData:string}){
 const {shown,c,fmt,axisFmt,colorOf}=o;
 const pill=(bg:string,fg:string)=>({backgroundColor:bg,color:fg,borderRadius:9,padding:[3,0,2,0],width:22,align:'center',fontSize:10,fontWeight:700});
 const zoom=o.window&&shown.length>o.window;
 return {
  textStyle:{fontFamily:FONT},animationDuration:900,animationDurationUpdate:750,animationEasing:'cubicOut',animationEasingUpdate:'cubicInOut',
  aria:{enabled:true},
  grid:{left:4,right:o.compact?52:72,top:6,bottom:6,containLabel:true},
  tooltip:{...TOOLTIP,formatter:(p:any)=>{const e=shown[p.dataIndex];return e?tooltipHtml(e,c,fmt,o.noData):'';}},
  xAxis:{type:'value',...(shown.some(e=>e.value!<0)?{min:(v:{min:number;max:number})=>v.min-(v.max-v.min)*.16}:{}),splitNumber:4,axisLabel:{show:!o.compact,hideOverlap:true,color:'#94a3b8',fontSize:10,formatter:(v:number)=>axisFmt(v)},splitLine:{show:!o.compact,lineStyle:{color:'#eef1f6',type:'dashed'}},axisLine:{show:false},axisTick:{show:false}},
  yAxis:{type:'category',inverse:true,data:shown.map((_,i)=>String(i)),axisLine:{show:false},axisTick:{show:false},
   axisLabel:{color:'#334155',fontSize:o.compact?11:12,margin:10,
    formatter:(v:string)=>{const e=shown[Number(v)];if(!e)return '';const r=e.rank??0;return `{${r>=1&&r<=3?'m'+r:'r'}|${r}}  {n|${clip(e.name,o.compact?14:20).replace(/[{}|]/g,'')}}`;},
    rich:{r:pill('#f1f5f9','#475569'),m1:pill(MEDAL[0],'#fff'),m2:pill(MEDAL[1],'#fff'),m3:pill(MEDAL[2],'#fff'),n:{color:'#1e293b',fontSize:o.compact?11:12,fontWeight:500}}}},
  dataZoom:zoom?[
   {type:'inside',yAxisIndex:0,filterMode:'none',startValue:0,endValue:o.window!-1,zoomOnMouseWheel:false,moveOnMouseWheel:false,moveOnMouseMove:true},
   {type:'slider',yAxisIndex:0,filterMode:'none',startValue:0,endValue:o.window!-1,right:4,width:8,showDetail:false,brushSelect:false,zoomLock:true,borderColor:'transparent',backgroundColor:'#f1f5f9',fillerColor:'rgba(79,124,255,.35)',handleSize:0,moveHandleSize:0,showDataShadow:false}]:[],
  series:[{id:'rank',type:'bar',barMaxWidth:o.compact?14:20,barCategoryGap:'34%',showBackground:true,backgroundStyle:{color:'rgba(148,163,184,.08)',borderRadius:8},
   data:shown.map(e=>{const neg=e.value!<0;return {value:e.value,name:e.name,itemStyle:{color:gradient(neg?NEG:colorOf(e),neg),borderRadius:neg?[8,0,0,8]:[0,8,8,0]},label:{position:neg?'left':'right'}};}),
   label:{show:true,position:'right',distance:6,color:'#334155',fontSize:11,fontWeight:600,formatter:(p:any)=>fmt(p.value)},
   emphasis:{focus:'none',itemStyle:{shadowBlur:14,shadowColor:'rgba(79,124,255,.35)'}},
   animationDelay:(i:number)=>Math.min(i,30)*22,universalTransition:true}],
 };
}

// Vertical bars (columns), rank 1 on the left: the plot under the leaderboard.
export function columnOption(o:{shown:Entry[];c:Criterion;fmt:Fmt;axisFmt:Fmt;window?:number;noData:string}){
 const {shown,c,fmt,axisFmt}=o;
 const zoom=o.window&&shown.length>o.window;
 const colors=(e:Entry)=>{const r=e.rank??0;const top=r>=1&&r<=3?MEDAL[r-1]:'#4f7cff';const neg=e.value!<0;const base=neg?NEG:top;
  return {type:'linear',x:0,y:0,x2:0,y2:1,colorStops:[{offset:0,color:base},{offset:1,color:rgba(base,.35)}]};};
 const rotate=shown.length>12&&!zoom?40:zoom?40:0;
 return {
  textStyle:{fontFamily:FONT},animationDuration:900,animationDurationUpdate:750,animationEasing:'cubicOut',animationEasingUpdate:'cubicInOut',aria:{enabled:true},
  grid:{left:8,right:16,top:28,bottom:zoom?44:12,containLabel:true},
  tooltip:{...TOOLTIP,formatter:(p:any)=>{const e=shown[p.dataIndex];return e?tooltipHtml(e,c,fmt,o.noData):'';}},
  xAxis:{type:'category',data:shown.map((_,i)=>String(i)),axisLine:{lineStyle:{color:'#e2e8f0'}},axisTick:{show:false},
   axisLabel:{interval:0,rotate,color:'#475569',fontSize:11,margin:10,hideOverlap:false,
    formatter:(v:string)=>{const e=shown[Number(v)];return e?clip(e.name,rotate?16:12):'';}}},
  yAxis:{type:'value',splitNumber:4,axisLabel:{color:'#94a3b8',fontSize:10,formatter:(v:number)=>axisFmt(v)},splitLine:{lineStyle:{color:'#eef1f6',type:'dashed'}},axisLine:{show:false},axisTick:{show:false}},
  dataZoom:zoom?[
   {type:'inside',xAxisIndex:0,filterMode:'none',startValue:0,endValue:o.window!-1,zoomOnMouseWheel:false,moveOnMouseWheel:true,moveOnMouseMove:true},
   {type:'slider',xAxisIndex:0,filterMode:'none',startValue:0,endValue:o.window!-1,bottom:6,height:10,showDetail:false,brushSelect:false,zoomLock:true,borderColor:'transparent',backgroundColor:'#f1f5f9',fillerColor:'rgba(79,124,255,.35)',handleSize:0,moveHandleSize:0,showDataShadow:false}]:[],
  series:[{id:'rank',type:'bar',barMaxWidth:34,barCategoryGap:'28%',
   data:shown.map(e=>({value:e.value,name:e.name,itemStyle:{color:colors(e),borderRadius:e.value!<0?[0,0,6,6]:[6,6,0,0]}})),
   label:{show:shown.length<=24&&!zoom,position:'top',distance:4,color:'#334155',fontSize:10,fontWeight:600,formatter:(p:any)=>axisFmt(p.value)},
   emphasis:{focus:'none',itemStyle:{shadowBlur:14,shadowColor:'rgba(79,124,255,.35)'}},
   animationDelay:(i:number)=>Math.min(i,40)*18,universalTransition:true}],
 };
}

// Identifies one ranking chart view: the ranking's criteria and the criterion drawn.
export const chartKey=(criteria:string[],criterion:string)=>criteria.join(',')+'|'+criterion;
