// JSON-encoded tool arguments written by the coding agents (changeJson, draftJson, programJson...).
// Whole programs travel inside these strings, and the most common mistake is a raw newline, tab
// or other control character inside a string value; that is repaired. Anything else is reported
// with the text around the failure so the agent can fix the exact spot instead of resubmitting
// the same payload.
export function repairJsonStrings(text:string){
 let out='',inString=false,escaped=false;
 for(const ch of text){
  if(inString){
   if(escaped){out+=ch;escaped=false;continue;}
   if(ch==='\\'){out+=ch;escaped=true;continue;}
   if(ch==='"'){out+=ch;inString=false;continue;}
   const code=ch.charCodeAt(0);
   if(code<0x20){out+=ch==='\n'?'\\n':ch==='\r'?'\\r':ch==='\t'?'\\t':'\\u'+code.toString(16).padStart(4,'0');continue;}
   out+=ch;continue;
  }
  if(ch==='"')inString=true;
  out+=ch;
 }
 return out;
}
export function parseToolJson(text:unknown,label='argument'):any{
 if(typeof text!=='string')throw Error(`${label} must be a JSON-encoded string.`);
 try{return JSON.parse(text);}catch(first){
  const repaired=repairJsonStrings(text);
  try{return JSON.parse(repaired);}catch(second){
   // A complete value followed only by stray closing brackets (a common slip when closing nested JSON).
   const at=Number(String(second instanceof Error?second.message:'').match(/after JSON at position (\d+)/)?.[1]);
   if(Number.isFinite(at)&&/^[\s}\]]+$/.test(repaired.slice(at))){try{return JSON.parse(repaired.slice(0,at));}catch{}}
  }
  const message=first instanceof Error?first.message:'Invalid JSON';
  const at=Number(message.match(/position (\d+)/)?.[1]);
  const context=Number.isFinite(at)?` Text around position ${at}: …${JSON.stringify(text.slice(Math.max(0,at-80),at))} ⟵HERE⟶ ${JSON.stringify(text.slice(at,at+60))}…`:'';
  throw Error(`${label} is not valid JSON: ${message}.${context} Usually a double quote inside code or text was not escaped as \\" (or a backslash as \\\\), or the JSON ended early. Fix that spot rather than resubmitting the same text; for large code, change the frontend (kind="code") and backend (kind="program") in separate proposals.`);
 }
}
