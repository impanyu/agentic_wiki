// Chart options of the ranking component, shared by the browser (interactive ECharts canvas) and the
// server (the same chart rendered to SVG for the crawlable page). No browser APIs here.
import {type Criterion,type Entry,escapeHtml,colorScale,equalEarth,equalEarthInvert} from './ranking-data';
import type {GeoKind} from './ranking-geo';
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

// ───────────── more views of one criterion ─────────────
// The views a ranking can show under its leaderboard. "auto" picks by the data: share views only for
// quantities that add up (population, GDP, sales — not rates or averages), maps when the entities are
// countries or U.S. states, a scatter when there is a second criterion.
export const RANKING_VIEWS=['bar','treemap','donut','map','map3d','scatter'] as const;
export type RankingViewKind=typeof RANKING_VIEWS[number];
export function autoViews(o:{additive:boolean;geo:GeoKind|null;criteria:number}):RankingViewKind[]{
 return ['bar',...(o.additive?['treemap','donut'] as const:[]),...(o.geo?['map','map3d'] as const:[]),...(o.criteria>=2?['scatter'] as const:[])];
}
export function pickViews(raw:unknown,auto:RankingViewKind[]):RankingViewKind[]{
 if(!Array.isArray(raw))return auto;
 const asked=raw.filter((v):v is RankingViewKind=>RANKING_VIEWS.includes(v as RankingViewKind));
 // A view the data cannot support (a map of non-geographic entities, shares of a rate) is dropped.
 const ok=asked.filter(v=>v==='bar'||auto.includes(v));
 return ok.length?[...new Set(ok)]:auto;
}
const OTHERS_COLOR='#cbd5e1';
const shareText=(v:number,total:number)=>total>0?(v/total*100).toFixed(v/total>=.1?0:1)+'%':'';
// Treemap: every entity's area is its share of the total (the top 60 and "Others").
export function treemapOption(o:{ranked:Entry[];c:Criterion;fmt:Fmt;othersLabel:string;noData:string}){
 const pos=o.ranked.filter(e=>e.value!>0),total=pos.reduce((a,e)=>a+e.value!,0);
 const top=pos.slice(0,60),rest=pos.slice(60),restSum=rest.reduce((a,e)=>a+e.value!,0);
 const color=(i:number)=>i<3?MEDAL[i]:PALETTE[i%PALETTE.length];
 const data=top.map((e,i)=>({name:e.name,value:e.value,entry:e,itemStyle:{color:color(i)}}));
 if(restSum>0)data.push({name:o.othersLabel+' ('+rest.length+')',value:restSum,entry:undefined as unknown as Entry,itemStyle:{color:OTHERS_COLOR}});
 return {textStyle:{fontFamily:FONT},aria:{enabled:true},
  tooltip:{...TOOLTIP,formatter:(p:any)=>{const e:Entry|undefined=p.data?.entry;const share=shareText(p.value,total);
   return e?tooltipHtml(e,o.c,o.fmt,o.noData).replace(/<\/div>$/,`<div style="color:#64748b;font-size:11px;margin-top:2px">${share}</div></div>`):`<div style="font-family:${FONT}"><b>${escapeHtml(p.name)}</b><div>${escapeHtml(o.fmt(p.value))} · ${share}</div></div>`;}},
  series:[{type:'treemap',roam:false,nodeClick:false,breadcrumb:{show:false},left:0,right:0,top:0,bottom:0,
   itemStyle:{borderColor:'#fff',borderWidth:2,gapWidth:2,borderRadius:6},
   label:{show:true,formatter:(p:any)=>`{n|${p.name}}\n{v|${shareText(p.value,total)}}`,rich:{n:{fontSize:12,fontWeight:600,color:'#fff',lineHeight:16},v:{fontSize:11,color:'rgba(255,255,255,.85)'}},overflow:'truncate'},
   upperLabel:{show:false},data}]};
}
// Donut: the top 9 and "Others", with the share of each.
export function donutOption(o:{ranked:Entry[];c:Criterion;fmt:Fmt;othersLabel:string;noData:string}){
 const pos=o.ranked.filter(e=>e.value!>0),total=pos.reduce((a,e)=>a+e.value!,0);
 const top=pos.slice(0,9),restSum=pos.slice(9).reduce((a,e)=>a+e.value!,0);
 const data=top.map((e,i)=>({name:e.name,value:e.value,itemStyle:{color:i<3?MEDAL[i]:PALETTE[(i+1)%PALETTE.length]}}));
 if(restSum>0)data.push({name:o.othersLabel,value:restSum,itemStyle:{color:OTHERS_COLOR}});
 return {textStyle:{fontFamily:FONT},aria:{enabled:true},
  tooltip:{...TOOLTIP,formatter:(p:any)=>`<div style="font-family:${FONT}"><div style="font-weight:600;color:#0f172a">${escapeHtml(p.name)}</div><div style="font-weight:700;font-size:15px;margin-top:2px">${escapeHtml(o.fmt(p.value))}</div><div style="color:#64748b;font-size:11px">${shareText(p.value,total)}</div></div>`},
  legend:{type:'scroll',orient:'vertical',right:8,top:'middle',textStyle:{color:'#334155',fontSize:12},itemWidth:10,itemHeight:10,icon:'circle',
   formatter:(n:string)=>{const d=data.find(x=>x.name===n);return d?`${clip(n,22)}  ${shareText(d.value!,total)}`:n;}},
  series:[{type:'pie',radius:['46%','78%'],center:['36%','50%'],avoidLabelOverlap:true,itemStyle:{borderColor:'#fff',borderWidth:2,borderRadius:6},
   label:{show:true,position:'inside',formatter:(p:any)=>p.percent>=6?Math.round(p.percent)+'%':'',color:'#fff',fontSize:11,fontWeight:600},
   emphasis:{scale:true,scaleSize:6},data}]};
}
// Choropleth: each country or state colored by its value (log scale when values span 100×).
export function choroplethOption(o:{ranked:Entry[];c:Criterion;fmt:Fmt;kind:GeoKind;map:string;keyOf:(e:Entry)=>string|null;names:Map<string,string>;noData:string}){
 const {c,fmt}=o;const seen=new Set<string>();const data:any[]=[];
 const scale=colorScale(o.ranked.map(e=>e.value!));
 for(const e of o.ranked){const k=o.keyOf(e);if(!k||seen.has(k))continue;seen.add(k);data.push({name:k,value:scale.log?Math.log10(e.value!):e.value,entry:e});}
 const real=(v:number)=>scale.log?10**v:v;
 return {textStyle:{fontFamily:FONT},animationDurationUpdate:700,animationEasingUpdate:'cubicInOut',aria:{enabled:true},
  tooltip:{...TOOLTIP,formatter:(p:any)=>{const e:Entry|undefined=p.data?.entry;if(e)return tooltipHtml(e,c,fmt,o.noData);
   return `<div style="font-family:${FONT}"><div style="font-weight:600;color:#0f172a">${escapeHtml(o.names.get(p.name)??p.name)}</div><div style="color:#94a3b8;font-size:11px;margin-top:2px">${escapeHtml(o.noData)}</div></div>`;}},
  visualMap:[{type:'continuous',min:scale.min,max:scale.max,orient:'horizontal',left:8,bottom:4,itemWidth:10,itemHeight:160,calculable:true,realtime:true,
   textStyle:{color:'#64748b',fontSize:11},formatter:(v:number)=>fmt(real(v)),
   inRange:{color:c.order==='asc'?[...MAP_COLORS].reverse():MAP_COLORS},handleStyle:{borderColor:'#fff',shadowBlur:4,shadowColor:'rgba(15,23,42,.2)'},indicatorStyle:{borderColor:'#fff'}}],
  series:[{id:'map',type:'map',map:o.map,roam:true,scaleLimit:{min:1,max:12},left:'center',top:6,bottom:MAP_BOTTOM,selectedMode:false,
   ...(o.kind==='world'?{projection:{project:equalEarth,unproject:equalEarthInvert}}:{aspectScale:1}),
   label:{show:false},itemStyle:{areaColor:'#eceff5',borderColor:'#fff',borderWidth:.6},
   emphasis:{label:{show:false},itemStyle:{areaColor:'#ff8a4c',borderColor:'#fff',borderWidth:1,shadowBlur:12,shadowColor:'rgba(15,23,42,.25)'}},
   data}]};
}
// 3D height map (echarts-gl): each region is extruded in proportion to its value and colored by it.
export function heightMapOption(o:{ranked:Entry[];c:Criterion;fmt:Fmt;kind:GeoKind;map:string;keyOf:(e:Entry)=>string|null;names:Map<string,string>;noData:string}){
 const {c,fmt}=o;const seen=new Set<string>();const data:any[]=[];
 const vals=o.ranked.map(e=>e.value!).filter(v=>v>0);const max=Math.max(...vals,1),min=Math.min(...vals,max);
 const log=min>0&&max/min>=100;// Heights keep the real differences (square root, so the largest do not dwarf everything); colors use a log scale when values span 100×.
 const h=(v:number)=>v<=0?0.3:0.6+14*Math.sqrt(v/max);
 for(const e of o.ranked){const k=o.keyOf(e);if(!k||seen.has(k))continue;seen.add(k);data.push({name:k,value:log?Math.log10(Math.max(e.value!,min)):e.value,height:h(e.value!),entry:e});}
 const lo=log?Math.log10(min):Math.min(...o.ranked.map(e=>e.value!)),hi=log?Math.log10(max):max;
 return {textStyle:{fontFamily:FONT},
  tooltip:{...TOOLTIP,formatter:(p:any)=>{const e:Entry|undefined=p.data?.entry;return e?tooltipHtml(e,c,fmt,o.noData):`<div style="font-family:${FONT}"><b>${escapeHtml(o.names.get(p.name)??p.name)}</b><div style="color:#94a3b8">${escapeHtml(o.noData)}</div></div>`;}},
  visualMap:[{type:'continuous',min:lo,max:hi===lo?lo+1:hi,orient:'horizontal',left:8,bottom:4,itemWidth:10,itemHeight:160,calculable:false,
   textStyle:{color:'#64748b',fontSize:11},formatter:(v:number)=>fmt(log?10**v:v),inRange:{color:c.order==='asc'?[...MAP_COLORS].reverse():MAP_COLORS}}],
  series:[{type:'map3D',map:o.map,boxWidth:o.kind==='us'?120:160,boxDepth:o.kind==='us'?75:80,regionHeight:0.5,shading:'lambert',
   light:{main:{intensity:1.1,shadow:true,alpha:40,beta:30},ambient:{intensity:.45}},
   viewControl:{distance:o.kind==='us'?105:125,alpha:40,beta:0,minAlpha:10,maxAlpha:85,panMouseButton:'left',rotateMouseButton:'right'},
   groundPlane:{show:false},itemStyle:{color:'#e2e8f0',borderWidth:.5,borderColor:'#fff'},
   label:{show:false},emphasis:{label:{show:false},itemStyle:{color:'#ff8a4c'}},data}]};
}
// Scatter: this criterion against another, one dot per entity; log axes when values span 1000×; the top 8 labelled.
export function scatterOption(o:{entries:{name:string;row:Record<string,unknown>;rank?:number|null}[];x:Criterion;y:Criterion;fx:Fmt;fy:Fmt;value:(row:Record<string,unknown>,key:string)=>number|null}){
 const pts=o.entries.map(e=>({e,x:o.value(e.row,o.x.key),y:o.value(e.row,o.y.key)})).filter(p=>p.x!=null&&p.y!=null) as {e:{name:string;rank?:number|null};x:number;y:number}[];
 const logOf=(vs:number[])=>vs.length>2&&Math.min(...vs)>0&&Math.max(...vs)/Math.min(...vs)>=1000;
 const lx=logOf(pts.map(p=>p.x)),ly=logOf(pts.map(p=>p.y));
 const top=new Set([...pts].sort((a,b)=>o.x.order==='asc'?a.x-b.x:b.x-a.x).slice(0,8).map(p=>p.e.name));
 const axis=(c:Criterion,f:Fmt,log:boolean)=>({type:log?'log':'value',name:c.label+(c.unit&&c.format!=='currency'&&c.format!=='percent'?` (${c.unit})`:''),nameLocation:'middle',nameGap:30,nameTextStyle:{color:'#64748b',fontSize:11},
  scale:true,axisLabel:{color:'#94a3b8',fontSize:10,formatter:(v:number)=>f(v)},splitLine:{lineStyle:{color:'#eef1f6',type:'dashed'}},axisLine:{show:false},axisTick:{show:false}});
 return {textStyle:{fontFamily:FONT},aria:{enabled:true},grid:{left:56,right:40,top:24,bottom:48,containLabel:true},
  tooltip:{...TOOLTIP,formatter:(p:any)=>`<div style="font-family:${FONT}"><div style="font-weight:600;color:#0f172a">${escapeHtml(p.data.name)}</div><div style="color:#64748b;font-size:11px;margin-top:3px">${escapeHtml(o.x.label)}: <b style="color:#0f172a">${escapeHtml(o.fx(p.data.value[0]))}</b></div><div style="color:#64748b;font-size:11px">${escapeHtml(o.y.label)}: <b style="color:#0f172a">${escapeHtml(o.fy(p.data.value[1]))}</b></div></div>`},
  xAxis:axis(o.x,o.fx,lx),yAxis:axis(o.y,o.fy,ly),
  series:[{type:'scatter',symbolSize:11,itemStyle:{color:'rgba(79,124,255,.55)',borderColor:'#4f7cff',borderWidth:1},
   emphasis:{itemStyle:{color:'#ff8a4c',borderColor:'#ff8a4c'}},
   label:{show:true,position:'top',distance:6,fontSize:10,color:'#334155',formatter:(p:any)=>top.has(p.data.name)?p.data.name:''},labelLayout:{hideOverlap:true},
   data:pts.map(p=>({name:p.e.name,value:[p.x,p.y]}))}]};
}
// ───────────── point maps: entities with coordinates ─────────────
type Located={e:Entry;p:[number,number]};
// The points' extent, padded, as [[west, north], [east, south]] (ECharts boundingCoords).
function bounds(pts:Located[]):[[number,number],[number,number]]{
 const xs=pts.map(p=>p.p[0]),ys=pts.map(p=>p.p[1]);
 let w=Math.min(...xs),e=Math.max(...xs),s=Math.min(...ys),n=Math.max(...ys);
 const px=Math.max(2,(e-w)*.08),py=Math.max(2,(n-s)*.12);w-=px;e+=px;s-=py;n+=py;
 return [[Math.max(-180,w),Math.min(85,n)],[Math.min(180,e),Math.max(-60,s)]];
}
// Bubbles on the world map, sized by value (area ∝ value), the top 3 in medal colors, the top 10 labelled.
export function pointMapOption(o:{ranked:Entry[];c:Criterion;fmt:Fmt;map:string;pointOf:(e:Entry)=>[number,number]|null;noData:string}){
 const pts=o.ranked.map(e=>({e,p:o.pointOf(e)})).filter((x):x is Located=>!!x.p);
 const max=Math.max(...pts.map(x=>Math.abs(x.e.value!)),1);
 return {textStyle:{fontFamily:FONT},aria:{enabled:true},
  tooltip:{...TOOLTIP,formatter:(p:any)=>p.data?.entry?tooltipHtml(p.data.entry,o.c,o.fmt,o.noData):escapeHtml(p.name)},
  geo:{map:o.map,roam:true,projection:{project:equalEarth,unproject:equalEarthInvert},boundingCoords:pts.length?bounds(pts):undefined,
   left:8,right:8,top:8,bottom:8,silent:true,itemStyle:{areaColor:'#eef1f6',borderColor:'#fff',borderWidth:.6},emphasis:{disabled:true}},
  series:[{type:'scatter',coordinateSystem:'geo',
   data:pts.map(x=>({name:x.e.name,value:[x.p[0],x.p[1],x.e.value],entry:x.e,
    itemStyle:{color:x.e.rank!=null&&x.e.rank<=3?MEDAL[x.e.rank-1]:'rgba(79,124,255,.6)',borderColor:'#fff',borderWidth:1}})),
   symbolSize:(v:number[])=>4+30*Math.sqrt(Math.abs(v[2])/max),
   label:{show:true,position:'right',fontSize:10,color:'#334155',formatter:(p:any)=>p.data.entry?.rank!=null&&p.data.entry.rank<=10?p.name:''},labelLayout:{hideOverlap:true},
   emphasis:{scale:1.4,itemStyle:{color:'#ff8a4c'}}}]};
}
// 3D columns standing on the map at each point, height ∝ √value (echarts-gl geo3D + bar3D).
export function pointColumnsOption(o:{ranked:Entry[];c:Criterion;fmt:Fmt;map:string;pointOf:(e:Entry)=>[number,number]|null;noData:string}){
 const pts=o.ranked.map(e=>({e,p:o.pointOf(e)})).filter((x):x is Located=>!!x.p);
 const max=Math.max(...pts.map(x=>Math.abs(x.e.value!)),1);
 const b=pts.length?bounds(pts):undefined;
 return {textStyle:{fontFamily:FONT},
  tooltip:{...TOOLTIP,formatter:(p:any)=>{const e=pts[p.dataIndex]?.e;return e?tooltipHtml(e,o.c,o.fmt,o.noData):'';}},
  visualMap:[{show:false,min:1,max:31,dimension:2,inRange:{color:o.c.order==='asc'?[...MAP_COLORS].reverse():MAP_COLORS.slice(2)}}],
  geo3D:{map:o.map,boundingCoords:b,boxWidth:200,boxDepth:100,regionHeight:.6,shading:'color',
   light:{main:{intensity:1.2,shadow:true,alpha:45,beta:30},ambient:{intensity:.55}},
   viewControl:{distance:125,alpha:48,beta:0,minAlpha:10,maxAlpha:85},itemStyle:{color:'#d3dbe8',borderWidth:.6,borderColor:'#ffffff'},silent:true,groundPlane:{show:false}},
  series:[{type:'bar3D',coordinateSystem:'geo3D',shading:'lambert',barSize:1.6,minHeight:.2,
   data:pts.map(x=>({name:x.e.name,value:[x.p[0],x.p[1],1+30*Math.sqrt(Math.abs(x.e.value!)/max)]})),
   bevelSize:.3,label:{show:false},emphasis:{label:{show:false},itemStyle:{color:'#ff8a4c'}}}]};
}
