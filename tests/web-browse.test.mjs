import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';
// read_web_page lists a page's links (PDFs first) and never offers hidden or nofollow trap links.
globalThis.__browse={PDFDocument:{},sourceUrl:()=>null,fetchSource:async()=>{throw Error('offline');},sourceText:t=>t};
const m=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile('const {PDFDocument,sourceUrl,fetchSource,sourceText}=globalThis.__browse;\n'+readFileSync('app/url-content/browse.ts','utf8').replace(/^import .*;$/gm,''),{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
test('page links: absolute, deduplicated, PDFs first, traps removed',()=>{
 const html='<a href="#top">Top</a><a href="/about">About &amp; us</a><a href="https://arxiv.org/pdf/1706.03762">View PDF</a><a href="/about">dup</a><a rel="nofollow" href="/trap">t</a><a href="/IgnoreMe">x</a><a href="/h" style="display: none">h</a><a href="mailto:a@b.c">mail</a><a href=\'files/report.pdf\'>Full report</a>';
 const links=m.pageLinks(html,'https://example.org/papers/page.html');
 assert.deepEqual(links,[{text:'View PDF',url:'https://arxiv.org/pdf/1706.03762',pdf:true},{text:'Full report',url:'https://example.org/papers/files/report.pdf',pdf:true},{text:'About & us',url:'https://example.org/about',pdf:false}]);
});
