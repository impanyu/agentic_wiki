import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';
const m=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile(readFileSync('app/workflows/viz/echart-sanitize.ts','utf8'),{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));

test('drops graphic, custom series and unsafe strings; strips formatter tags',()=>{
 const o=m.sanitizeEChartOption({
  graphic:[{type:'image',style:{image:'https://evil'}}],
  title:{text:'ok',link:'javascript:alert(1)'},
  backgroundColor:{image:'url(https://evil/x.png)'},
  series:[{type:'custom',renderItem:'x'},{type:'pictorialBar',symbol:'image://https://evil/x.png',data:[1,2]}],
  tooltip:{formatter:'<img src=x onerror=alert(1)><b>{b}</b>: {c}'},
  __proto__x:1,
 });
 assert.equal('graphic' in o,false);
 assert.equal(o.title.link,undefined);assert.equal(o.title.text,'ok');
 assert.deepEqual(o.backgroundColor,{});
 assert.equal(o.series.length,1);assert.equal(o.series[0].type,'pictorialBar');assert.equal('symbol' in o.series[0],false);
 assert.equal(o.tooltip.formatter,'{b}: {c}');assert.equal(o.tooltip.confine,true);assert.equal(o.tooltip.renderMode,'html');
});

test('toolbox keeps only safe features and forces dataView readOnly',()=>{
 const o=m.sanitizeEChartOption({toolbox:{feature:{saveAsImage:{},dataView:{readOnly:false},brush:{},myTool:{onclick:'x'}}}});
 assert.deepEqual(Object.keys(o.toolbox.feature).sort(),['dataView','saveAsImage']);
 assert.equal(o.toolbox.feature.dataView.readOnly,true);
});

test('caps total data points across series',()=>{
 const big=Array.from({length:150_000},(_,i)=>i);
 const o=m.sanitizeEChartOption({series:[{type:'line',data:big},{type:'line',data:big},{type:'line',data:[1]}]});
 assert.equal(o.series[0].data.length,150_000);assert.equal(o.series[1].data.length,50_000);assert.equal(o.series[2].data.length,0);
});

test('non-object input becomes a safe empty option; input is not mutated',()=>{
 assert.deepEqual(m.sanitizeEChartOption(null),{tooltip:{renderMode:'html',confine:true}});
 const input={series:[{type:'bar',data:[1]}]};m.sanitizeEChartOption(input);assert.deepEqual(input,{series:[{type:'bar',data:[1]}]});
});

test('defaults fill only unset keys',()=>{
 const cart=m.withEChartDefaults(m.sanitizeEChartOption({xAxis:{type:'category'},yAxis:{},series:[{type:'bar',data:[1]},{type:'line',data:[2]}]}));
 assert.equal(cart.tooltip.trigger,'axis');assert.deepEqual(cart.legend,{});assert.equal(cart.grid.top,48);assert.equal(cart.aria.enabled,true);
 assert.equal(cart.series[0].universalTransition,true);
 const pie=m.withEChartDefaults(m.sanitizeEChartOption({tooltip:{trigger:'none'},aria:{enabled:false},series:[{type:'pie',data:[{name:'a',value:1}]}]}));
 assert.equal(pie.tooltip.trigger,'none');assert.equal(pie.aria.enabled,false);assert.deepEqual(pie.legend,{});assert.equal('grid' in pie,false);
 assert.equal(m.needsEChartsGL({series:[{type:'scatter3D'}]}),true);assert.equal(m.needsEChartsGL({globe:{}}),true);assert.equal(m.needsEChartsGL({series:[{type:'bar'}]}),false);
});
