import {z} from 'zod';
export const codeSchema=z.object({kind:z.literal('sandbox-program'),language:z.enum(['javascript','python']),code:z.string().min(1).max(48000)}).strict();
export type CodeProgram=z.infer<typeof codeSchema>;
export const desktopActionSchema=z.discriminatedUnion('type',[
 z.object({type:z.literal('screenshot')}),
 z.object({type:z.literal('click'),x:z.number().int().min(0).max(1023),y:z.number().int().min(0).max(767),button:z.enum(['left','right','double']).default('left')}),
 z.object({type:z.literal('type'),text:z.string().max(4000)}),
 z.object({type:z.literal('press'),keys:z.array(z.string().regex(/^[a-zA-Z0-9_+-]{1,30}$/)).min(1).max(4)}),
 z.object({type:z.literal('scroll'),direction:z.enum(['up','down']),amount:z.number().int().min(1).max(10)}),
 z.object({type:z.literal('launch'),application:z.enum(['browser','editor','terminal'])}),
]);
export type DesktopAction=z.infer<typeof desktopActionSchema>;
export function executionFiles(program:CodeProgram,input:unknown,root='/home/user'){
 const serialized=JSON.stringify(input);if(serialized.length>64000)throw new Error('SANDBOX_INPUT_TOO_LARGE');
 const files=[{path:root+'/input.json',data:serialized}];
 if(program.language==='javascript')files.push({path:root+'/program.mjs',data:program.code},{path:root+'/run.mjs',data:`import {readFileSync,writeFileSync} from 'node:fs';\nimport {main} from './program.mjs';\nconst result=await main(JSON.parse(readFileSync('${root}/input.json','utf8')));\nwriteFileSync('${root}/result.json',JSON.stringify(result));`});
 else files.push({path:root+'/program.py',data:program.code},{path:root+'/run.py',data:`import json, asyncio, inspect\nfrom program import main\nwith open('${root}/input.json') as f: result=main(json.load(f))\nif inspect.isawaitable(result): result=asyncio.run(result)\nwith open('${root}/result.json','w') as f: json.dump(result,f,allow_nan=False)`});
 return {files,command:program.language==='javascript'?'node '+root+'/run.mjs':'python3 '+root+'/run.py'};
}
export function assertSession(row:{owner_id:string;state:string;expires_at:number}|null,userId:string){if(!row||row.owner_id!==userId)throw new Error('SANDBOX_NOT_FOUND');if(row.state!=='active'||row.expires_at<=Date.now())throw new Error('SANDBOX_EXPIRED');}
