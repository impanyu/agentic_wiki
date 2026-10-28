import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';import {DatabaseSync} from 'node:sqlite';
const m=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile(readFileSync('app/edition.ts','utf8'),{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
test('the wiki edition shows wiki pages and built-in tools, and hides generated apps, in TS and SQL alike',()=>{
 const pages=[
  ['article',{kind:'static',question:'photosynthesis'},true],
  ['map tool',{kind:'dynamic',question:'map',dynamic:{template:'native-app-v1',nativeApp:'map'}},true],
  ['drive browser',{kind:'dynamic',question:'list my google drive',dynamic:{template:'file-browser-v1'}},true],
  ['adma browser',{kind:'dynamic',question:'list my ADMA files',dynamic:{template:'file-browser-v1'}},false],
  ['adma tools',{kind:'dynamic',question:'tools',dynamic:{template:'native-app-v1',nativeApp:'adma-tools'}},false],
  ['hcc',{kind:'dynamic',question:'jobs',dynamic:{template:'native-app-v1',nativeApp:'unl-hcc'}},false],
  ['wiki with app',{kind:'dynamic',question:'topic',dynamic:{template:'workflow-app-v1',workflow:{ui:[{type:'article'},{type:'chart'}]}}},true],
  ['workflow app',{kind:'dynamic',question:'expense tracker',dynamic:{template:'workflow-app-v1',workflow:{ui:[{type:'form'}]}}},false],
  ['program',{kind:'dynamic',question:'calc',dynamic:{template:'page-program-v1'}},false],
  ['chart page',{kind:'dynamic',question:'plot',dynamic:{template:'component-chart-v1'}},false],
 ];
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE pages(id TEXT,kind TEXT,question TEXT,dynamic_config TEXT)');
 for(const [id,p] of pages)db.prepare('INSERT INTO pages VALUES(?,?,?,?)').run(id,p.kind,p.question,p.dynamic?JSON.stringify(p.dynamic):null);
 const shown=new Set(db.prepare('SELECT id FROM pages p WHERE '+m.editionPageSql('p')).all().map(r=>r.id));
 for(const [id,p,expected] of pages){assert.equal(m.editionShowsPage(p),expected,id+' (TS)');assert.equal(shown.has(id),expected,id+' (SQL)');}
});
