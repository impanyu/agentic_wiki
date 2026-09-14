// Decode only the top-level reply string as structured JSON arrives. Never emit
// proposal bodies or incomplete escape sequences into the comment thread.
export function partialReply(json:string){
 const match=/"reply"\s*:\s*"/.exec(json);if(!match)return '';
 let value='';
 for(let i=match.index+match[0].length;i<json.length;i++){
  const c=json[i];if(c==='"')break;
  if(c!=='\\'){value+=c;continue;}
  if(++i>=json.length)break;
  const e=json[i];if(e==='u'){const hex=json.slice(i+1,i+5);if(!/^[0-9a-f]{4}$/i.test(hex))break;value+=String.fromCharCode(parseInt(hex,16));i+=4;}
  else {const escapes:Record<string,string>={'"':'"','\\':'\\','/':'/','b':'\b','f':'\f','n':'\n','r':'\r','t':'\t'};if(!(e in escapes))break;value+=escapes[e];}
 }
 // Wait for the trailing half of an escaped UTF-16 surrogate pair.
 return /[\uD800-\uDBFF]$/.test(value)?value.slice(0,-1):value;
}
