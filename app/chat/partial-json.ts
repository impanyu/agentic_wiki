// Read a top-level JSON string while a structured response is still arriving.
// Nested objects and escaped quotes cannot impersonate the requested field.
export function partialJsonString(json:string,key:string):string|undefined{
 const read=(start:number)=>{
  let value='';let i=start+1;
  for(;i<json.length;i++){
   const c=json[i];if(c==='"')return {value,end:i+1,closed:true};
   if(c!=='\\'){value+=c;continue;}
   if(++i>=json.length)break;
   const e=json[i];
   if(e==='u'){const hex=json.slice(i+1,i+5);if(!/^[0-9a-f]{4}$/i.test(hex))break;value+=String.fromCharCode(parseInt(hex,16));i+=4;}
   else{const escapes:Record<string,string>={'"':'"','\\':'\\','/':'/','b':'\b','f':'\f','n':'\n','r':'\r','t':'\t'};if(!(e in escapes))break;value+=escapes[e];}
  }
  return {value:/[\uD800-\uDBFF]$/.test(value)?value.slice(0,-1):value,end:i,closed:false};
 };
 let depth=0;
 for(let i=0;i<json.length;){
  const c=json[i];
  if(c==='"'){
   const token=read(i);if(!token.closed)return;
   let next=token.end;while(/\s/.test(json[next]||'')&&next<json.length)next++;
   if(depth===1&&token.value===key&&json[next]===':'){
    next++;while(/\s/.test(json[next]||'')&&next<json.length)next++;
    return json[next]==='"'?read(next).value:undefined;
   }
   i=token.end;continue;
  }
  if(c==='{'||c==='[')depth++;if(c==='}'||c===']')depth--;i++;
 }
}
