import {z} from 'zod';
import {units,type UnitId,type ConversionInput,type ConversionResult} from './units';
const ids=new Set<string>(units.map(u=>u.id));
export const conversionSchema=z.object({value:z.number().finite().min(-1e15).max(1e15),from:z.string().refine(id=>ids.has(id)),to:z.string().refine(id=>ids.has(id))}).strict();
// Registered backend functions only. Never evaluate model-generated code.
export function executeConversion(raw:unknown):ConversionResult{
 const parsed=conversionSchema.parse(raw);
 const input={...parsed,from:parsed.from as UnitId,to:parsed.to as UnitId};
 const from=units.find(u=>u.id===input.from)!,to=units.find(u=>u.id===input.to)!;
 if(from.group!==to.group)throw new Error('INCOMPATIBLE_UNITS');
 let value:number;
 if(from.group==='temperature'){
  const kelvin=from.id==='c'?input.value+273.15:from.id==='f'?(input.value-32)*5/9+273.15:input.value;
  if(kelvin< -1e-10)throw new Error('BELOW_ABSOLUTE_ZERO');
  value=to.id==='c'?kelvin-273.15:to.id==='f'?(kelvin-273.15)*9/5+32:kelvin;
 }else value=input.value*from.factor/to.factor;
 if(!Number.isFinite(value))throw new Error('INVALID_RESULT');
 if(Object.is(value,-0))value=0;
 return {input,value,fromSymbol:from.symbol,toSymbol:to.symbol,calculatedAt:new Date().toISOString()};
}
export function runDestination(executor:string,raw:unknown){
 if(executor!=='unit-converter-v1')throw new Error('UNKNOWN_EXECUTOR');
 return executeConversion(raw);
}
export function inputFromUrl(url:URL):ConversionInput|undefined{
 if(!['value','from','to'].some(key=>url.searchParams.has(key)))return undefined;
 const value=url.searchParams.get('value');
 if(value===null||!value.trim())throw new Error('INVALID_INPUT');
 return executeConversion({value:Number(value),from:url.searchParams.get('from'),to:url.searchParams.get('to')}).input;
}
