import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';import ts from 'typescript';
// Content translation: a page model's own words are looked up per language; unseen texts are queued, translated ones
// are put in; links, keys, rows and numbers are left alone; the page is "complete" only when nothing waits.
const out=new URL('../node_modules/.cache/content-i18n-test/',import.meta.url);mkdirSync(out,{recursive:true});
writeFileSync(new URL('locales.mjs',out),`export const DEFAULT_LOCALE='en';export const LOCALES=[{code:'en',name:'English'},{code:'zh',name:'中文'}];`);
const files={client:'../app/entity-db/client.ts',schema:'../app/entity-db/schema.ts',reserved:'../app/entity-db/reserved.ts',content:'../app/i18n/content.ts'};
for(const [f,src] of Object.entries(files)){
 let js=ts.transpileModule(readFileSync(new URL(src,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 js=js.replace(/(from\s*|import\()\s*(['"])([^'"]+)\2/g,(m,pre,q,spec)=>spec==='./locales'?`${pre}'./locales.mjs'`:spec.startsWith('./')?`${pre}'${spec}.mjs'`:m);
 writeFileSync(new URL(f+'.mjs',out),js);
}
const client=await import(new URL('client.mjs',out));const c=await import(new URL('content.mjs',out));
const db=await client.createEntityDb({memory:true,embedDim:8});test.after(()=>db.close());
const model={title:'China',lead:'China is a country in East Asia.',href:'/e/10/china',cards:[{label:'Population',value:1411750000,href:'/x'}],
 sections:[{title:'All rankings',links:[{title:'Country Rankings',href:'/r',ranks:[{label:'GDP',text:'2nd of 12',href:'/r?rank=gdp'}]}]}],props:{rows:[{name:'India'}],criteria:[{key:'gdp',label:'GDP'}]}};

test('English pages are returned as they are',async()=>{const r=await c.localizeContent(db,model,'en');assert.equal(r.model,model);assert.equal(r.complete,true);});
test('unseen texts are queued; translated ones are put in; links, keys and rows are untouched',async()=>{
 const first=await c.localizeContent(db,model,'zh');assert.equal(first.complete,false);assert.equal(first.model.title,'China');
 const pending=(await db.query("select source from translations where lang='zh' and status='pending' order by source")).rows.map(r=>r.source);
 assert.ok(pending.includes('China is a country in East Asia.'));assert.ok(pending.includes('All rankings'));assert.ok(pending.includes('Population'));assert.ok(!pending.includes('GDP'),'acronyms stay');
 assert.ok(!pending.includes('India'),'ranking rows keep their names');assert.ok(!pending.some(s=>s.startsWith('/')),'links are not text');
 await db.query("update translations set status='done', text='中文:'||source where lang='zh'");
 const second=await c.localizeContent(db,model,'zh');assert.equal(second.complete,true);
 assert.equal(second.model.lead,'中文:China is a country in East Asia.');assert.equal(second.model.cards[0].label,'中文:Population');
 assert.equal(second.model.href,'/e/10/china');assert.equal(second.model.props.rows[0].name,'India');assert.equal(second.model.props.criteria[0].key,'gdp');assert.equal(second.model.cards[0].value,1411750000);
});
