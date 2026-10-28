import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

const m=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile(readFileSync('app/workflows/viz/colormap.ts','utf8'),{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
const hex=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255);
const close=(a,b)=>a.forEach((v,i)=>assert.ok(Math.abs(v-b[i])<1e-9,`${a} vs ${b}`));

test('endpoints match the published colormaps',()=>{
  close(m.colormap('viridis',0),hex('#440154'));close(m.colormap('viridis',1),hex('#fde725'));
  close(m.colormap('plasma',0),hex('#0d0887'));close(m.colormap('plasma',1),hex('#f0f921'));
  close(m.colormap('turbo',0),hex('#30123b'));close(m.colormap('turbo',1),hex('#7a0402'));
  close(m.colormap('terrain',0),hex('#333399'));close(m.colormap('terrain',1),hex('#ffffff'));
});
test('clamps out-of-range and non-finite input',()=>{
  close(m.colormap('viridis',-5),m.colormap('viridis',0));
  close(m.colormap('viridis',7),m.colormap('viridis',1));
  close(m.colormap('turbo',NaN),m.colormap('turbo',0));
});
test('interpolates between stops and stays in 0..1',()=>{
  close(m.colormap('terrain',0.5),hex('#ffff99'));
  const mid=m.colormap('viridis',0.0625),a=hex('#440154'),b=hex('#482878');
  close(mid,a.map((v,i)=>(v+b[i])/2));
  for(const name of m.COLORMAPS)for(let t=0;t<=1;t+=0.01)for(const c of m.colormap(name,t))assert.ok(c>=0&&c<=1);
});
test('unknown names fall back to viridis',()=>{close(m.colormap('nope',0.3),m.colormap('viridis',0.3));});
test('gradient helper emits CSS',()=>{assert.match(m.colormapGradient('plasma'),/^linear-gradient\(to top,rgb\(13,8,135\) 0\.0%/);});
