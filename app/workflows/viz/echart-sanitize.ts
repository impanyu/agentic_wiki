// Pure helpers for the EChart component (no imports, so tests can load this file directly).
type Obj=Record<string,unknown>;
export const MAX_ECHART_POINTS=200_000;
const TOOLBOX_FEATURES=['saveAsImage','dataView','restore','dataZoom','magicType'];
const BAD_KEYS=new Set(['__proto__','constructor','prototype','graphic']);
const isObj=(v:unknown):v is Obj=>!!v&&typeof v==='object'&&!Array.isArray(v);
const unsafeString=(s:string)=>{const l=s.toLowerCase();return l.trimStart().startsWith('image://')||l.includes('url(')||l.includes('javascript:');};
const stripTags=(s:string)=>s.replace(/<[^>]*>/g,'');

// Deep copy that drops unsafe strings/keys; returns undefined for values that must be removed.
function clean(v:unknown,key?:string):unknown{
 if(typeof v==='string'){if(unsafeString(v))return undefined;return key==='formatter'?stripTags(v):v;}
 if(typeof v==='number')return v;
 if(typeof v==='boolean'||v===null)return v;
 if(Array.isArray(v))return v.map(x=>{const c=clean(x);return c===undefined?null:c;});
 if(isObj(v)){
  const out:Obj={};
  for(const [k,x] of Object.entries(v)){if(BAD_KEYS.has(k))continue;const c=clean(x,k);if(c!==undefined)out[k]=c;}
  return out;
 }
 return undefined; // functions, symbols, undefined
}

function cleanToolbox(t:unknown):Obj|undefined{
 if(!isObj(t))return undefined;
 const feature:Obj={};const f=isObj(t.feature)?t.feature:{};
 for(const k of TOOLBOX_FEATURES)if(isObj(f[k]))feature[k]=k==='dataView'?{...f[k] as Obj,readOnly:true}:f[k];
 return {...t,feature};
}

const asArray=(v:unknown):unknown[]=>Array.isArray(v)?v:v==null?[]:[v];

export function sanitizeEChartOption(option:unknown):Record<string,unknown>{
 const o=(isObj(option)?clean(option):{}) as Obj;
 if('toolbox' in o){const tb=asArray(o.toolbox).map(cleanToolbox).filter(Boolean);if(tb.length)o.toolbox=Array.isArray(o.toolbox)?tb:tb[0];else delete o.toolbox;}
 if('series' in o){
  let budget=MAX_ECHART_POINTS;
  const series=asArray(o.series).filter(s=>isObj(s)&&s.type!=='custom') as Obj[];
  for(const s of series){
   if(!Array.isArray(s.data))continue;
   if(s.data.length>budget)s.data=s.data.slice(0,Math.max(0,budget));
   budget-=(s.data as unknown[]).length;
  }
  o.series=series;
 }
 // dataset.source counts toward the same cap.
 for(const d of asArray(o.dataset))if(isObj(d)&&Array.isArray(d.source)&&d.source.length>MAX_ECHART_POINTS)d.source=d.source.slice(0,MAX_ECHART_POINTS);
 const tips=asArray(o.tooltip).filter(isObj);
 if(!tips.length)o.tooltip={renderMode:'html',confine:true};
 else for(const t of tips){t.renderMode='html';t.confine=true;}
 return o;
}

const seriesOf=(o:Obj)=>asArray(o.series).filter(isObj);
// ECharts GL series: named …3D or …GL, plus surface.
const glType=(t:unknown)=>typeof t==='string'&&(/(3D|GL)$/.test(t)||t==='surface');
export const needsEChartsGL=(o:Obj)=>['grid3D','xAxis3D','yAxis3D','zAxis3D','geo3D','globe','mapbox3D'].some(k=>k in o)||seriesOf(o).some(s=>glType(s.type));

// Fill only what the option leaves unset.
function fill(target:Obj,defaults:Obj){for(const [k,v] of Object.entries(defaults)){if(!(k in target))target[k]=v;else if(isObj(target[k])&&isObj(v))fill(target[k] as Obj,v);}return target;}

export function withEChartDefaults(o:Obj):Obj{
 const series=seriesOf(o);
 const cartesian='xAxis' in o&&series.some(s=>['line','bar','scatter'].includes(String(s.type)));
 const namedData=series.some(s=>['pie','funnel','radar'].includes(String(s.type))&&Array.isArray(s.data)&&s.data.some(d=>isObj(d)&&typeof d.name==='string'));
 if(!('legend' in o)&&(series.length>=2||namedData))o.legend={};
 const tips=asArray(o.tooltip).filter(isObj);
 for(const t of tips)fill(t,{trigger:cartesian?'axis':'item'});
 if(cartesian&&!('grid' in o))o.grid={left:12,right:16,top:'title' in o||'legend' in o?48:24,bottom:12,containLabel:true};
 fill(o,{aria:{enabled:true},animationDuration:900,animationEasing:'cubicOut'});
 for(const s of series)if(!('universalTransition' in s)&&!glType(s.type))s.universalTransition=true;
 return o;
}
