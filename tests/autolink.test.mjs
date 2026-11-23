import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';import ts from 'typescript';
// Wikipedia-style links in running text: longest name first, first mention only, never the page itself, existing links kept.
const out=new URL('../node_modules/.cache/autolink-test/',import.meta.url);mkdirSync(out,{recursive:true});
let js=ts.transpileModule(readFileSync(new URL('../app/seo/autolink.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
js=js.replace(/import \{\s*entityPath\s*\}[^\n]*\n/,'const entityPath=()=>"";\n');writeFileSync(new URL('autolink.mjs',out),js);
const {linkParts}=await import(new URL('autolink.mjs',out));
test('mentions of entities with pages link once, longest name first',()=>{
 const names=new Map([['united states','/e/11/united-states'],['united kingdom','/e/12/united-kingdom'],['china','/e/10/china'],['beijing','/e/300/beijing']]);
 const r=linkParts([{text:'China trades with the United States and the United Kingdom; China and '},{text:'Beijing',href:'/x'},{text:' again.'}],names,3,'/e/300/beijing',new Set());
 assert.deepEqual(r.filter(p=>p.href).map(p=>[p.text,p.href]),[['China','/e/10/china'],['United States','/e/11/united-states'],['United Kingdom','/e/12/united-kingdom'],['Beijing','/x']]);
 assert.equal(r.map(p=>p.text).join(''),'China trades with the United States and the United Kingdom; China and Beijing again.','the text is unchanged');
 const self=linkParts([{text:'Beijing is the capital of China.'}],names,3,'/e/300/beijing',new Set());
 assert.deepEqual(self.filter(p=>p.href).map(p=>p.text),['China'],'the page never links to itself');
});
