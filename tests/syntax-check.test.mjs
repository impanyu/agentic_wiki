import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';import {Script} from 'node:vm';
globalThis.syntaxDeps={Script};
const src=readFileSync('app/sandboxes/syntax-check.ts','utf8').replace(/^import .*;$/gm,'');
const m=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile('const {Script}=globalThis.syntaxDeps;\n'+src,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));

test('a program one closing brace short is located, not just "Unexpected end of input"',()=>{
 const code="export async function main({input,results}){\n  const x={a:1};\n  if(x){\n    return {view:{title:`t ${x.a}`}};\n  }\n";
 const d=m.javascriptSyntaxDiagnosis(code);
 assert.match(d,/ends at line 5 before every block is closed/);
 assert.match(d,/'\{' opened at line 1 is never closed/);
});
test('valid programs, strings with brackets, template expressions and imports pass',()=>{
 assert.equal(m.javascriptSyntaxDiagnosis("export async function main(){\n  const s='a}{';// }}\n  return {view:{t:`a${'{'}b`}};\n}\n"),null);
 assert.equal(m.javascriptSyntaxDiagnosis("import fs from 'node:fs';\nexport async function main(){ return 1; }"),null);
 assert.equal(m.javascriptSyntaxDiagnosis("export async function main(){ const r=await Promise.resolve(1); return {view:{r}}; }"),null);
});
test('a mismatched bracket names the line and the opener',()=>{
 const d=m.javascriptSyntaxDiagnosis("export async function main(){\n  const a=[1,2);\n}");
 assert.match(d,/at line 2 of 3/);assert.match(d,/'\)' at line 2 closes '\[' opened at line 2/);
});
