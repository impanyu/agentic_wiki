import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import ts from 'typescript';
const out=new URL('../node_modules/.cache/chart-theme-test/',import.meta.url);mkdirSync(out,{recursive:true});
writeFileSync(new URL('chart-theme.mjs',out),ts.transpileModule(readFileSync('app/workflows/viz/chart-theme.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
const {themeOption}=await import(new URL('chart-theme.mjs',out));

test('dark chart theme: neutrals and surfaces change, accents and white text stay, the map ramp brightens, tooltips are recoloured',()=>{
 const light={tooltip:{backgroundColor:'#fff',formatter:()=>'<div style="color:#0f172a">x</div>'},
  xAxis:{axisLabel:{color:'#94a3b8'},splitLine:{lineStyle:{color:'#eef1f6'}}},
  visualMap:[{inRange:{color:['#e8efff','#b9cdff','#7d9dff','#4f7cff','#2f4fd6','#1e2f86']}}],
  series:[{itemStyle:{color:'#4f7cff',borderColor:'#fff'},label:{color:'#fff'},data:[1,2,3]}]};
 const d=themeOption(light,true);
 assert.equal(d.tooltip.backgroundColor,'#111114');
 assert.match(d.tooltip.formatter(),/color:#f2f2f4/);
 assert.equal(d.xAxis.axisLabel.color,'#6f6f7a');
 assert.equal(d.series[0].itemStyle.color,'#4f7cff','accent kept');
 assert.equal(d.series[0].itemStyle.borderColor,'#111114','white border becomes the surface');
 assert.equal(d.series[0].label.color,'#fff','white text stays');
 assert.equal(d.visualMap[0].inRange.color[5],'#d6e3ff','high values are bright on dark');
 assert.equal(themeOption(light,false),light,'light is untouched');
 assert.equal(light.xAxis.axisLabel.color,'#94a3b8','the input is not mutated');
});
