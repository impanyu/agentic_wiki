import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
globalThis.chatMarkdownTest={React,Markdown,remarkGfm};
const source=readFileSync('app/chat/markdown.tsx','utf8').replace(/^import .*;$/gm,'');
const {ChatMarkdown}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile('const {React,Markdown,remarkGfm}=globalThis.chatMarkdownTest;\n'+source,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React})).toString('base64'));
test('chat formats bold lists and citations while rejecting active HTML and unsafe links',()=>{
 const html=renderToStaticMarkup(React.createElement(ChatMarkdown,{text:'简短回答：\n\n- **圣女果/番茄**：说明。\n- **另一项**：说明。 ([来源](https://example.com))\n\n<script>alert(1)</script>\n\n[unsafe](javascript:alert%281%29)'}));
 assert.match(html,/<ul>/);assert.match(html,/<li><strong>圣女果\/番茄<\/strong>/);assert.match(html,/href="https:\/\/example.com"/);assert.doesNotMatch(html,/<script|javascript:|\*\*圣女果/);
});
