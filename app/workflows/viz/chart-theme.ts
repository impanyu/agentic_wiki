// Dark theme for chart options. The chart builders (shared by the browser and the server SVG) are written in
// the light palette; this maps an option to the dark one: neutral inks and lines become their dark
// counterparts, white surfaces and borders become the dark surface, the choropleth ramp runs from deep to
// bright, and tooltip HTML produced by formatters is recoloured too. Accent colours are kept.
const SURFACE='#111114';
const NEUTRAL:Record<string,string>={
 '#0f172a':'#f2f2f4','#1e293b':'#e4e4e8','#1e3a8a':'#a5a6ff','#334155':'#c4c4cc','#475569':'#aaaab4','#64748b':'#8d8d99',
 '#94a3b8':'#6f6f7a','#cbd5e1':'#3a3a42','#e2e8f0':'#2a2a31','#eef1f6':'#202026','#f1f5f9':'#1b1b20','#eceff5':'#202026',
 '#d3dbe8':'#2a2a31','#e5e9f1':'#2a2a31','#fbfcfe':'#141418','#f6f8fc':'#16161a','#f5f7fb':'#17171b','#eef3ff':'#1a1a2a',
 '#fff4d6':'#2e2614','#fde2e2':'#2e1a1d','#c2410c':'#fb923c','#e8efff':'#1c2650',
};
const LIGHT_RAMP=['#e8efff','#b9cdff','#7d9dff','#4f7cff','#2f4fd6','#1e2f86'];
const DARK_RAMP=['#1c2650','#263f99','#3b63e0','#5b86ff','#93b2ff','#d6e3ff'];
// Keys where white means "the surface" (borders between shapes, panel backgrounds, text halos).
const WHITE_KEYS=new Set(['borderColor','backgroundColor','textBorderColor','areaColor']);
const isWhite=(v:string)=>/^#fff(fff)?$/i.test(v)||/^rgba?\(\s*255\s*,\s*255\s*,\s*255\s*(,\s*1\s*)?\)$/i.test(v);

function color(v:string,key:string):string{
 const k=v.trim().toLowerCase();
 if(NEUTRAL[k])return NEUTRAL[k];
 if(isWhite(k))return WHITE_KEYS.has(key)?SURFACE:v;
 return v.includes('#')&&v.length>9?recolorText(v):v;
}
// Hex colours inside HTML or CSS text (tooltips, extraCssText); white stays white there.
export function recolorText(s:string):string{
 return s.replace(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g,m=>NEUTRAL[m.toLowerCase()]??m).replace(/background(-color)?:\s*#fff(fff)?\b/gi,'background:'+SURFACE);
}
const sameRamp=(a:unknown[],b:string[])=>a.length===b.length&&a.every((x,i)=>typeof x==='string'&&x.toLowerCase()===b[i]);

function walk(v:unknown,key:string):unknown{
 if(typeof v==='string')return color(v,key);
 if(typeof v==='function'){
  if(key!=='formatter')return v;
  const f=v as (...a:unknown[])=>unknown;
  return (...a:unknown[])=>{const r=f(...a);return typeof r==='string'?recolorText(r):r;};
 }
 if(Array.isArray(v)){
  if(sameRamp(v,LIGHT_RAMP))return DARK_RAMP;
  if(sameRamp(v,[...LIGHT_RAMP].reverse()))return [...DARK_RAMP].reverse();
  return v.map(x=>walk(x,key));
 }
 if(v&&typeof v==='object'){
  // Leave class instances (gradients from echarts.graphic, typed arrays) alone except plain objects.
  const proto=Object.getPrototypeOf(v);
  if(proto!==Object.prototype&&proto!==null)return v;
  const out:Record<string,unknown>={};
  for(const [k,x] of Object.entries(v as Record<string,unknown>))out[k]=k==='data'&&Array.isArray(x)&&x.length>200&&typeof x[0]!=='object'?x:walk(x,k);
  return out;
 }
 return v;
}
export function themeOption<T>(option:T,dark:boolean):T{
 if(!dark||!option)return option;
 return walk(option,'') as T;
}
