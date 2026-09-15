import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';
const catalog=JSON.parse(readFileSync('app/i18n/catalog.json')),zh=JSON.parse(readFileSync('app/i18n/zh-pairs.json'));
const js=ts.transpile(readFileSync('app/i18n/translate.ts','utf8'),{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022});
const {translateUi}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
test('page language translates access options and placeholders while preserving page titles and URLs',()=>{
 assert.equal(translateUi('Private',catalog,zh),'私密');assert.equal(translateUi('Public read only',catalog,zh),'公开只读');assert.equal(translateUi('Public read & write',catalog,zh),'公开读写');
 assert.equal(translateUi('Private',catalog,{}),'Private');
 assert.equal(translateUi('Private',catalog,{Private:'Privé'}),'Privé');
 assert.equal(translateUi('Saved {date} · {count} questions linked',catalog,zh,{date:'2026/9/15',count:2}),'保存于 2026/9/15 · 已关联 2 个问题');
 for(const text of ['https://example.org/article','Gemini 3.5 Flash','public-read'])assert.equal(translateUi(text,catalog,zh),text);
});
test('share control uses translated captions while keeping permission values unchanged',async()=>{
 const React=await import('react'),{renderToStaticMarkup}=await import('react-dom/server');
 globalThis.uiShareTest={React,useRef:React.useRef,useEffect:React.useEffect,useState:value=>[typeof value==='boolean'?true:value,()=>{}],useUi:()=>({locale:'zh-Hans',t:text=>translateUi(text,catalog,zh)}),Copy:()=>null,Share2:()=>null,pageAccess:()=> 'private'};
 const code=readFileSync('app/page-share.tsx','utf8').replace(/^import .*;$/gm,'');
 const source=ts.transpile('const {React,useRef,useEffect,useState,useUi,Copy,Share2,pageAccess}=globalThis.uiShareTest;\n'+readFileSync('app/use-dismiss-floating.ts','utf8').replace(/^import .*;$/gm,'')+'\n'+code,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React});
 const {PageShare}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 const html=renderToStaticMarkup(React.createElement(PageShare,{page:{id:'page',language:'zh-Hans',owned:true},disabled:false,onAccess:async()=>true}));
 assert.ok(html.includes('分享'));assert.ok(html.includes('公开只读')||html.includes('公开 只读'));assert.ok(!html.includes('Public'));
 assert.ok(code.includes("share('public-read')"));assert.ok(code.includes("share('public-write')"));
});
