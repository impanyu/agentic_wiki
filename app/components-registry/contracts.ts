import {z} from 'zod';
export const componentTypes=['page','frontend_template','backend_code','workflow','api_adapter','credential','tool','data','resource'] as const;
export type ComponentType=string;
export const componentTypeSchema=z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
export type ComponentRef={id:string;version:number};
export type Parameters=Record<string,string|number|boolean>;
export const parametersSchema=z.record(z.union([z.string().max(4000),z.number().finite(),z.boolean()])).refine(v=>Object.keys(v).length<=30);
const name=z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);
export const formSchema=z.object({kind:z.literal('form'),submit:z.string().min(1).max(80),fields:z.array(z.object({name,label:z.string().min(1).max(120),type:z.enum(['number','text']),default:z.union([z.string().max(4000),z.number().finite()]).nullable()})).min(1).max(12),outputs:z.array(z.object({name,label:z.string().min(1).max(120)})).min(1).max(12)}).strict().superRefine((v,c)=>{for(const rows of [v.fields,v.outputs])if(new Set(rows.map(x=>x.name)).size!==rows.length)c.addIssue({code:'custom',message:'Duplicate field'});});
// A page program's view form may only collect inputs; its results render elsewhere in the view.
export const programFormSchema=z.object({kind:z.literal('form'),submit:z.string().min(1).max(80),fields:z.array(z.object({name,label:z.string().min(1).max(120),type:z.enum(['number','text']),default:z.union([z.string().max(4000),z.number().finite()]).nullable()})).min(1).max(12),outputs:z.array(z.object({name,label:z.string().min(1).max(120)})).max(12).default([])}).strict().superRefine((v,c)=>{for(const rows of [v.fields,v.outputs])if(new Set(rows.map(x=>x.name)).size!==rows.length)c.addIssue({code:'custom',message:'Duplicate field'});});
export type FormDefinition=z.infer<typeof formSchema>;
// A bounded, data-only language: no eval, imports, loops, ambient secrets or arbitrary network.
export type Expression=number|string|{input:string}|{step:string}|{op:string;args:Expression[]};
export type Program={kind:'expression-program';outputs:Record<string,Expression>};
export const programSchema=z.object({kind:z.literal('expression-program'),outputs:z.record(z.unknown())}).strict();
export function validateExpression(value:unknown,inputs:Set<string>,steps:Set<string>,depth=0):asserts value is Expression{
 if(depth>16)throw new Error('EXPRESSION_TOO_DEEP');
 if(typeof value==='number'&&Number.isFinite(value)||typeof value==='string'&&value.length<=4000)return;
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('INVALID_EXPRESSION');
 const v=value as Record<string,unknown>,keys=Object.keys(v);
 if(keys.length===1&&typeof v.input==='string'&&inputs.has(v.input))return;
 if(keys.length===1&&typeof v.step==='string'&&steps.has(v.step))return;
 if(keys.length===2&&typeof v.op==='string'&&['add','subtract','multiply','divide','power','sqrt','abs','min','max','round','concat','lowercase','uppercase','length','trim'].includes(v.op)&&Array.isArray(v.args)&&v.args.length>0&&v.args.length<=12){
  const arity:Record<string,number>={subtract:2,divide:2,power:2,sqrt:1,abs:1,round:1,lowercase:1,uppercase:1,length:1,trim:1};
  if(arity[v.op]&&v.args.length!==arity[v.op])throw new Error('INVALID_ARITY');
  v.args.forEach(x=>validateExpression(x,inputs,steps,depth+1));return;
 }throw new Error('INVALID_EXPRESSION');
}
export function validateProgram(raw:unknown,fields:string[]){
 if(JSON.stringify(raw).length>64000)throw new Error('PROGRAM_TOO_LARGE');
 const p=programSchema.parse(raw) as Program,steps=new Set<string>();
 if(!Object.keys(p.outputs).length||Object.keys(p.outputs).length>24)throw new Error('INVALID_OUTPUTS');
 for(const [key,expr]of Object.entries(p.outputs)){name.parse(key);validateExpression(expr,new Set(fields),steps);steps.add(key);}
 return p;
}
export function evaluate(expr:Expression,input:Parameters,steps:Parameters):string|number{
 if(typeof expr==='number'||typeof expr==='string')return expr;
 if('input'in expr){const v=input[expr.input];if(typeof v!=='string'&&typeof v!=='number')throw new Error('MISSING_INPUT');return v;}
 if('step'in expr){const v=steps[expr.step];if(typeof v!=='string'&&typeof v!=='number')throw new Error('MISSING_STEP');return v;}
 const a=expr.args.map(x=>evaluate(x,input,steps));
 if(expr.op==='concat')return a.join('').slice(0,16000);
 if(['lowercase','uppercase','length','trim'].includes(expr.op)){const s=String(a[0]);return expr.op==='lowercase'?s.toLowerCase():expr.op==='uppercase'?s.toUpperCase():expr.op==='trim'?s.trim():s.length;}
 if(a.some(v=>typeof v!=='number'))throw new Error('NUMBER_REQUIRED');
 const n=a as number[];
 const v=expr.op==='add'?n.reduce((a,b)=>a+b):expr.op==='subtract'?n[0]-n[1]:expr.op==='multiply'?n.reduce((a,b)=>a*b):expr.op==='divide'?n[0]/n[1]:expr.op==='power'?n[0]**n[1]:expr.op==='sqrt'?Math.sqrt(n[0]):expr.op==='abs'?Math.abs(n[0]):expr.op==='min'?Math.min(...n):expr.op==='max'?Math.max(...n):Math.round(n[0]);
 if(!Number.isFinite(v))throw new Error('INVALID_RESULT');return v;
}
export function executeProgram(raw:unknown,input:Parameters){const p=validateProgram(raw,Object.keys(input)),out:Parameters={};for(const [key,e]of Object.entries(p.outputs))out[key]=evaluate(e,input,out);return out;}
export function validateParameters(form:FormDefinition,raw:unknown){const input=parametersSchema.parse(raw),result:Parameters={};for(const field of form.fields){const v=input[field.name];if(field.type==='number'?typeof v!=='number':typeof v!=='string')throw new Error('INVALID_INPUT');result[field.name]=v;}return result;}

export const dataReferenceSchema=z.object({kind:z.literal('data-reference'),location:z.string().min(1).max(2000),format:z.string().max(100).optional(),fileName:z.string().max(250).optional(),mimeType:z.string().max(200).optional(),size:z.number().int().min(0).optional(),description:z.string().max(2000).optional()}).strict();
