import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';
const strip=p=>readFileSync(p,'utf8').replace(/^import .*;$/gm,'').replace(/^'use client';$/m,'');
const load=async s=>import('data:text/javascript;base64,'+Buffer.from(ts.transpile(s,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React})).toString('base64'));
const React=await import('react'),{renderToStaticMarkup}=await import('react-dom/server');
const catalog=await load(strip('app/adma/processing-catalog.ts'));
const Icon=()=>null;
globalThis.toolPageDeps={React,useEffect:()=>{},useRef:value=>({current:value}),Sprout:Icon,ArrowLeftRight:Icon,TrendingUp:Icon,BarChart3:Icon,Filter:Icon,ArrowLeft:Icon,ExternalLink:Icon,FolderSearch:Icon,HardDriveUpload:Icon,ResourcePicker:()=>null,useUi:()=>({locale:'en',t:text=>text}),toolHref:()=>'#',...catalog};
const info=await load('const {Sprout,ArrowLeftRight,TrendingUp,BarChart3,Filter}=globalThis.toolPageDeps;\n'+strip('app/adma/tool-info.ts'));
Object.assign(globalThis.toolPageDeps,info);
// A shared state stub: identical data-URL modules are cached, so the stub is
// installed once and each render swaps in its own seeded state array.
const holder={state:[]};
globalThis.toolPageDeps.useState=initial=>{const value=holder.state.shift();return [value===undefined?initial:value,()=>{}];};
const panel=await load('const {React,useEffect,useState,useRef,ArrowLeft,ExternalLink,FolderSearch,HardDriveUpload,processingCatalog,processingRunName,toolInfo,siFieldState,ResourcePicker,useUi,toolHref}=globalThis.toolPageDeps;\n'+strip('app/adma/processing-panel.tsx'));
async function render(state,slug,writable=true){
 holder.state=[...state];
 return renderToStaticMarkup(React.createElement(panel.ProcessingPanel,{pageId:'page',writable,initialTool:slug}));
}
const account={id:'c1',name:'ADMA',allowed:['list_files','list_folders','run_si_tool','processing_status']};
const files=[{id:'11111111-1111-4111-8111-111111111111',name:'sectors.shp',is_public:false},{id:'22222222-2222-4222-8222-222222222222',name:'plots.csv',is_public:false},{id:'33333333-3333-4333-8333-333333333333',name:'nir.tif',is_public:false}];
// State order in ToolWorkbench: accounts, account, values, files, folders, pageFiles, custom, picker, busy, error, task, result.
const seed=values=>[[account],'c1',values,files,[{id:'44444444-4444-4444-8444-444444444444',name:'outputs',is_public:false}],[{id:'55555555-5555-4555-8555-555555555555',name:'upload.csv'}],{},'',false,'','',null];
test('each catalog tool renders its own dedicated page with banner, steps and file selectors',async()=>{
 for(const spec of catalog.processingCatalog){
  const html=await render(seed({}),spec.slug);
  const meta=info.toolInfo[spec.slug];
  assert.ok(html.includes(spec.name));assert.ok(html.includes(meta.subtitle));assert.ok(html.includes(meta.runLabel));
  for(const [term] of meta.outputs)assert.ok(html.includes(term),spec.slug+' lists output '+term);
  assert.ok(html.includes('step-badge'),spec.slug+' shows numbered steps');
  assert.ok(html.includes('Browse Google Drive, Dropbox, OneDrive')&&html.includes('Upload from my computer…')&&html.includes('Other sources'),spec.slug+' offers cross-repository selection in the file menu');
 }
});
test('the tool directory shows one card per tool instead of a shared form',async()=>{
 const html=await render([],'');
 for(const spec of catalog.processingCatalog)assert.ok(html.includes('tool='+spec.slug),'card links to '+spec.slug);
 assert.ok(!html.includes('tool-run'));
});
test('file selectors list only matching private ADMA files and folders default to auto-create',async()=>{
 const html=await render(seed({workflow:'standard_uav'}),'si-tool');
 // Buffer sector select offers .shp files only; the CSV select offers the CSV.
 assert.ok(html.includes('sectors.shp'));assert.ok(html.includes('plots.csv'));
 assert.ok(html.includes('Auto-create output folder (default)'));
 assert.ok(html.includes('Choose a file from any source…'));
 assert.ok(html.includes('My ADMA files')&&html.includes('upload.csv'),'menu lists ADMA and page files');
});
test('read-only catalog pages keep the file menus usable and disable only Run',async()=>{
 const html=await render(seed({}),'yield-summary',false);
 assert.ok(!html.includes('<fieldset disabled'),'form stays enabled on shared pages');
 assert.ok(/class="tool-run" disabled/.test(html),'Run requires a private fork');
 assert.ok(html.includes('Choose a file from any source…')&&html.includes('Other sources'));
});
test('SI workflows show and require only their own inputs',async()=>{
 const uav=await render(seed({workflow:'standard_uav'}),'si-tool');
 assert.ok(uav.includes('NDRE shapefile'));assert.ok(!uav.includes('NIR raster'));assert.ok(uav.includes('Field column'));assert.ok(!uav.includes('Indicator blocks'));
 const sbf=await render(seed({workflow:'sbf_satellite'}),'si-tool');
 assert.ok(!sbf.includes('NDRE shapefile'));assert.ok(sbf.includes('NIR raster'));assert.ok(sbf.includes('Red-edge raster'));assert.ok(sbf.includes('Indicator blocks'));assert.ok(!sbf.includes('Field column'));
 assert.ok(sbf.includes('Treatment methodology')&&sbf.includes('Imagery type'));
});
