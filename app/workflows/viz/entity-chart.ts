// ECharts options of the entity-page charts (trend, radar_profile, relation_graph, location_map).
// No browser APIs: the components build these in effects and hand them to one ECharts instance each.
import {escapeHtml,equalEarth,equalEarthInvert} from './ranking-data';
import {EV_FONT,EV_PALETTE,EV_ACCENT,EV_HOT,type Series,type Annotation,type RadarEntity,type GraphNode,type GraphLink,type RegionKindEv} from './entity-data';
import type {Criterion} from './ranking-data';

type EvFmt=(n:number|null)=>string;
const EV_TOOLTIP={confine:true,renderMode:'html',backgroundColor:'#fff',borderWidth:0,padding:[10,12],textStyle:{color:'#0f172a',fontSize:12,fontFamily:EV_FONT},
 extraCssText:'border-radius:12px;box-shadow:0 12px 32px -8px rgba(15,23,42,.22),0 2px 6px rgba(15,23,42,.06);'};
const evRgba=(hex:string,a:number)=>{const n=parseInt(hex.slice(1),16);return `rgba(${n>>16&255},${n>>8&255},${n&255},${a})`;};
const evAxisLabel={color:'#94a3b8',fontSize:10.5,fontFamily:EV_FONT};

// Lines over shared periods (a category axis in time order); one series fills its area. The component's
// summary line names the series in their colors, so there is no legend. Two series in
// different units get a second y axis. Annotations are dashed vertical markers with a label.
export function trendOption(o:{series:Series[];periods:string[];annotations:Annotation[];log:boolean;area:boolean;fmts:EvFmt[];axisFmts:EvFmt[]}){
 const units=[...new Set(o.series.map(s=>s.unit??''))];
 const dual=o.series.length===2&&units.length===2;
 const at=(s:Series)=>{const m=new Map(s.points.map(p=>[p.period,p.value]));return o.periods.map(p=>m.has(p)?m.get(p)!:null);};
 const many=o.periods.length>40;
 const yAxis=(i:number)=>({type:o.log?'log':'value',scale:!o.log,splitNumber:4,position:i?'right':'left',
  name:dual?units[i]:o.series.length===1?o.series[0].unit??'':units.length===1?units[0]:'',nameTextStyle:{color:'#94a3b8',fontSize:11,align:i?'right':'left'},
  axisLabel:{...evAxisLabel,formatter:(v:number)=>o.axisFmts[dual?i:0](v)},splitLine:{show:!i,lineStyle:{color:'#eef1f6',type:'dashed'}},axisLine:{show:false},axisTick:{show:false}});
 return {textStyle:{fontFamily:EV_FONT},aria:{enabled:true},color:EV_PALETTE,animationDuration:900,
  grid:{left:8,right:dual?8:18,top:28,bottom:many?44:8,containLabel:true},
  tooltip:{...EV_TOOLTIP,trigger:'axis',axisPointer:{type:'line',lineStyle:{color:'#cbd5e1'}},
   formatter:(ps:any[])=>{if(!ps?.length)return '';const head=`<div style="font-weight:600;color:#0f172a;margin-bottom:4px">${escapeHtml(String(ps[0].axisValue))}</div>`;
    return head+ps.filter(p=>p.value!=null).map(p=>`<div style="display:flex;align-items:center;gap:8px;justify-content:space-between;min-width:150px"><span style="color:#64748b">${p.marker}${escapeHtml(p.seriesName||'')}</span><b>${escapeHtml(o.fmts[p.seriesIndex]?.(p.value)??String(p.value))}</b></div>`).join('');}},
  xAxis:{type:'category',boundaryGap:false,data:o.periods,axisLine:{lineStyle:{color:'#e2e8f0'}},axisTick:{show:false},axisLabel:{...evAxisLabel,hideOverlap:true}},
  yAxis:dual?[yAxis(0),yAxis(1)]:yAxis(0),
  dataZoom:many?[{type:'inside',filterMode:'none'},{type:'slider',bottom:6,height:14,showDetail:false,brushSelect:false,borderColor:'transparent',backgroundColor:'#f1f5f9',fillerColor:'rgba(79,124,255,.18)',dataBackground:{lineStyle:{color:'#cbd5e1'},areaStyle:{color:'#e2e8f0'}}}]:[],
  series:o.series.map((s,i)=>{const color=EV_PALETTE[i%EV_PALETTE.length];return {
   type:'line',name:s.label,data:at(s),yAxisIndex:dual?i:0,connectNulls:true,smooth:.15,
   showSymbol:o.periods.length<=24,symbol:'circle',symbolSize:6,lineStyle:{width:2.4,color},itemStyle:{color,borderColor:'#fff',borderWidth:1.5},
   emphasis:{focus:'series'},
   ...(o.area&&(o.series.length===1||i===0)?{areaStyle:{color:{type:'linear',x:0,y:0,x2:0,y2:1,colorStops:[{offset:0,color:evRgba(color,.28)},{offset:1,color:evRgba(color,0)}]}}}:{}),
   ...(i===0&&o.annotations.length?{markLine:{symbol:'none',silent:true,animation:false,
    lineStyle:{color:'#94a3b8',type:'dashed',width:1},
    label:{show:true,position:'insideEndTop',color:'#475569',fontSize:10.5,fontFamily:EV_FONT,backgroundColor:'rgba(255,255,255,.85)',padding:[2,4],borderRadius:4,formatter:(p:any)=>p.data?.name??''},
    data:o.annotations.filter(a=>o.periods.includes(a.period)).map(a=>({xAxis:a.period,name:a.label}))}}:{}),
  };})};
}

// Percentile profile: each axis is one criterion (0 = last of the peers, 100 = first); the dashed ring is the peer median.
export function radarOption(o:{criteria:Criterion[];entities:RadarEntity[];counts:number[];fmts:EvFmt[];medianLabel:string;rankText:(rank:number,of:number)=>string}){
 const ents=o.entities.filter(e=>e.found);
 return {textStyle:{fontFamily:EV_FONT},aria:{enabled:true},color:EV_PALETTE,
  tooltip:{...EV_TOOLTIP,trigger:'item',formatter:(p:any)=>{
   const e=ents[p.dataIndex];if(!e)return escapeHtml(o.medianLabel);
   return `<div style="font-weight:600;color:#0f172a;margin-bottom:4px">${escapeHtml(e.name)}</div>`+o.criteria.map((c,i)=>
    `<div style="display:flex;gap:10px;justify-content:space-between;min-width:200px"><span style="color:#64748b">${escapeHtml(c.label)}</span><span><b>${escapeHtml(o.fmts[i](e.values[i]))}</b>${e.ranks[i]!=null?` <span style="color:#94a3b8">· ${escapeHtml(o.rankText(e.ranks[i]!,o.counts[i]))}</span>`:''}</span></div>`).join('');}},
  radar:{indicator:o.criteria.map(c=>({name:c.label,max:100,min:0})),radius:'68%',center:['50%','52%'],splitNumber:4,shape:'polygon',
   axisName:{color:'#334155',fontSize:11.5,fontWeight:600,fontFamily:EV_FONT},
   splitArea:{areaStyle:{color:['#fbfcfe','#f6f8fc']}},splitLine:{lineStyle:{color:'#e5e9f1'}},axisLine:{lineStyle:{color:'#e5e9f1'}}},
  series:[
   {type:'radar',symbol:'circle',symbolSize:5,emphasis:{lineStyle:{width:3}},
    data:ents.map((e,i)=>{const color=EV_PALETTE[i%EV_PALETTE.length];return {name:e.name,value:e.percentiles.map(p=>p??0),
     lineStyle:{width:2.2,color},itemStyle:{color},areaStyle:{color:evRgba(color,ents.length>1?.12:.22)}};})},
   {type:'radar',silent:true,symbol:'none',z:1,lineStyle:{type:'dashed',color:'#94a3b8',width:1},tooltip:{show:false},
    data:[{name:o.medianLabel,value:o.criteria.map(()=>50)}]}]};
}

// The entity in the middle, related names around it, colored by predicate (legend toggles a predicate).
export function graphOption(o:{nodes:GraphNode[];links:GraphLink[];categories:string[];layout:'force'|'circular'}){
 const n=o.nodes.length;const colors=o.categories.map((_,i)=>EV_PALETTE[(i+1)%EV_PALETTE.length]);
 return {textStyle:{fontFamily:EV_FONT},aria:{enabled:true},animationDuration:800,
  legend:o.categories.length>1?{bottom:0,type:'scroll',icon:'circle',itemWidth:9,itemHeight:9,textStyle:{color:'#475569',fontSize:12},data:o.categories}:undefined,
  tooltip:{...EV_TOOLTIP,trigger:'item',formatter:(p:any)=>{
   if(p.dataType==='edge')return escapeHtml(p.data?.predicate??'');const d=o.nodes[p.dataIndex];if(!d)return '';
   return `<div style="font-weight:600;color:#0f172a">${escapeHtml(d.name)}</div>`+(d.predicates.length?`<div style="color:#64748b;font-size:11px;margin-top:2px">${escapeHtml(d.predicates.join(' · '))}${d.type?' · '+escapeHtml(d.type):''}</div>`:'')+(d.href?`<div style="color:#4f7cff;font-size:11px;margin-top:2px">↗</div>`:'');}},
  series:[{type:'graph',layout:o.layout,roam:'move',draggable:o.layout==='force',zoom:1,
   ...(o.layout==='force'?{force:{repulsion:n>40?170:n>15?320:420,edgeLength:n>40?[70,130]:[110,170],gravity:.1,friction:.15,layoutAnimation:true}}:{circular:{rotateLabel:true}}),
   categories:o.categories.map((name,i)=>({name,itemStyle:{color:colors[i]}})),
   label:{show:true,position:'right',color:'#1e293b',fontSize:11.5,fontFamily:EV_FONT,formatter:(p:any)=>p.data?.txt??''},labelLayout:{hideOverlap:true},
   lineStyle:{color:'source',curveness:o.layout==='circular'?.25:.08,opacity:.55,width:1.3},
   edgeLabel:{show:false},emphasis:{focus:'adjacency',lineStyle:{width:2.4,opacity:.9},edgeLabel:{show:true,formatter:(p:any)=>p.data?.predicate??'',fontSize:10,color:'#475569'}},
   data:o.nodes.map(d=>d.center
    ?{id:d.id,name:d.id,txt:d.name,symbolSize:52,itemStyle:{color:{type:'radial',x:.35,y:.3,r:.9,colorStops:[{offset:0,color:'#7d9dff'},{offset:1,color:EV_ACCENT}]},borderColor:'#fff',borderWidth:3,shadowBlur:18,shadowColor:'rgba(79,124,255,.45)'},
      label:{show:true,position:'bottom',fontWeight:700,fontSize:13,color:'#0f172a'}}
    :{id:d.id,name:d.id,txt:d.name,category:d.category,symbolSize:d.predicates.length>1?24:18,cursor:d.href?'pointer':'default',
      itemStyle:{borderColor:'#fff',borderWidth:2,shadowBlur:6,shadowColor:'rgba(15,23,42,.15)'}}),
   links:o.links.map(l=>({source:l.source,target:l.target,predicate:l.predicate}))}]};
}

// A map zoomed to the entity: its region filled, its point pulsing, nearby places as small dots.
// box: [minX,minY,maxX,maxY] in the map's coordinates (lon/lat on the world map; Albers plane, y up, on U.S. maps).
export function locationOption(o:{kind:RegionKindEv;map:string;regionKey:string|null;box:[number,number,number,number]|null;point:[number,number]|null;
 nearby:{name:string;at:[number,number];href:string|null}[];name:string}){
 const world=o.kind==='world';
 return {textStyle:{fontFamily:EV_FONT},aria:{enabled:true},
  tooltip:{...EV_TOOLTIP,trigger:'item',formatter:(p:any)=>escapeHtml(p.data?.txt??p.name??'')},
  geo:{map:o.map,roam:'move',left:6,right:6,top:6,bottom:6,
   ...(world?{projection:{project:equalEarth,unproject:equalEarthInvert}}:{aspectScale:1}),
   ...(o.box?{boundingCoords:[[o.box[0],o.box[3]],[o.box[2],o.box[1]]]}:{}),
   silent:false,itemStyle:{areaColor:'#eef1f6',borderColor:'#fff',borderWidth:.8},
   emphasis:{disabled:true},tooltip:{show:false},label:{show:false},
   regions:o.regionKey?[{name:o.regionKey,itemStyle:{areaColor:{type:'linear',x:0,y:0,x2:1,y2:1,colorStops:[{offset:0,color:'#7d9dff'},{offset:1,color:EV_ACCENT}]},borderColor:'#fff',borderWidth:1.2,shadowBlur:14,shadowColor:'rgba(79,124,255,.35)'}}]:[]},
  series:[
   {type:'scatter',coordinateSystem:'geo',symbolSize:7,z:3,
    itemStyle:{color:'#fff',borderColor:'#475569',borderWidth:1.5},
    label:{show:true,position:'right',fontSize:11,color:'#334155',formatter:(p:any)=>p.data?.txt??''},labelLayout:{hideOverlap:true},
    data:o.nearby.map(x=>({name:x.name,txt:x.name,value:x.at,href:x.href,cursor:x.href?'pointer':'default'}))},
   ...(o.point?[{type:'effectScatter',coordinateSystem:'geo',z:4,symbolSize:13,rippleEffect:{scale:3.2,brushType:'stroke',period:3.5},
    itemStyle:{color:EV_HOT,borderColor:'#fff',borderWidth:2,shadowBlur:10,shadowColor:'rgba(255,138,76,.6)'},
    label:{show:true,position:'top',distance:8,fontSize:12,fontWeight:700,color:'#0f172a',formatter:(p:any)=>p.data?.txt??'',backgroundColor:'rgba(255,255,255,.9)',padding:[3,6],borderRadius:6},
    data:[{name:o.name,txt:o.name,value:o.point}]}]:[])]};
}
