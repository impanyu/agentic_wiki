import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';import {mkdirSync,writeFileSync} from 'node:fs';import {pathToFileURL} from 'node:url';
// Tolerant tool arguments (args.ts) and SQL over datasets (sql-query.ts).
const load=async f=>import('data:text/javascript;base64,'+Buffer.from(ts.transpile(readFileSync(f,'utf8'),{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
const a=await load('app/data-tools/args.ts');
test('empty spellings and quoted JSON in arguments',()=>{
 const n=a.normalizeArgs({select:'""',nextPage:'null',headers:'"{}"','expression"':'x[y]',pages:'1',q:'"exact phrase"'});
 assert.deepEqual(n,{select:'',nextPage:'',headers:'{}',expression:'x[y]',pages:'1',q:'"exact phrase"'});
});
test('near-JSON is read as meant',()=>{
 assert.deepEqual(a.looseJson('```json\n{"a":1,}\n```'),{a:1});
 assert.deepEqual(a.looseJson("{'region': 'Asia'}"),{region:'Asia'});
 assert.deepEqual(a.looseJson('{region: "Asia", ok: True, x: None}'),{region:'Asia',ok:true,x:null});
 assert.deepEqual(a.looseJson('[{"q":"SELECT ?x\nWHERE {}"}]'),[{q:'SELECT ?x\nWHERE {}'}]);
 assert.deepEqual(a.looseJson('{\\"pop\\":\\"ds_1\\"}'),{pop:'ds_1'});
 assert.deepEqual(a.looseJson('"{\\"a\\":1}"'),{a:1});
 assert.equal(a.looseJson('""'),undefined);
 assert.throws(()=>a.looseJson('{nope'));
});
// Written inside the repository so the module resolves @electric-sql/pglite from node_modules.
mkdirSync('node_modules/.cache/tool-args-test',{recursive:true});
writeFileSync('node_modules/.cache/tool-args-test/sql-query.mjs',ts.transpile(readFileSync('app/data-tools/sql-query.ts','utf8'),{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}));
const s=await import(pathToFileURL('node_modules/.cache/tool-args-test/sql-query.mjs').href);
test('SQL over datasets: join, quoted columns, read only',async()=>{
 assert.equal(s.looksLikeSql('  WITH x AS (select 1) select * from x'),true);
 assert.equal(s.looksLikeSql('pop[value>0]'),false);
 const rows=await s.sqlQuery('SELECT p.name, g.value / p.population AS per_cap FROM pop p JOIN gdp g ON g.iso3 = p.iso3 WHERE "Pop Rank" < 3 ORDER BY per_cap DESC',{
  pop:{columns:['name','iso3','population','Pop Rank'],rows:[{name:'A',iso3:'AAA',population:10,'Pop Rank':1},{name:'B',iso3:'BBB',population:5,'Pop Rank':2},{name:'C',iso3:'CCC',population:'7','Pop Rank':3}]},
  gdp:{columns:['iso3','value'],rows:[{iso3:'AAA',value:100},{iso3:'BBB',value:100}]}});
 assert.deepEqual(rows,[{name:'B',per_cap:20},{name:'A',per_cap:10}]);
 await assert.rejects(()=>s.sqlQuery('SELECT 1; DROP TABLE pop',{pop:{columns:['a'],rows:[]}}),/One SQL statement/);
 await assert.rejects(()=>s.sqlQuery('SELECT nope FROM pop',{pop:{columns:['a'],rows:[{a:1}]}}),/SQL error/);
});
