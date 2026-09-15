import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';import {z} from 'zod';
const load=code=>import('data:text/javascript;base64,'+Buffer.from(ts.transpile(code,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
const media=await load(readFileSync('app/url-content/media.ts','utf8'));globalThis.richTest={z,...media};
const {validateDocument,documentMarkdown}=await load('const {z,publicMediaUrl,videoEmbedUrl}=globalThis.richTest;\n'+readFileSync('app/page-editor/document.ts','utf8').replace(/^import .*;$/gm,''));
test('rich document preserves formatting and internal/external links, rejects active URLs and strips event attributes',()=>{
 const doc=validateDocument({type:'doc',content:[{type:'heading',attrs:{level:2,onclick:'evil'},content:[{type:'text',text:'Heading'}]},{type:'paragraph',content:[{type:'text',text:'Wiki',marks:[{type:'bold'},{type:'link',attrs:{href:'/?page=11111111-1111-4111-8111-111111111111'}}]},{type:'text',text:'Source',marks:[{type:'link',attrs:{href:'https://example.org'}}]}]},{type:'image',attrs:{src:'https://example.org/image.png',onerror:'evil',alt:'Plot'}}]});
 const markdown=documentMarkdown(doc);assert.ok(markdown.includes('## Heading'));assert.ok(markdown.includes('[**Wiki**](/?page='));assert.ok(markdown.includes('https://example.org/'));assert.ok(!JSON.stringify(doc).includes('evil'));
 for(const src of ['javascript:alert(1)','data:text/html,bad','https://127.0.0.1/x'])assert.throws(()=>validateDocument({type:'doc',content:[{type:'image',attrs:{src}}]}));
 assert.throws(()=>validateDocument({type:'doc',content:[{type:'video',attrs:{src:'https://evil.org/embed',embed:true}}]}));
});
test('folder trees retain nested and empty folders without filesystem traversal',async()=>{
 const {buildFileTree,folderPath,fileName}=await load(readFileSync('app/context-files/tree.ts','utf8'));
 const tree=buildFileTree([{name:'plot.png',folderPath:'Research/Images'},{name:'notes.txt',folderPath:''}],['Empty']);
 assert.equal(tree.files[0].name,'notes.txt');assert.equal(tree.folders.find(f=>f.name==='Research').folders[0].files[0].name,'plot.png');assert.ok(tree.folders.some(f=>f.name==='Empty'));
 for(const path of ['../secret','a/../b','a\\b'])assert.throws(()=>folderPath(path));assert.equal(folderPath('/Research/Images/'),'Research/Images');assert.throws(()=>fileName('../x'));
});
