import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const source=readFileSync('app/components-registry/contracts.ts','utf8').replace("from 'zod'",`from '${pathToFileURL(process.cwd()+'/node_modules/zod/index.js')}'`);
const {executeProgram,validateProgram,validateParameters,formSchema}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile(source,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
test('generated program executes chained steps without model arithmetic',()=>{
 const p={kind:'expression-program',outputs:{area:{op:'multiply',args:[{input:'width'},{input:'height'}]},paint:{op:'divide',args:[{step:'area'},10]}}};
 assert.deepEqual(executeProgram(p,{width:8,height:5}),{area:40,paint:4});
 assert.deepEqual(executeProgram({kind:'expression-program',outputs:{text:{op:'uppercase',args:[{op:'trim',args:[{input:'text'}]}]}}},{text:' hello '}),{text:'HELLO'});
});
test('rejects unknown code, forward references, invalid arity and nonfinite output',()=>{
 for(const expr of [{op:'fetch',args:['https://example.com']},{step:'future'},{input:'missing'},{op:'sqrt',args:[1,2]},{op:'eval',args:['process.env']},{input:'x',extra:true}])assert.throws(()=>validateProgram({kind:'expression-program',outputs:{result:expr}},['x']));
 assert.throws(()=>executeProgram({kind:'expression-program',outputs:{result:{op:'divide',args:[1,0]}}},{}));
});
test('form validates explicit input types and removes extra fields',()=>{
 const f=formSchema.parse({kind:'form',submit:'Run',fields:[{name:'x',label:'Width',type:'number',default:null}],outputs:[{name:'result',label:'Result'}]});
 assert.deepEqual(validateParameters(f,{x:2,secret:'ignore'}),{x:2});assert.throws(()=>validateParameters(f,{x:'2'}));
});
