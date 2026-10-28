// Perceptual colormaps as small control-point tables, linearly interpolated.
// Each table is a list of [position 0..1, '#rrggbb'] stops (sRGB).
type Stops=[number,string][];
const even=(hex:string[]):Stops=>hex.map((h,i)=>[i/(hex.length-1),h]);
const TABLES:Record<string,Stops>={
 viridis:even(['#440154','#482878','#3e4989','#31688e','#26828e','#1f9e89','#35b779','#6ece58','#fde725']),
 plasma:even(['#0d0887','#46039f','#7201a8','#9c179e','#bd3786','#d8576b','#ed7953','#fb9f3a','#fdca26','#f0f921']),
 turbo:even(['#30123b','#4145ab','#4675ed','#39a2fc','#1bcfd4','#24eca6','#61fc6c','#a4fc3b','#d1e834','#f3c63a','#fe9b2d','#f36315','#d93806','#b11901','#7a0402']),
 terrain:[[0,'#333399'],[0.15,'#0099ff'],[0.25,'#00cc66'],[0.5,'#ffff99'],[0.75,'#805c54'],[1,'#ffffff']],
};
const parsed:Record<string,[number,number,number,number][]>={};
function table(name:string){
 const key=TABLES[name]?name:'viridis';
 return parsed[key]||=TABLES[key].map(([p,h])=>[p,parseInt(h.slice(1,3),16)/255,parseInt(h.slice(3,5),16)/255,parseInt(h.slice(5,7),16)/255]);
}
export const COLORMAPS=Object.keys(TABLES);
/** Maps t in 0..1 (clamped; NaN → 0) to an sRGB triple in 0..1. Unknown names fall back to viridis. */
export function colormap(name:string,t:number):[number,number,number]{
 const s=table(name),v=Number.isFinite(t)?Math.min(1,Math.max(0,t)):0;
 let i=1;while(i<s.length-1&&s[i][0]<v)i++;
 const a=s[i-1],b=s[i],f=b[0]>a[0]?(v-a[0])/(b[0]-a[0]):0;
 return [a[1]+(b[1]-a[1])*f,a[2]+(b[2]-a[2])*f,a[3]+(b[3]-a[3])*f];
}
/** CSS linear-gradient stops for a colorbar. */
export function colormapGradient(name:string,dir='to top',n=12):string{
 const parts:string[]=[];for(let i=0;i<=n;i++){const [r,g,b]=colormap(name,i/n);parts.push(`rgb(${Math.round(r*255)},${Math.round(g*255)},${Math.round(b*255)}) ${(i/n*100).toFixed(1)}%`);}
 return `linear-gradient(${dir},${parts.join(',')})`;
}
