import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';import {z} from 'zod';
const load=s=>import('data:text/javascript;base64,'+Buffer.from(ts.transpile(s,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
const {extractSourceMedia,publicMediaUrl,videoEmbedUrl}=await load(readFileSync('app/url-content/media.ts','utf8'));
test('extracts real source figures, lazy images and video with resolved URLs, skipping decoration and unsafe embeds',()=>{
 const items=extractSourceMedia(`<script>"<img src='/fake.png'>"</script><img src='/pixel' width='1'><figure><img data-src='/plot.png?a=1&amp;b=2' alt='Experiment'><figcaption>Measured accuracy</figcaption></figure><video poster='/cover.jpg'><source src='/demo.mp4'></video><iframe src='https://www.youtube.com/embed/abcdefghijk'></iframe><iframe src='https://evil.org/player'></iframe><img src='http://localhost/private'><img src='/plot.png?a=1&amp;b=2'>`,'https://example.org/article');
 assert.equal(items.length,3);assert.equal(items[0].url,'https://example.org/plot.png?a=1&b=2');assert.ok(items[0].description.includes('Measured accuracy'));
 assert.equal(items[1].kind,'video');assert.equal(items[1].poster,'https://example.org/cover.jpg');assert.equal(items[2].url,'https://www.youtube-nocookie.com/embed/abcdefghijk');
 assert.ok(items.every(m=>m.source==='https://example.org/article'));
 for(const url of ['javascript:alert(1)','https://127.0.0.1/a','https://user:pw@example.org/a','https://a.internal/a'])assert.equal(publicMediaUrl(url),null);
 assert.equal(videoEmbedUrl('https://youtube.com.evil.org/embed/abcdefghijk'),null);
});
test('generator may omit media; selected IDs are deduplicated and never replaced by invented URLs',async()=>{
 const candidates=extractSourceMedia('<img src="/chart.png" alt="Measured values">','https://example.org/article');let selection={items:[]};
 globalThis.sourceSelection={z,api:async()=>selection,output:r=>JSON.stringify(r),model:()=> 'test'};
 const code=readFileSync('app/url-content/select-media.ts','utf8').replace(/^import .*;$/gm,'');
 const {selectSourceMedia}=await load('const {z,api,output,model}=globalThis.sourceSelection;\n'+code);
 assert.deepEqual(await selectSourceMedia({media:candidates},'Article','en'),[]);
 selection={items:[{id:candidates[0].id,caption:'Measured values'},{id:candidates[0].id,caption:'Duplicate'},{id:'invented',caption:'Fake'}]};
 const selected=await selectSourceMedia({media:candidates},'Article','en');assert.equal(selected.length,1);assert.equal(selected[0].url,candidates[0].url);assert.equal(selected[0].caption,'Measured values');
});
test('media view renders controlled video and attribution, deferring embedded players until clicked',async()=>{
 const React=await import('react');const {renderToStaticMarkup}=await import('react-dom/server');
 globalThis.mediaRender={useUi:()=>({t:s=>s,locale:"en"}),React,useState:React.useState,publicMediaUrl,videoEmbedUrl};
 const source=readFileSync('app/url-content/media-view.tsx','utf8').replace(/^import .*;$/gm,'');
 const js=ts.transpile('const {useUi,React,useState,publicMediaUrl,videoEmbedUrl}=globalThis.mediaRender;\n'+source,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React});
 const {SourceMediaView}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
 const media=extractSourceMedia('<video src="/demo.mp4"></video><iframe src="https://www.youtube.com/embed/abcdefghijk"></iframe>','https://example.org/article');
 const html=renderToStaticMarkup(React.createElement(SourceMediaView,{media}));assert.ok(html.includes('<video controls="" preload="none"'));assert.ok(html.includes('https://example.org/article'));assert.ok(html.includes('<button'));assert.ok(!html.includes('<iframe'));assert.ok(!html.includes('autoplay'));
});
