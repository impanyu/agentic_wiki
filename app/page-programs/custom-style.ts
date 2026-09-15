import {z} from 'zod';
const color=z.string().regex(/^#[0-9a-fA-F]{6}$/),font=z.enum(['sans','serif','mono','rounded']);
export const customStyleSchema=z.object({accent:color,tint:color,canvas:color,surface:color,text:color,muted:color,border:color,headingFont:font,bodyFont:font,radius:z.number().int().min(0).max(28),spacing:z.number().int().min(12).max(32),width:z.number().int().min(720).max(1440),header:z.enum(['line','panel']),density:z.enum(['compact','comfortable']),shadow:z.enum(['flat','soft']),cardLayout:z.enum(['grid','stack'])}).strict();
export type CustomStyle=z.infer<typeof customStyleSchema>;
const hex={type:'string',pattern:'^#[0-9a-fA-F]{6}$'},fonts={type:'string',enum:['sans','serif','mono','rounded']};
const customStyleProperties={accent:hex,tint:hex,canvas:hex,surface:hex,text:hex,muted:hex,border:hex,headingFont:fonts,bodyFont:fonts,radius:{type:'integer',minimum:0,maximum:28},spacing:{type:'integer',minimum:12,maximum:32},width:{type:'integer',minimum:720,maximum:1440},header:{type:'string',enum:['line','panel']},density:{type:'string',enum:['compact','comfortable']},shadow:{type:'string',enum:['flat','soft']},cardLayout:{type:'string',enum:['grid','stack']}};
export const customStyleFormat={type:['object','null'],additionalProperties:false,properties:customStyleProperties,required:Object.keys(customStyleProperties)};
export const styleFonts={sans:'Arial, Helvetica, sans-serif',serif:'Georgia, "Times New Roman", serif',mono:'"SFMono-Regular", Consolas, monospace',rounded:'ui-rounded, "Trebuchet MS", Arial, sans-serif'};
export function contrast(a:string,b:string){const lum=(hex:string)=>{const c=hex.slice(1).match(/../g)!.map(n=>parseInt(n,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2];};const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
export const readableInk=(background:string)=>contrast('#ffffff',background)>=contrast('#17202a',background)?'#ffffff':'#17202a';
export function normalizeCustomStyle(raw:unknown):CustomStyle{
 const d=customStyleSchema.parse(raw);
 // Keep the authored palette. Readable foregrounds are derived per surface at
 // render time, so a dark canvas and a light card can coexist.
 if(contrast(d.text,d.surface)<4.5)d.text=readableInk(d.surface);
 if(contrast(d.muted,d.surface)<4.5)d.muted=d.text;
 return d;
}
