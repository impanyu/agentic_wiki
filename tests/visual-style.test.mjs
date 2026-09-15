import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';import {z} from 'zod';
globalThis.styleTestZ=z;
const load=async s=>import('data:text/javascript;base64,'+Buffer.from(ts.transpile(s.replace(/^import .*;$/gm,''),{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
const v=await load('const z=globalThis.styleTestZ;\n'+readFileSync('app/page-programs/custom-style.ts','utf8')+'\n'+readFileSync('app/page-programs/visual-style.ts','utf8'));
delete globalThis.styleTestZ;
test('explicit style wins; one connector supplies identity; multi-connector tools use purpose styling',()=>{
 assert.equal(v.resolveVisualTheme('creative','Browse ADMA datasets'),'creative');assert.equal(v.resolveVisualTheme('auto','浏览 ADMA 文件'),'adma');assert.equal(v.resolveVisualTheme(undefined,'Use GitHub issues'),'github');assert.equal(v.resolveVisualTheme('auto','Compare Slack and Notion'),'minimal');assert.equal(v.resolveVisualTheme(undefined,'Statistics','dashboard-v1'),'analytics');assert.deepEqual(v.pageVisualProps({kind:'static',title:'ADMA',labels:{}}),{});assert.equal(v.pageVisualProps({kind:'dynamic',title:'Chart',labels:{},dynamic:{visualTheme:'url(evil)'}})['data-app-theme'],'minimal');
});
test('every primary color supports white button text and normal-size links on its tinted surface',()=>{
 const luminance=hex=>{const c=hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2];};
 for(const [name,p] of Object.entries(v.themePalettes)){const dark=luminance(p.accent);assert.ok(1.05/(dark+.05)>=4.5,name+' white button contrast');assert.ok((luminance(p.tint)+.05)/(dark+.05)>=4.5,name+' tinted surface contrast');}
});
import {customDesign} from './fixtures/custom-style.mjs';
test('custom designs retain authored styling and readable foregrounds on dark and mixed surfaces',()=>{
 for(const design of [customDesign,{...customDesign,canvas:'#ffffff',tint:'#fafafa',text:'#999999',muted:'#999999'}]){
  const props=v.pageVisualProps({kind:'dynamic',title:'Observatory',labels:{},dynamic:{visualTheme:'custom',visualDesign:design}}),s=props.style;
  assert.equal(props['data-app-theme'],'custom');assert.equal(props['data-app-cards'],'stack');assert.equal(s['--app-width'],'1200px');assert.equal(s['--app-accent'],design.accent);
  for(const [fg,bg] of [['--app-on-accent','--app-accent'],['--app-canvas-ink','--app-canvas'],['--app-text','--app-surface'],['--app-tint-ink','--app-tint'],['--app-muted','--app-surface']])assert.ok(v.contrast(s[fg],s[bg])>=4.5,fg);
 }
});
test('untrusted CSS values are rejected and invalid saved designs fall back without crashing',()=>{
 assert.throws(()=>v.normalizeCustomStyle({...customDesign,accent:'url(https://example.com)'}));assert.throws(()=>v.normalizeCustomStyle({...customDesign,width:999999}));
 assert.equal(v.pageVisualProps({kind:'dynamic',title:'App',labels:{},dynamic:{visualTheme:'custom',visualDesign:{}}})['data-app-theme'],'minimal');
});
