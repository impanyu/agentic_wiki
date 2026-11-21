// Chart options of the ranking component, shared by the browser (interactive ECharts canvas) and the
// server (the same chart rendered to SVG for the crawlable page). No browser APIs here.
import {type Criterion,type Entry,escapeHtml,colorScale,equalEarth,equalEarthInvert,makeFormatter,parseNumber,groupsOf} from './ranking-data';
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
export const RANKING_VIEWS=['bar','trend','bump','race','treemap','donut','sunburst','map','map3d','scatter','lorenz','distribution','boxplot','heatmap','parallel','slope','radar'] as const;
export type RankingViewKind=typeof RANKING_VIEWS[number];
// What each view needs: share views (treemap, donut, sunburst, lorenz) a quantity that adds up; sunburst and
// boxplot groups; maps a geography; scatter and slope a second criterion; heatmap, parallel and radar three.
// periods: how many periods the data covers; with 3 or more, the time views (trend, bump, race) follow the bars.
export function autoViews(o:{additive:boolean;geo:GeoKind|null;criteria:number;groups?:number;count?:number;periods?:number}):RankingViewKind[]{
 const n=o.count??Infinity,g=o.groups??0,v:RankingViewKind[]=['bar'];
 if((o.periods??0)>=3)v.push('trend','bump','race');
 if(o.additive)v.push('treemap','donut');
 if(o.additive&&g>=2)v.push('sunburst');
 if(o.geo)v.push('map','map3d');
 if(o.criteria>=2)v.push('scatter');
 if(o.additive&&n>=5)v.push('lorenz');
 if(n>=10)v.push('distribution');
 if(g>=2&&n>=10)v.push('boxplot');
 if(o.criteria>=3)v.push('heatmap','parallel');
 if(o.criteria>=2)v.push('slope');
 if(o.criteria>=3)v.push('radar');
 return v;
}
export const VIEW_LABELS:Record<RankingViewKind,string>={bar:'Bars',trend:'Over time',bump:'Rank over time',race:'Race',treemap:'Treemap',donut:'Donut',sunburst:'Sunburst',map:'Map',map3d:'3D map',scatter:'Scatter',
 lorenz:'Concentration',distribution:'Distribution',boxplot:'By group',heatmap:'Heatmap',parallel:'Parallel',slope:'Rank shift',radar:'Radar'};
// Box heights per view (px); maps size themselves by aspect.
export const VIEW_HEIGHT:Partial<Record<RankingViewKind,number>>={trend:440,bump:480,race:520,treemap:440,donut:360,sunburst:460,map3d:480,scatter:440,lorenz:380,distribution:360,boxplot:400,heatmap:560,parallel:440,slope:560,radar:440};
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
export function choroplethOption(o:{ranked:Entry[];c:Criterion;fmt:Fmt;kind:GeoKind;map:string;keyOf:(e:Entry)=>string|null;names:Map<string,string>;noData:string;aspectScale?:number}){
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
   ...(o.kind==='world'?{projection:{project:equalEarth,unproject:equalEarthInvert}}:{aspectScale:o.aspectScale??1}),
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

// ───────────── second batch: concentration, distribution, groups, multi-criteria ─────────────
type Row=Record<string,unknown>;
const val=(row:Row,key:string)=>parseNumber(row[key]);
const AXIS={axisLabel:{color:'#94a3b8',fontSize:10},splitLine:{lineStyle:{color:'#eef1f6',type:'dashed'}},axisLine:{show:false},axisTick:{show:false}};
const pctText=(v:number)=>(Math.round(v*10)/10)+'%';
// Percentile (0–100, 100 = best) of every entity on a criterion; ties share the midpoint.
export function percentiles(entries:{row:Row}[],c:Criterion):Map<Row,number>{
 const vs=entries.map(e=>({row:e.row,v:val(e.row,c.key)})).filter(x=>x.v!=null) as {row:Row;v:number}[];
 const sorted=vs.map(x=>x.v).sort((a,b)=>a-b),n=sorted.length,out=new Map<Row,number>();
 const below=(v:number)=>{let lo=0,hi=n;while(lo<hi){const m=(lo+hi)>>1;if(sorted[m]<v)lo=m+1;else hi=m;}return lo;};
 const upto=(v:number)=>{let lo=0,hi=n;while(lo<hi){const m=(lo+hi)>>1;if(sorted[m]<=v)lo=m+1;else hi=m;}return lo;};
 for(const x of vs){const p=n>1?((below(x.v)+upto(x.v)-1)/2)/(n-1)*100:100;out.set(x.row,c.order==='asc'?100-p:p);}
 return out;
}
// Competition rank of every entity on a criterion.
export function ranksOn(entries:{row:Row}[],c:Criterion):Map<Row,number>{
 const vs=entries.map(e=>({row:e.row,v:val(e.row,c.key)})).filter(x=>x.v!=null) as {row:Row;v:number}[];
 vs.sort((a,b)=>c.order==='asc'?a.v-b.v:b.v-a.v);const out=new Map<Row,number>();
 vs.forEach((x,i)=>out.set(x.row,i&&vs[i-1].v===x.v?out.get(vs[i-1].row)!:i+1));return out;
}
// Cumulative share: how much of the total the top k hold.
export function cumulativeShare(ranked:Entry[]):{k:number;share:number}[]{
 const pos=ranked.filter(e=>e.value!>0),total=pos.reduce((a,e)=>a+e.value!,0);let acc=0;
 return total>0?pos.map((e,i)=>{acc+=e.value!;return {k:i+1,share:acc/total*100};}):[];
}
export function lorenzOption(o:{ranked:Entry[];c:Criterion;label:(k:number,pct:string)=>string;entitiesLabel:string}){
 const cs=cumulativeShare(o.ranked),n=cs.length;
 // A few well-spaced marks: the leader, the top 5 or 10, and the top fifth.
 const marks=[1,n>=20?10:5,Math.round(n*.2)].filter((k,i,a)=>k>=1&&k<n&&a.indexOf(k)===i&&(i===0||k-a[i-1]>=Math.max(3,n*.06)));
 return {textStyle:{fontFamily:FONT},aria:{enabled:true},grid:{left:48,right:28,top:24,bottom:44,containLabel:true},
  tooltip:{...TOOLTIP,trigger:'axis',formatter:(ps:any)=>{const p=Array.isArray(ps)?ps[0]:ps;const k=Number(p.axisValue);const e=o.ranked[k-1];
   return `<div style="font-family:${FONT}"><div style="font-weight:600;color:#0f172a">${escapeHtml(o.label(k,pctText(cs[k-1]?.share??0)))}</div>${e?`<div style="color:#64748b;font-size:11px;margin-top:2px">#${k} ${escapeHtml(e.name)}</div>`:''}</div>`;}},
  xAxis:{type:'category',data:cs.map(x=>String(x.k)),name:o.entitiesLabel,nameLocation:'middle',nameGap:28,nameTextStyle:{color:'#64748b',fontSize:11},...AXIS,axisLabel:{...AXIS.axisLabel,interval:Math.max(0,Math.ceil(n/12)-1)}},
  yAxis:{type:'value',max:100,axisLabel:{color:'#94a3b8',fontSize:10,formatter:'{value}%'},splitLine:AXIS.splitLine,axisLine:{show:false},axisTick:{show:false}},
  series:[{type:'line',smooth:.2,symbol:'none',data:cs.map(x=>x.share),lineStyle:{width:2.5,color:'#4f7cff'},
   areaStyle:{color:{type:'linear',x:0,y:0,x2:0,y2:1,colorStops:[{offset:0,color:'rgba(79,124,255,.35)'},{offset:1,color:'rgba(79,124,255,.03)'}]}},
   markPoint:{symbol:'circle',symbolSize:9,itemStyle:{color:'#ff8a4c',borderColor:'#fff',borderWidth:2},
    label:{show:true,position:'top',distance:8,color:'#334155',fontSize:10.5,fontWeight:600,formatter:(p:any)=>o.label(Number(p.data.coord[0])+1,pctText(p.data.coord[1]))},
    data:marks.map(k=>({coord:[k-1,cs[k-1].share]}))},
   markLine:{silent:true,symbol:'none',lineStyle:{color:'#cbd5e1',type:'dashed'},label:{show:false},data:[[{coord:[0,100/n]},{coord:[n-1,100]}]]}}]};
}
// Histogram of the criterion (log-spaced bins when values span 100×), median marked.
export function distributionOption(o:{ranked:Entry[];c:Criterion;fmt:Fmt;axisFmt:Fmt;countLabel:string;medianLabel:string}){
 const vs=o.ranked.map(e=>e.value!);if(!vs.length)return null;
 const min=Math.min(...vs),max=Math.max(...vs),log=min>0&&max/min>=20;
 const bins=Math.max(6,Math.min(30,Math.ceil(Math.log2(vs.length)+1)*2));
 const t=(v:number)=>log?Math.log10(v):v,u=(v:number)=>log?10**v:v,lo=t(min),hi=t(max)===lo?lo+1:t(max),w=(hi-lo)/bins;
 const counts=new Array(bins).fill(0),names:string[][]=Array.from({length:bins},()=>[]);
 for(const e of o.ranked){const i=Math.min(bins-1,Math.floor((t(e.value!)-lo)/w));counts[i]++;if(names[i].length<6)names[i].push(e.name);}
 const label=(i:number)=>o.axisFmt(u(lo+i*w))+'–'+o.axisFmt(u(lo+(i+1)*w));
 const sorted=[...vs].sort((a,b)=>a-b),med=sorted[sorted.length>>1],mi=Math.min(bins-1,Math.floor((t(med)-lo)/w));
 return {textStyle:{fontFamily:FONT},aria:{enabled:true},grid:{left:40,right:20,top:28,bottom:54,containLabel:true},
  tooltip:{...TOOLTIP,trigger:'item',formatter:(p:any)=>`<div style="font-family:${FONT}"><div style="font-weight:600;color:#0f172a">${escapeHtml(label(p.dataIndex))}</div><div style="color:#64748b;font-size:11px;margin-top:2px">${p.value} ${escapeHtml(o.countLabel)}</div><div style="color:#334155;font-size:11px;margin-top:3px">${names[p.dataIndex].map(escapeHtml).join(', ')}${counts[p.dataIndex]>6?'…':''}</div></div>`},
  xAxis:{type:'category',data:counts.map((_,i)=>label(i)),...AXIS,axisLabel:{...AXIS.axisLabel,rotate:35,interval:Math.max(0,Math.ceil(bins/10)-1)}},
  yAxis:{type:'value',minInterval:1,...AXIS,name:o.countLabel,nameTextStyle:{color:'#94a3b8',fontSize:10}},
  series:[{type:'bar',barCategoryGap:'8%',data:counts.map((n,i)=>({value:n,itemStyle:{color:i===mi?'#ff8a4c':'#4f7cff',borderRadius:[4,4,0,0],opacity:.85}})),
   markLine:{silent:true,symbol:'none',data:[{xAxis:mi}],lineStyle:{color:'#ff8a4c',type:'dashed'},label:{formatter:o.medianLabel+': '+o.fmt(med),color:'#c2410c',fontSize:10.5}}}]};
}
function quartiles(vs:number[]){const s=[...vs].sort((a,b)=>a-b),q=(p:number)=>{const i=(s.length-1)*p,lo=Math.floor(i),hi=Math.ceil(i);return s[lo]+(s[hi]-s[lo])*(i-lo);};return [s[0],q(.25),q(.5),q(.75),s[s.length-1]];}
// Box plot per group (region, sector…) with every entity as a dot.
export function boxplotOption(o:{ranked:Entry[];c:Criterion;fmt:Fmt;axisFmt:Fmt}){
 const groups=groupsOf(o.ranked).filter(g=>o.ranked.filter(e=>e.group===g).length>=1);if(groups.length<2)return null;
 const by=groups.map(g=>o.ranked.filter(e=>e.group===g));
 const vs=o.ranked.map(e=>e.value!),log=Math.min(...vs)>0&&Math.max(...vs)/Math.min(...vs)>=100;
 return {textStyle:{fontFamily:FONT},aria:{enabled:true},grid:{left:40,right:24,top:24,bottom:60,containLabel:true},
  tooltip:{...TOOLTIP,trigger:'item',formatter:(p:any)=>p.seriesType==='boxplot'?`<div style="font-family:${FONT}"><b>${escapeHtml(groups[p.dataIndex])}</b><div style="color:#64748b;font-size:11px">median ${escapeHtml(o.fmt(p.data[3]))} · ${by[p.dataIndex].length}</div></div>`
   :`<div style="font-family:${FONT}"><b>${escapeHtml(p.data[2])}</b><div>${escapeHtml(o.fmt(p.data[1]))}</div></div>`},
  xAxis:{type:'category',data:groups,...AXIS,axisLabel:{...AXIS.axisLabel,rotate:groups.length>6?30:0,color:'#475569',fontSize:11}},
  yAxis:{type:log?'log':'value',...AXIS,axisLabel:{...AXIS.axisLabel,formatter:(v:number)=>o.axisFmt(v)}},
  series:[{type:'boxplot',data:by.map(es=>quartiles(es.map(e=>e.value!))),itemStyle:{color:'rgba(79,124,255,.12)',borderColor:'#4f7cff',borderWidth:1.5}},
   {type:'scatter',symbolSize:7,itemStyle:{color:'rgba(255,138,76,.75)',borderColor:'#fff',borderWidth:.5},
    data:by.flatMap((es,gi)=>es.map((e,j)=>[gi+((j%7)-3)*0.04,e.value!,e.name]))}]};
}
// Heatmap: the top entities (rows) × every criterion (columns), colored by percentile, labelled with the rank.
export function heatmapOption(o:{ranked:Entry[];entries:{row:Row}[];criteria:Criterion[];limit?:number}){
 const rows=o.ranked.slice(0,o.limit??30);if(!rows.length||o.criteria.length<2)return null;
 const pct=o.criteria.map(c=>percentiles(o.entries,c)),rk=o.criteria.map(c=>ranksOn(o.entries,c));
 const data:any[]=[];rows.forEach((e,y)=>o.criteria.forEach((_,x)=>{const p=pct[x].get(e.row);data.push([x,y,p==null?null:Math.round(p),rk[x].get(e.row)??null]);}));
 return {textStyle:{fontFamily:FONT},aria:{enabled:true},grid:{left:8,right:16,top:8,bottom:56,containLabel:true},
  tooltip:{...TOOLTIP,trigger:'item',formatter:(p:any)=>{const e=rows[p.data[1]],c=o.criteria[p.data[0]];const v=val(e.row,c.key);
   return `<div style="font-family:${FONT}"><b>${escapeHtml(e.name)}</b><div style="color:#64748b;font-size:11px;margin-top:2px">${escapeHtml(c.label)}${p.data[3]!=null?' · #'+p.data[3]:''}</div><div style="font-weight:700">${v==null?'—':escapeHtml(String(v))}</div><div style="color:#64748b;font-size:11px">${p.data[2]==null?'':'percentile '+p.data[2]}</div></div>`;}},
  xAxis:{type:'category',data:o.criteria.map(c=>c.label),position:'bottom',axisLabel:{color:'#475569',fontSize:11,interval:0,rotate:o.criteria.length>5?25:0},axisLine:{show:false},axisTick:{show:false},splitArea:{show:false}},
  yAxis:{type:'category',data:rows.map(e=>(e.rank??'')+'. '+e.name),inverse:true,axisLabel:{color:'#334155',fontSize:11},axisLine:{show:false},axisTick:{show:false}},
  visualMap:{show:false,min:0,max:100,dimension:2,inRange:{color:['#fde2e2','#fff4d6','#e8efff','#7d9dff','#2f4fd6']}},
  series:[{type:'heatmap',data,itemStyle:{borderColor:'#fff',borderWidth:2,borderRadius:4},label:{show:true,fontSize:10,color:'#0f172a',formatter:(p:any)=>p.data[3]==null?'—':'#'+p.data[3]},emphasis:{itemStyle:{borderColor:'#0f172a',borderWidth:1}}}]};
}
// Parallel coordinates: one axis per criterion, one line per entity (the top 3 in medal colors).
export function parallelOption(o:{ranked:Entry[];criteria:Criterion[];locale:string;limit?:number}){
 const rows=o.ranked.slice(0,o.limit??60);if(o.criteria.length<3||!rows.length)return null;
 const axes=o.criteria.map((c,i)=>{const vs=rows.map(e=>val(e.row,c.key)).filter((v):v is number=>v!=null);const f=makeFormatter(c,vs,o.locale,{unit:false,compact:true});
  const log=vs.length>2&&Math.min(...vs)>0&&Math.max(...vs)/Math.min(...vs)>=1000;
  return {dim:i,name:c.label,type:log?'log':'value',inverse:c.order==='asc',nameTextStyle:{color:'#334155',fontSize:11,fontWeight:600},axisLabel:{color:'#94a3b8',fontSize:9,formatter:(v:number)=>f(v)},axisLine:{lineStyle:{color:'#cbd5e1'}},axisTick:{show:false},splitLine:{show:false}};});
 return {textStyle:{fontFamily:FONT},aria:{enabled:true},parallel:{left:48,right:72,top:44,bottom:24,parallelAxisDefault:{nameLocation:'start',nameGap:18}},parallelAxis:axes,
  tooltip:{...TOOLTIP,trigger:'item',formatter:(p:any)=>`<div style="font-family:${FONT}"><b>${escapeHtml(p.name)}</b></div>`},
  series:[{type:'parallel',smooth:.15,lineStyle:{width:1.2,opacity:.35,color:'#4f7cff'},emphasis:{lineStyle:{width:3,opacity:1,color:'#ff8a4c'}},
   data:rows.map(e=>({name:e.name,value:o.criteria.map(c=>val(e.row,c.key)),lineStyle:e.rank!=null&&e.rank<=3?{color:MEDAL[e.rank-1],width:2.6,opacity:.95}:undefined}))}]};
}
// Rank shift: each entity's rank on the current criterion (left) against another (right).
export function slopeOption(o:{ranked:Entry[];entries:{row:Row}[];c:Criterion;other:Criterion;limit?:number}){
 const rows=o.ranked.slice(0,o.limit??20);if(!rows.length)return null;
 const r2=ranksOn(o.entries,o.other);const n=Math.max(...rows.map(e=>Math.max(e.rank??0,r2.get(e.row)??0)),rows.length);
 const series=rows.map(e=>{const a=e.rank!,b=r2.get(e.row);const color=b==null?'#cbd5e1':b<a?'#22c3a6':b>a?'#f43f5e':'#94a3b8';
  return {type:'line',name:e.name,symbol:'circle',symbolSize:7,data:[[0,a],[1,b??null]],lineStyle:{color,width:a<=3?2.6:1.6},itemStyle:{color},emphasis:{focus:'series',lineStyle:{width:3.5}},z:a<=3?3:2};});
 return {textStyle:{fontFamily:FONT},aria:{enabled:true},grid:{left:150,right:150,top:30,bottom:16},
  tooltip:{...TOOLTIP,trigger:'item',formatter:(p:any)=>`<div style="font-family:${FONT}"><b>${escapeHtml(p.seriesName)}</b><div style="color:#64748b;font-size:11px">${escapeHtml(o.c.label)} #${p.seriesIndex<rows.length?rows[p.seriesIndex].rank:''} → ${escapeHtml(o.other.label)} #${r2.get(rows[p.seriesIndex].row)??'—'}</div></div>`},
  xAxis:{type:'value',min:0,max:1,show:true,interval:1,axisLabel:{formatter:(v:number)=>v===0?o.c.label:o.other.label,color:'#334155',fontWeight:600,fontSize:12},position:'top',axisLine:{show:false},axisTick:{show:false},splitLine:{lineStyle:{color:'#e2e8f0'}}},
  yAxis:{type:'value',inverse:true,min:1,max:n,show:false},
  series:series.map((s,i)=>({...s,label:{show:true,fontSize:10.5,color:'#334155',position:'left',distance:8,formatter:(p:any)=>p.data[0]===0?`${rows[i].rank}. ${clip(rows[i].name,18)}`:''},
   endLabel:{show:true,fontSize:10.5,color:'#334155',distance:8,formatter:()=>{const b=r2.get(rows[i].row);return b!=null?`${b}. ${clip(rows[i].name,18)}`:'—';}}}))};
}
// Radar: the top 5 entities' percentiles on every criterion (100 = best).
export function radarOption(o:{ranked:Entry[];entries:{row:Row}[];criteria:Criterion[];limit?:number}){
 const rows=o.ranked.slice(0,o.limit??5);if(o.criteria.length<3||!rows.length)return null;
 const pct=o.criteria.map(c=>percentiles(o.entries,c));
 const colors=[...MEDAL,'#4f7cff','#22c3a6'];
 return {textStyle:{fontFamily:FONT},aria:{enabled:true},
  legend:{bottom:4,icon:'circle',itemWidth:9,itemHeight:9,textStyle:{color:'#334155',fontSize:11}},
  tooltip:{...TOOLTIP,trigger:'item'},
  radar:{radius:'64%',center:['50%','47%'],indicator:o.criteria.map(c=>({name:c.label,max:100})),splitNumber:4,
   axisName:{color:'#475569',fontSize:11},splitLine:{lineStyle:{color:'#e2e8f0'}},splitArea:{areaStyle:{color:['#fbfcfe','#f5f7fb']}},axisLine:{lineStyle:{color:'#e2e8f0'}}},
  series:[{type:'radar',symbolSize:4,data:rows.map((e,i)=>({name:e.name,value:pct.map(m=>Math.round(m.get(e.row)??0)),
   lineStyle:{color:colors[i],width:2},itemStyle:{color:colors[i]},areaStyle:{color:colors[i],opacity:.08}}))}]};
}
// Sunburst: groups (inner ring) and their entities (outer ring), sized by value.
export function sunburstOption(o:{ranked:Entry[];c:Criterion;fmt:Fmt;othersLabel:string}){
 const groups=groupsOf(o.ranked);if(groups.length<2)return null;
 const pos=o.ranked.filter(e=>e.value!>0),total=pos.reduce((a,e)=>a+e.value!,0);
 const data=groups.map((g,gi)=>{const es=pos.filter(e=>e.group===g),top=es.slice(0,12),rest=es.slice(12).reduce((a,e)=>a+e.value!,0);
  const color=PALETTE[gi%PALETTE.length];
  return {name:g,itemStyle:{color},children:[...top.map(e=>({name:e.name,value:e.value})),...(rest>0?[{name:o.othersLabel,value:rest,itemStyle:{color:OTHERS_COLOR}}]:[])]};});
 return {textStyle:{fontFamily:FONT},aria:{enabled:true},
  tooltip:{...TOOLTIP,formatter:(p:any)=>`<div style="font-family:${FONT}"><b>${escapeHtml(p.name)}</b><div>${escapeHtml(o.fmt(p.value))} · ${shareText(p.value,total)}</div></div>`},
  series:[{type:'sunburst',radius:['14%','94%'],sort:undefined,nodeClick:'rootToNode',data,itemStyle:{borderColor:'#fff',borderWidth:2,borderRadius:4},
   levels:[{},{r0:'14%',r:'44%',label:{rotate:'tangential',fontSize:11,fontWeight:600,color:'#fff'}},{r0:'44%',r:'94%',label:{align:'right',fontSize:10,color:'#fff',minAngle:4},itemStyle:{opacity:.85}}]}]};
}

// ───────────── one entry point for the browser and the server ─────────────
export type ViewGeo={kind:GeoKind;map:string;names:Map<string,string>;keyOf:(e:Entry)=>string|null;pointOf:(e:Entry)=>[number,number]|null;aspectScale?:number};
// history: the criterion's values over time (name → [[period, value]…], oldest first) with every period, oldest first.
export type ViewHistory={periods:string[];series:Map<string,[string,number][]>};
export type ViewInput={view:RankingViewKind;c:Criterion;criteria:Criterion[];entries:{row:Row;name:string}[];ranked:Entry[];missing:Entry[];history?:ViewHistory|null;
 fmt:Fmt;axisFmt:Fmt;locale:string;top:number;allBars?:boolean;window?:number;other?:Criterion;geo?:ViewGeo|null;
 labels:{others:string;noData:string;topHold:(k:number,pct:string)=>string;entities:string;count:string;median:string}};
// The ECharts option of one view, or null when the data cannot draw it (or the map is not loaded yet).
export function viewOption(i:ViewInput):Record<string,unknown>|null{
 const {c,ranked,fmt,axisFmt,labels}=i;
 switch(i.view){
  case 'bar':{const shown=i.allBars?ranked:ranked.slice(0,i.top);return shown.length?columnOption({shown,c,fmt,axisFmt,window:i.allBars?i.window:undefined,noData:labels.noData}):null;}
  case 'trend':return i.history?trendOption({ranked,c,history:i.history,axisFmt,fmt}):null;
  case 'bump':return i.history?bumpOption({ranked,c,history:i.history}):null;
  case 'race':return i.history?raceOption({c,history:i.history,fmt,axisFmt}):null;
  case 'treemap':return treemapOption({ranked,c,fmt,othersLabel:labels.others,noData:labels.noData});
  case 'donut':return donutOption({ranked,c,fmt,othersLabel:labels.others,noData:labels.noData});
  case 'sunburst':return sunburstOption({ranked,c,fmt,othersLabel:labels.others});
  case 'map':case 'map3d':{const g=i.geo;if(!g)return null;const base={ranked,c,fmt,map:g.map,noData:labels.noData};
   if(g.kind==='points')return i.view==='map'?pointMapOption({...base,pointOf:g.pointOf}):pointColumnsOption({...base,pointOf:g.pointOf});
   return i.view==='map'?choroplethOption({...base,kind:g.kind,keyOf:g.keyOf,names:g.names,aspectScale:g.aspectScale}):heightMapOption({...base,kind:g.kind,keyOf:g.keyOf,names:g.names});}
  case 'scatter':{const y=i.other;if(!y)return null;const yv=i.entries.map(e=>val(e.row,y.key)).filter((v):v is number=>v!=null);
   return scatterOption({entries:[...ranked,...i.missing],x:c,y,fx:axisFmt,fy:makeFormatter(y,yv,i.locale,{unit:false,compact:true}),value:(row,k)=>val(row,k)});}
  case 'lorenz':return lorenzOption({ranked,c,label:labels.topHold,entitiesLabel:labels.entities});
  case 'distribution':return distributionOption({ranked,c,fmt,axisFmt,countLabel:labels.count,medianLabel:labels.median});
  case 'boxplot':return boxplotOption({ranked,c,fmt,axisFmt});
  case 'heatmap':return heatmapOption({ranked,entries:i.entries,criteria:i.criteria});
  case 'parallel':return parallelOption({ranked,criteria:i.criteria,locale:i.locale});
  case 'slope':return i.other?slopeOption({ranked,entries:i.entries,c,other:i.other}):null;
  case 'radar':return radarOption({ranked,entries:i.entries,criteria:i.criteria});
 }
 return null;
}

// ───────────── time views ─────────────
const LINE_COLORS=[...MEDAL,'#4f7cff','#22c3a6','#a46bff','#ef5da8','#2bb3e0','#7bd389','#ff8a4c','#64748b'];
// Values over time of the top 10 (in the period in view).
export function trendOption(o:{ranked:Entry[];c:Criterion;history:ViewHistory;fmt:Fmt;axisFmt:Fmt;limit?:number}){
 const top=o.ranked.slice(0,o.limit??10).filter(e=>o.history.series.has(e.name));if(!top.length)return null;
 const vs=top.flatMap(e=>o.history.series.get(e.name)!.map(x=>x[1]));const log=vs.length>2&&Math.min(...vs)>0&&Math.max(...vs)/Math.min(...vs)>=1000;
 return {textStyle:{fontFamily:FONT},aria:{enabled:true},grid:{left:48,right:120,top:20,bottom:36,containLabel:true},
  tooltip:{...TOOLTIP,trigger:'axis',order:'valueDesc',valueFormatter:(v:number)=>o.fmt(v)},
  xAxis:{type:'category',data:o.history.periods,boundaryGap:false,...AXIS,axisLabel:{...AXIS.axisLabel,color:'#64748b'}},
  yAxis:{type:log?'log':'value',...AXIS,axisLabel:{...AXIS.axisLabel,formatter:(v:number)=>o.axisFmt(v)},scale:true},
  series:top.map((e,i)=>{const m=new Map(o.history.series.get(e.name));return {type:'line',name:e.name,showSymbol:false,smooth:.2,connectNulls:true,
   data:o.history.periods.map(p=>m.get(p)??null),lineStyle:{width:i<3?2.6:1.6,color:LINE_COLORS[i]},itemStyle:{color:LINE_COLORS[i]},
   endLabel:{show:true,formatter:'{a}',color:LINE_COLORS[i],fontSize:10.5,fontWeight:600},emphasis:{focus:'series'}};})};
}
// Competition ranks of every entity in every period.
export function ranksByPeriod(history:ViewHistory,order:'asc'|'desc'):Map<string,Map<string,number>>{
 const out=new Map<string,Map<string,number>>();
 for(const p of history.periods){
  const vs:[string,number][]=[];for(const [n,l] of history.series){const x=l.find(y=>y[0]===p);if(x)vs.push([n,x[1]]);}
  vs.sort((a,b)=>order==='asc'?a[1]-b[1]:b[1]-a[1]);
  const m=new Map<string,number>();vs.forEach(([n,v],i)=>m.set(n,i&&vs[i-1][1]===v?m.get(vs[i-1][0])!:i+1));out.set(p,m);
 }
 return out;
}
// Bump chart: the rank of the top 10 (in the period in view) in every period.
export function bumpOption(o:{ranked:Entry[];c:Criterion;history:ViewHistory;limit?:number}){
 const top=o.ranked.slice(0,o.limit??10).filter(e=>o.history.series.has(e.name));if(!top.length)return null;
 const ranks=ranksByPeriod(o.history,o.c.order);
 const maxRank=Math.max(10,...top.flatMap(e=>o.history.periods.map(p=>ranks.get(p)!.get(e.name)??0)));
 return {textStyle:{fontFamily:FONT},aria:{enabled:true},grid:{left:40,right:140,top:20,bottom:36,containLabel:true},
  tooltip:{...TOOLTIP,trigger:'item',formatter:(p:any)=>`<div style="font-family:${FONT}"><b>${escapeHtml(p.seriesName)}</b><div style="color:#64748b;font-size:11px">${escapeHtml(String(p.name))}: #${p.value}</div></div>`},
  xAxis:{type:'category',data:o.history.periods,boundaryGap:false,...AXIS,axisLabel:{...AXIS.axisLabel,color:'#64748b'}},
  yAxis:{type:'value',inverse:true,min:1,max:Math.min(maxRank,40),interval:Math.max(1,Math.ceil(Math.min(maxRank,40)/10)),...AXIS,axisLabel:{...AXIS.axisLabel,formatter:'#{value}'}},
  series:top.map((e,i)=>({type:'line',name:e.name,smooth:.25,connectNulls:false,symbol:'circle',symbolSize:7,
   data:o.history.periods.map(p=>ranks.get(p)!.get(e.name)??null),lineStyle:{width:i<3?3:2,color:LINE_COLORS[i]},itemStyle:{color:LINE_COLORS[i]},
   endLabel:{show:true,formatter:'{a}',color:LINE_COLORS[i],fontSize:10.5,fontWeight:600},emphasis:{focus:'series'}}))};
}
// Bar chart race: the top 12 in each period, played through time (timeline with play button).
export function raceOption(o:{c:Criterion;history:ViewHistory;fmt:Fmt;axisFmt:Fmt;show?:number}){
 const periods=o.history.periods;if(periods.length<2)return null;const show=o.show??12;
 const ranks=ranksByPeriod(o.history,o.c.order);
 const names=[...new Set(periods.flatMap(p=>[...ranks.get(p)!].filter(([,r])=>r<=show).map(([n])=>n)))];if(!names.length)return null;
 const color=new Map(names.map((n,i)=>[n,PALETTE[i%PALETTE.length]]));
 const valueAt=(n:string,p:string)=>o.history.series.get(n)?.find(x=>x[0]===p)?.[1]??null;
 return {baseOption:{textStyle:{fontFamily:FONT},aria:{enabled:true},
   timeline:{axisType:'category',data:periods,autoPlay:false,playInterval:900,currentIndex:periods.length-1,bottom:6,left:40,right:40,
    label:{color:'#64748b',fontSize:10},lineStyle:{color:'#cbd5e1'},checkpointStyle:{color:'#4f7cff',borderColor:'#fff'},controlStyle:{color:'#4f7cff',borderColor:'#4f7cff'},progress:{lineStyle:{color:'#4f7cff'},itemStyle:{color:'#4f7cff'}}},
   grid:{left:8,right:80,top:16,bottom:70,containLabel:true},
   xAxis:{type:'value',max:'dataMax',...AXIS,axisLabel:{...AXIS.axisLabel,formatter:(v:number)=>o.axisFmt(v)}},
   yAxis:{type:'category',inverse:true,max:show-1,data:names,animationDuration:300,animationDurationUpdate:300,axisLabel:{color:'#334155',fontSize:11.5},axisLine:{show:false},axisTick:{show:false}},
   tooltip:{...TOOLTIP,trigger:'item',formatter:(p:any)=>`<div style="font-family:${FONT}"><b>${escapeHtml(p.name)}</b><div>${escapeHtml(o.fmt(p.value))}</div></div>`},
   animationDuration:0,animationDurationUpdate:800,animationEasing:'linear',animationEasingUpdate:'linear',
   series:[{type:'bar',realtimeSort:true,seriesLayoutBy:'column',barMaxWidth:26,itemStyle:{borderRadius:[0,6,6,0]},
    label:{show:true,position:'right',valueAnimation:true,color:'#334155',fontSize:11,formatter:(p:any)=>o.axisFmt(p.value)}}],
   graphic:[{type:'text',right:40,bottom:80,z:100,style:{text:periods[periods.length-1],font:'700 44px Inter, system-ui, sans-serif',fill:'rgba(15,23,42,.14)'}}]},
  options:periods.map(p=>({series:[{type:'bar',data:names.map(n=>{const v=valueAt(n,p);return {value:v??0,itemStyle:{color:color.get(n)}};})}],
   graphic:[{type:'text',right:40,bottom:80,z:100,style:{text:p,font:'700 44px Inter, system-ui, sans-serif',fill:'rgba(15,23,42,.14)'}}]}))};
}
