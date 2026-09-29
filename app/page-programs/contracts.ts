import {resourceSchema} from '@/app/resources/contracts';
import {normalizeGeoJSON} from '@/app/geo/data';
import {z} from 'zod';import {programFormSchema} from '@/app/components-registry/contracts';import {chartSchema} from '@/app/components-registry/chart-contracts';
export const mapSchema=z.object({title:z.string().min(1).max(200),geojson:z.unknown().transform((value,ctx)=>{try{return normalizeGeoJSON(value);}catch(e){ctx.addIssue({code:z.ZodIssueCode.custom,message:e instanceof Error?e.message:'Invalid map data'});return z.NEVER;}})}).strict();
// A program's view is shown even when a text field runs long (a big folder listed in the reply,
// for example): over-long text is shortened with a visible note instead of failing the page.
const LIMITS:Record<string,number>={title:200,summary:1000,body:40000,reply:12000};
// Custom frontends sometimes carry JSON in reply and parse it; such a reply is data, not prose,
// and is never cut (it is bounded like data instead).
const isJsonText=(text:string)=>text.length<=4_000_000&&/^\s*[\[{]/.test(text);
const shorten=(text:string,max:number)=>text.length>max?text.slice(0,max-40).trimEnd()+' … (shortened)':text;
export function fitView(raw:unknown):unknown{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return raw;
 const view={...raw as Record<string,unknown>};
 for(const [key,max] of Object.entries(LIMITS))if(typeof view[key]==='string'&&!(key==='reply'&&isJsonText(view[key] as string))&&(view[key] as string).length>max){console.warn('Page program view '+key+' shortened',(view[key] as string).length,JSON.stringify((view[key] as string).slice(0,120)));view[key]=shorten(view[key] as string,max);}
 if(Array.isArray(view.files)&&view.files.length>500){const total=view.files.length;view.files=view.files.slice(0,500);const note='Showing the first 500 of '+total+' entries.';if(typeof view.reply==='string'&&isJsonText(view.reply))view.summary=shorten((typeof view.summary==='string'?view.summary+' ':'')+note,1000);else view.reply=shorten(typeof view.reply==='string'&&view.reply?view.reply+'\n\n'+note:note,12000);}
 if(view.results&&typeof view.results==='object'&&!Array.isArray(view.results))view.results=Object.fromEntries(Object.entries(view.results as Record<string,unknown>).map(([k,v])=>[k,typeof v==='string'?shorten(v,12000):v]));
 return view;
}
export const viewSchema=z.preprocess(fitView,z.object({templateId:z.enum(['wiki-v1','chat-v1','files-v1','dashboard-v1','form-v1','table-v1']),title:z.string().max(200),summary:z.string().max(1000),body:z.string().max(40000).optional(),reply:z.string().max(4_000_000).refine(t=>t.length<=12000||isJsonText(t),'reply must be at most 12,000 characters unless it is JSON data').optional(),data:z.unknown().refine(v=>JSON.stringify(v).length<=2_000_000,'data must serialize to at most 2 MB').optional(),sources:z.array(z.object({title:z.string().max(400),url:z.string().url().refine(u=>u.startsWith('https://'))})).max(100).optional(),files:z.array(z.object({id:z.string().max(2000),name:z.string().max(300),kind:z.enum(['file','folder']),resource:resourceSchema.optional(),parents:z.array(z.string()).optional(),modifiedTime:z.string().optional()})).max(500).optional(),next:z.string().max(8000).nullable().optional(),map:mapSchema.optional(),chart:chartSchema.optional(),dataset:z.unknown().optional(),form:programFormSchema.optional(),results:z.record(z.union([z.string().max(12000),z.number().finite(),z.boolean()])).optional()}).strict());
export type PageView=z.infer<typeof viewSchema>;
export const callSchema=z.object({id:z.string().regex(/^[A-Za-z][A-Za-z0-9_.:-]{0,119}$/),tool:z.enum(['connectors.list','connectors.call','contexts.search','jobs.list','storage.connections','storage.execute','data.list','files.list','files.read','files.analyze','resources.browse','resources.copy','resources.move','maps.search','maps.reverse','earthengine.run','api.execute','research','llm']),args:z.record(z.unknown())}).strict();
export const programOutput=z.union([z.object({call:callSchema}).strict(),z.object({calls:z.array(callSchema).min(1).max(100)}).strict(),z.object({view:viewSchema}).strict()]);
