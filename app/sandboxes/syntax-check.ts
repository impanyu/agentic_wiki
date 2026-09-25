import {Script} from 'node:vm';

// Precise syntax feedback for generated JavaScript. V8's "Unexpected end of input" names no
// line, so coding agents kept rewriting whole programs that were one closing brace short.
// This reports the failing line and an unbalanced-bracket map.

type Opener={char:string;line:number};
const pairs:Record<string,string>={')':'(',']':'[','}':'{'};

// Scans code for bracket balance, skipping comments, strings and template text. Regex literals
// are not recognised, so the result is phrased as advice.
export function bracketBalance(code:string):string|null{
 const stack:Opener[]=[],templates:number[]=[];let line=1,i=0;
 const problems:string[]=[];
 while(i<code.length){
  const c=code[i],n=code[i+1];
  if(c==='\n'){line++;i++;continue;}
  if(c==='/'&&n==='/'){while(i<code.length&&code[i]!=='\n')i++;continue;}
  if(c==='/'&&n==='*'){i+=2;while(i<code.length&&!(code[i]==='*'&&code[i+1]==='/')){if(code[i]==='\n')line++;i++;}i+=2;continue;}
  if(c==='"'||c==="'"){i++;while(i<code.length&&code[i]!==c&&code[i]!=='\n'){if(code[i]==='\\')i++;i++;}i++;continue;}
  if(c==='`'||(c==='}'&&templates.length&&templates[templates.length-1]===stack.length)){
   // Template text until the closing backtick or the next ${ (which re-enters code).
   if(c==='}')templates.pop();
   i++;
   while(i<code.length&&code[i]!=='`'){if(code[i]==='\\'){i+=2;continue;}if(code[i]==='\n')line++;if(code[i]==='$'&&code[i+1]==='{'){templates.push(stack.length);i+=2;break;}i++;}
   if(code[i]==='`')i++;
   continue;
  }
  if(c==='('||c==='['||c==='{')stack.push({char:c,line});
  else if(c===')'||c===']'||c==='}'){
   const top=stack.pop();
   if(!top){problems.push(`unexpected '${c}' at line ${line} with nothing open`);break;}
   if(top.char!==pairs[c]){problems.push(`'${c}' at line ${line} closes '${top.char}' opened at line ${top.line}`);break;}
  }
  i++;
 }
 if(!problems.length&&stack.length)problems.push(stack.slice(-3).reverse().map(o=>`'${o.char}' opened at line ${o.line}`).join(', ')+` ${stack.length===1?'is':'are'} never closed`+(stack.length>3?` (${stack.length} unclosed in total)`:''));
 return problems.length?'Bracket check: '+problems.join('; ')+'.':null;
}

// Returns null when the program parses (or uses module syntax a classic script cannot check);
// otherwise a message with the failing line, its text and the bracket map.
export function javascriptSyntaxDiagnosis(code:string):string|null{
 const source=code.replace(/^(\s*)export\s+(?:default\s+)?(?=async\b|function\b|const\b|let\b|class\b)/gm,'$1');
 try{new Script(`(async()=>{\n${source}\n})`,{filename:'program.js'});return null;}
 catch(e){
  if(!(e instanceof SyntaxError))return null;
  if(/\bimport\b|\bexport\b/.test(e.message))return null;
  const lines=code.split('\n'),last=lines.length-[...lines].reverse().findIndex(l=>l.trim()),at=Number(String(e.stack||'').match(/program\.js:(\d+)/)?.[1]||0)-1;
  const balance=bracketBalance(code);
  // The wrapper's own closing line (or V8's "end of input") means the program stopped early.
  if(/end of input/i.test(e.message)||at>last)return `SyntaxError: the program ends at line ${last} before every block is closed.${balance?' '+balance:''} Add the missing closing brackets rather than rewriting the program.`;
  const where=at>=1?` at line ${at} of ${last}: ${lines[at-1].trim().slice(0,200)}`:'';
  return `SyntaxError: ${e.message}${where}.${balance?' '+balance:''}`;
 }
}
