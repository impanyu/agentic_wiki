import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source=fs.readFileSync(new URL('../app/dynamic/execute.ts',import.meta.url),'utf8').replace("'./units'",JSON.stringify(new URL('../app/dynamic/units.ts',import.meta.url).href)).replace("'zod'",JSON.stringify(import.meta.resolve('zod')));
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const {executeConversion,runDestination,inputFromUrl}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
test('registered converter computes length, mass, volume and temperature',()=>{
 assert.ok(Math.abs(executeConversion({value:100,from:'km',to:'mi'}).value-62.1371192237334)<1e-10);
 assert.equal(executeConversion({value:1000,from:'g',to:'kg'}).value,1);
 assert.equal(executeConversion({value:1,from:'us_gal',to:'l'}).value,3.785411784);
 assert.equal(executeConversion({value:20,from:'c',to:'f'}).value,68);
 assert.equal(executeConversion({value:32,from:'f',to:'c'}).value,0);
 assert.equal(executeConversion({value:1e-13,from:'m',to:'m'}).value,1e-13);
});
test('rejects invalid input, incompatible dimensions and unknown executors',()=>{
 for(const input of [{value:Infinity,from:'km',to:'mi'},{value:1,from:'kg',to:'m'},{value:-1000,from:'c',to:'f'},{value:2,from:'usd',to:'eur'}])assert.throws(()=>executeConversion(input));
 assert.throws(()=>runDestination('arbitrary-code',{}));
});
test('restores exact conversion inputs from a page URL',()=>{
 assert.deepEqual(inputFromUrl(new URL('https://example.test/?page=a&value=20&from=c&to=f')),{value:20,from:'c',to:'f'});
 assert.equal(inputFromUrl(new URL('https://example.test/?page=a')),undefined);
 assert.throws(()=>inputFromUrl(new URL('https://example.test/?value=&from=c&to=f')));
});
