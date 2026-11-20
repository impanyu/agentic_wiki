// Minimal JSON-Schema check for structured outputs from providers without native json_schema
// (covers the keywords this app's schemas use: type, properties, required, additionalProperties,
// items, enum, const, anyOf, minItems, maxItems, minimum, maximum).
export function schemaErrors(schema:any,value:unknown,path='$',errors:string[]=[]):string[]{
 if(!schema||typeof schema!=='object'||errors.length>20)return errors;
 if(Array.isArray(schema.anyOf)){if(!schema.anyOf.some((s:any)=>!schemaErrors(s,value,path).length))errors.push(path+' matches no allowed shape');return errors;}
 if(schema.enum&&!schema.enum.some((e:unknown)=>e===value))errors.push(path+' must be one of '+JSON.stringify(schema.enum).slice(0,200));
 if('const' in schema&&schema.const!==value)errors.push(path+' must be '+JSON.stringify(schema.const));
 const types:string[]=schema.type?[].concat(schema.type):[];
 const kind=value===null?'null':Array.isArray(value)?'array':typeof value;
 if(types.length&&!types.some(t=>t===kind||(t==='integer'&&kind==='number'&&Number.isInteger(value))||(t==='number'&&kind==='number'))){errors.push(path+' must be '+types.join('|'));return errors;}
 if(kind==='number'){if(typeof schema.minimum==='number'&&(value as number)<schema.minimum)errors.push(path+' below minimum');if(typeof schema.maximum==='number'&&(value as number)>schema.maximum)errors.push(path+' above maximum');}
 if(kind==='array'){
  const list=value as unknown[];
  if(typeof schema.minItems==='number'&&list.length<schema.minItems)errors.push(path+' needs at least '+schema.minItems+' items');
  if(typeof schema.maxItems==='number'&&list.length>schema.maxItems)errors.push(path+' allows at most '+schema.maxItems+' items');
  if(schema.items)list.forEach((v,i)=>schemaErrors(schema.items,v,path+'['+i+']',errors));
 }
 if(kind==='object'){
  const obj=value as Record<string,unknown>,props=schema.properties||{};
  for(const key of schema.required||[])if(!(key in obj))errors.push(path+'.'+key+' is required');
  for(const [key,v] of Object.entries(obj)){
   if(props[key])schemaErrors(props[key],v,path+'.'+key,errors);
   else if(schema.additionalProperties===false)errors.push(path+'.'+key+' is not allowed');
   else if(schema.additionalProperties&&typeof schema.additionalProperties==='object')schemaErrors(schema.additionalProperties,v,path+'.'+key,errors);
  }
 }
 return errors;
}
// Models without native structured output often wrap JSON in fences or prose.
export function extractJson(text:string):string{
 const trimmed=text.trim(),fenced=trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
 if(fenced)return fenced[1];
 if(/^[\[{]/.test(trimmed))return trimmed;
 const start=trimmed.search(/[\[{]/),end=Math.max(trimmed.lastIndexOf('}'),trimmed.lastIndexOf(']'));
 return start>=0&&end>start?trimmed.slice(start,end+1):trimmed;
}
