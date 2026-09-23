import {z} from 'zod';

// Server-side chart rendering to standalone SVG, so agents can plot real data
// without a sandbox or plotting library.
export const chartSpecSchema=z.object({
 kind:z.enum(['bar','stacked-bar','horizontal-bar','line','area','scatter','pie']),
 title:z.string().max(200).default(''),
 subtitle:z.string().max(300).default(''),
 xLabel:z.string().max(120).default(''),
 yLabel:z.string().max(120).default(''),
 categories:z.array(z.union([z.string(),z.number()]).transform(String)).max(200).optional(),
 series:z.array(z.object({name:z.string().max(120).default(''),values:z.array(z.number().nullable()).max(200).optional(),points:z.array(z.tuple([z.number(),z.number()])).max(2000).optional(),color:z.string().regex(/^#[0-9a-fA-F]{3,8}$/).optional()})).min(1).max(12),
 source:z.string().max(300).default(''),
 width:z.number().int().min(320).max(1600).default(900),
 height:z.number().int().min(240).max(1200).default(520),
});
export type ChartSpec=z.infer<typeof chartSpecSchema>;
const palette=['#2f6fb0','#e07b39','#3a9a5b','#c44e52','#8172b2','#937860','#da8bc3','#8c8c8c','#ccb974','#64b5cd','#1b4f72','#7d3c98'];
const esc=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const fmt=(n:number)=>{const a=Math.abs(n);if(a>=1e9)return (n/1e9).toFixed(1).replace(/\.0$/,'')+'B';if(a>=1e6)return (n/1e6).toFixed(1).replace(/\.0$/,'')+'M';if(a>=1e4)return (n/1e3).toFixed(1).replace(/\.0$/,'')+'k';return Number.isInteger(n)?String(n):n.toFixed(Math.abs(n)<1?2:1);};
function ticks(min:number,max:number,count=5){if(min===max){max=min+1;}const span=max-min,step0=span/count,mag=10**Math.floor(Math.log10(step0)),step=[1,2,2.5,5,10].map(m=>m*mag).find(s=>span/s<=count+1)||mag*10;const start=Math.floor(min/step)*step,end=Math.ceil(max/step)*step,out:number[]=[];for(let v=start;v<=end+step/2;v+=step)out.push(Number(v.toFixed(10)));return out;}

export function renderChartSvg(raw:unknown){
 const spec=chartSpecSchema.parse(raw),{width:W,height:H}=spec,color=(i:number)=>spec.series[i].color||palette[i%palette.length];
 const top=spec.title?(spec.subtitle?74:54):24,legend=spec.series.length>1||spec.kind==='pie',bottom=(spec.xLabel?64:44)+(spec.source?22:0),left=spec.kind==='horizontal-bar'?150:(spec.yLabel?78:58),right=legend?170:28;
 const pw=W-left-right,ph=H-top-bottom,parts:string[]=[];
 parts.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
 if(spec.title)parts.push(`<text x="${left}" y="30" font-size="20" font-weight="700" fill="#1f2a3d">${esc(spec.title)}</text>`);
 if(spec.subtitle)parts.push(`<text x="${left}" y="54" font-size="14" fill="#5f6b80">${esc(spec.subtitle)}</text>`);
 if(spec.source)parts.push(`<text x="${left}" y="${H-10}" font-size="11" fill="#7a8599">${esc('Source: '+spec.source)}</text>`);
 const legendItems=(names:string[])=>names.forEach((name,i)=>{const y=top+10+i*22;parts.push(`<rect x="${W-right+18}" y="${y-10}" width="12" height="12" rx="2" fill="${spec.kind==='pie'?palette[i%palette.length]:color(i)}"/><text x="${W-right+36}" y="${y}" font-size="13" fill="#33405a">${esc(name.slice(0,22))}</text>`);});
 if(spec.kind==='pie'){
  const values=(spec.series[0].values||[]).map(v=>Math.max(0,v||0)),labels=spec.categories||values.map((_,i)=>String(i+1)),total=values.reduce((a,b)=>a+b,0)||1,cx=left+pw/2,cy=top+ph/2,r=Math.min(pw,ph)/2-10;let angle=-Math.PI/2;
  values.forEach((v,i)=>{const a=v/total*Math.PI*2,x1=cx+r*Math.cos(angle),y1=cy+r*Math.sin(angle),x2=cx+r*Math.cos(angle+a),y2=cy+r*Math.sin(angle+a),mid=angle+a/2;parts.push(`<path d="M${cx},${cy} L${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 ${a>Math.PI?1:0} 1 ${x2.toFixed(1)},${y2.toFixed(1)} Z" fill="${palette[i%palette.length]}" stroke="#fff" stroke-width="2"/>`);if(v/total>0.04)parts.push(`<text x="${(cx+r*0.65*Math.cos(mid)).toFixed(1)}" y="${(cy+r*0.65*Math.sin(mid)).toFixed(1)}" font-size="13" font-weight="600" fill="#fff" text-anchor="middle" dominant-baseline="middle">${Math.round(v/total*100)}%</text>`);angle+=a;});
  legendItems(labels);
 }else{
  const horizontal=spec.kind==='horizontal-bar',categorical=['bar','stacked-bar','horizontal-bar'].includes(spec.kind)||(!spec.series.some(s=>s.points)&&!!spec.categories);
  const cats=spec.categories||(categorical?(spec.series[0].values||[]).map((_,i)=>String(i+1)):[]);
  let ymin=0,ymax=0,xmin=0,xmax=1;
  if(spec.kind==='stacked-bar')cats.forEach((_,i)=>{let pos=0,neg=0;spec.series.forEach(s=>{const v=s.values?.[i]||0;if(v>=0)pos+=v;else neg+=v;});ymax=Math.max(ymax,pos);ymin=Math.min(ymin,neg);});
  else{const all=spec.series.flatMap(s=>s.points?s.points.map(p=>p[1]):(s.values||[]).filter((v):v is number=>v!==null));ymin=Math.min(0,...all);ymax=Math.max(...all,ymin+1);if(['line','scatter','area'].includes(spec.kind)&&Math.min(...all)>0&&Math.min(...all)>ymax*0.5)ymin=Math.min(...all);}
  const pointXs=spec.series.flatMap(s=>s.points?.map(p=>p[0])||[]);if(pointXs.length){xmin=Math.min(...pointXs);xmax=Math.max(...pointXs);if(xmin===xmax)xmax=xmin+1;}
  const yt=ticks(ymin,ymax);ymin=yt[0];ymax=yt[yt.length-1];
  const valuePos=(v:number)=>horizontal?left+(v-ymin)/(ymax-ymin)*pw:top+ph-(v-ymin)/(ymax-ymin)*ph;
  const band=(horizontal?ph:pw)/Math.max(1,cats.length),catPos=(i:number)=>(horizontal?top:left)+band*i+band/2;
  const xPos=(x:number)=>left+(x-xmin)/(xmax-xmin)*pw;
  yt.forEach(v=>{const p=valuePos(v);parts.push(horizontal?`<line x1="${p}" y1="${top}" x2="${p}" y2="${top+ph}" stroke="#e6e9ef"/><text x="${p}" y="${top+ph+18}" font-size="12" fill="#5f6b80" text-anchor="middle">${fmt(v)}</text>`:`<line x1="${left}" y1="${p}" x2="${left+pw}" y2="${p}" stroke="#e6e9ef"/><text x="${left-8}" y="${p+4}" font-size="12" fill="#5f6b80" text-anchor="end">${fmt(v)}</text>`);});
  if(categorical){const step=Math.ceil(cats.length/(horizontal?40:Math.max(1,Math.floor(pw/60))));cats.forEach((c,i)=>{if(i%step)return;const p=catPos(i);parts.push(horizontal?`<text x="${left-8}" y="${p+4}" font-size="12" fill="#33405a" text-anchor="end">${esc(c.slice(0,22))}</text>`:`<text x="${p}" y="${top+ph+18}" font-size="12" fill="#33405a" text-anchor="middle">${esc(c.slice(0,14))}</text>`);});}
  else ticks(xmin,xmax,6).filter(v=>v>=xmin&&v<=xmax).forEach(v=>parts.push(`<text x="${xPos(v)}" y="${top+ph+18}" font-size="12" fill="#5f6b80" text-anchor="middle">${fmt(v)}</text>`));
  parts.push(`<line x1="${left}" y1="${top+ph}" x2="${left+pw}" y2="${top+ph}" stroke="#9aa4b5"/><line x1="${left}" y1="${top}" x2="${left}" y2="${top+ph}" stroke="#9aa4b5"/>`);
  if(spec.xLabel)parts.push(`<text x="${left+pw/2}" y="${top+ph+44}" font-size="13" fill="#33405a" text-anchor="middle">${esc(spec.xLabel)}</text>`);
  if(spec.yLabel)parts.push(`<text transform="translate(${horizontal?left+pw/2:18},${horizontal?top+ph+44:top+ph/2})${horizontal?'':' rotate(-90)'}" font-size="13" fill="#33405a" text-anchor="middle">${esc(spec.yLabel)}</text>`);
  const zero=valuePos(Math.max(ymin,0));
  if(['bar','horizontal-bar'].includes(spec.kind)){const n=spec.series.length,w=band*0.78/n;spec.series.forEach((s,si)=>(s.values||[]).forEach((v,i)=>{if(v===null)return;const c=catPos(i)-band*0.39+w*si,p=valuePos(v);parts.push(horizontal?`<rect x="${Math.min(zero,p)}" y="${c}" width="${Math.abs(p-zero)}" height="${w}" fill="${color(si)}"/>`:`<rect x="${c}" y="${Math.min(zero,p)}" width="${w}" height="${Math.abs(p-zero)}" fill="${color(si)}"/>`);if(n===1&&cats.length<=24)parts.push(horizontal?`<text x="${p+4}" y="${c+w/2+4}" font-size="11" fill="#33405a">${fmt(v)}</text>`:`<text x="${c+w/2}" y="${Math.min(zero,p)-4}" font-size="11" fill="#33405a" text-anchor="middle">${fmt(v)}</text>`);}));}
  else if(spec.kind==='stacked-bar'){cats.forEach((_,i)=>{let pos=0,neg=0;spec.series.forEach((s,si)=>{const v=s.values?.[i]||0;if(!v)return;const from=v>=0?pos:neg,to=from+v;if(v>=0)pos=to;else neg=to;const a=valuePos(from),b=valuePos(to),c=catPos(i)-band*0.36;parts.push(`<rect x="${c}" y="${Math.min(a,b)}" width="${band*0.72}" height="${Math.abs(a-b)}" fill="${color(si)}"/>`);});});}
  else spec.series.forEach((s,si)=>{const pts=(s.points?s.points.map(([x,y])=>[xPos(x),valuePos(y)]):(s.values||[]).map((v,i)=>v===null?null:[catPos(i),valuePos(v)])).filter((p):p is number[]=>!!p);if(!pts.length)return;
   if(spec.kind==='scatter')pts.forEach(([x,y])=>parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="${color(si)}" fill-opacity="0.8"/>`));
   else{const d=pts.map(([x,y],i)=>(i?'L':'M')+x.toFixed(1)+','+y.toFixed(1)).join(' ');if(spec.kind==='area')parts.push(`<path d="${d} L${pts[pts.length-1][0].toFixed(1)},${zero} L${pts[0][0].toFixed(1)},${zero} Z" fill="${color(si)}" fill-opacity="0.18"/>`);parts.push(`<path d="${d}" fill="none" stroke="${color(si)}" stroke-width="2.5"/>`);if(pts.length<=40)pts.forEach(([x,y])=>parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="${color(si)}"/>`));}});
  if(legend)legendItems(spec.series.map((s,i)=>s.name||'Series '+(i+1)));
 }
 return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Arial, Helvetica, sans-serif" role="img" aria-label="${esc(spec.title||'Chart')}">${parts.join('')}</svg>`;
}
