import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
const {pageLink,pageLinkQuestion}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile(readFileSync('app/chat/page-link.ts','utf8'),{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
globalThis.chatMarkdownTest={React,Markdown,remarkGfm,pageLinkQuestion};
const source=readFileSync('app/chat/markdown.tsx','utf8').replace(/^import .*;$/gm,'');
const {ChatMarkdown}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile('const {React,Markdown,remarkGfm,pageLinkQuestion}=globalThis.chatMarkdownTest;\n'+source,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React})).toString('base64'));
test('chat formats bold lists and citations while rejecting active HTML and unsafe links',()=>{
 const html=renderToStaticMarkup(React.createElement(ChatMarkdown,{text:'简短回答：\n\n- **圣女果/番茄**：说明。\n- **另一项**：说明。 ([来源](https://example.com))\n\n<script>alert(1)</script>\n\n[unsafe](javascript:alert%281%29)'}));
 assert.match(html,/<ul>/);assert.match(html,/<li><strong>圣女果\/番茄<\/strong>/);assert.match(html,/href="https:\/\/example.com"/);assert.doesNotMatch(html,/<script|javascript:|\*\*圣女果/);
});

test('chat page offers render as internal buttons with safe encoded questions',()=>{
 const link=pageLink('Compare (ADMA) and Drive','Open comparison');assert.equal(pageLinkQuestion(link.href),'Compare (ADMA) and Drive');assert.equal(pageLinkQuestion('https://evil.test/?ask=question'),null);assert.equal(pageLinkQuestion('//evil.test/?ask=question'),null);
 const html=renderToStaticMarkup(React.createElement(ChatMarkdown,{text:link.markdown}));assert.match(html,/class="chat-page-link"/);assert.match(html,/href="\/\?ask=/);assert.doesNotMatch(html,/target="_blank"/);assert.match(link.note,/No page has been generated/);
});
