export function translateUi(text:string,catalog:Record<string,string>,dictionary:Record<string,string>,values?:Record<string,string|number>){
 if(text.startsWith('Error: '))text=text.slice(7);
 let value=Object.hasOwn(catalog,text)?dictionary[text]||text:text;
 // Fixed error prefixes may be followed by a title; never translate the title itself.
 if(value===text)for(const key of Object.keys(dictionary).filter(key=>key.endsWith(' ')&&key.length>8).sort((a,b)=>b.length-a.length))if(text.startsWith(key)){value=dictionary[key]+text.slice(key.length);break;}
 return value.replace(/\{(\w+)\}/g,(match,key)=>String(values?.[key]??match));
}
