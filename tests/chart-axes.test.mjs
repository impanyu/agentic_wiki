import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';import {z} from 'zod';
// Charts may put a series in another unit on a right-hand axis.
globalThis.__chartZ=z;
const m=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile('const z=globalThis.__chartZ;\n'+readFileSync('app/components-registry/chart-contracts.ts','utf8').replace(/^import .*;$/gm,''),{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
const labels={line:'Line',bar:'Bar',data:'Data',download:'Download'};
test('right axis needs its unit and at least one left series',()=>{
 const chart={kind:'chart',xLabel:'Hour',unit:'°C',rightUnit:'m/s',series:[{key:'temp',label:'Temperature'},{key:'wind',label:'Wind speed',axis:'right'}],labels};
 assert.equal(m.chartSchema.parse(chart).series[1].axis,'right');
 assert.throws(()=>m.chartSchema.parse({...chart,rightUnit:undefined}),/rightUnit/);
 assert.throws(()=>m.chartSchema.parse({...chart,series:[{key:'wind',label:'Wind',axis:'right'}]}),/left axis/);
 const single={kind:'chart',xLabel:'Hour',unit:'°C',series:[{key:'temp',label:'Temperature'}],labels};
 assert.deepEqual(m.chartSchema.parse(single).series,[{key:'temp',label:'Temperature'}]);
 const data={rows:[{x:'00:00',values:{temp:18.2,wind:3.1},sources:[1]}],sources:[{title:'Station',url:'https://example.org'}],notes:''};
 assert.equal(m.validateChartData(m.chartSchema.parse(chart),data).rows.length,1);
});
