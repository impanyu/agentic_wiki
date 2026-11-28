import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,writeFileSync,mkdirSync,mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createServer} from 'node:http';import {gzipSync} from 'node:zlib';import ts from 'typescript';
// Bulk loading (bulk_import): streaming CSV/JSONL (gzip, shards), admission rules (where, keepTop, ranking
// cut-offs "rank:N"), resumable runs, and trial runs. A local HTTP server stands in for the public dump.
const out=new URL('../node_modules/.cache/bulk-test/',import.meta.url);mkdirSync(out,{recursive:true});
writeFileSync(new URL('stub-fetch.mjs',out),`export const publicIPv4=()=>true;export function sourceUrl(s){try{return new URL(s);}catch{return null;}}`);
writeFileSync(new URL('stub-net.mjs',out),`export async function fetchText(u){const r=await fetch(u);return {url:r.url,type:r.headers.get('content-type')||'',text:await r.text()};}`);
const stubs={'@/app/url-content/fetch':'./stub-fetch.mjs','@/app/data-tools/net':'./stub-net.mjs','@/app/data-tools/stream':'./stream.mjs'};
const files={args:'../app/data-tools/args.ts',secrets:'../app/data-tools/secrets.ts',stream:'../app/data-tools/stream.ts',client:'../app/entity-db/client.ts',schema:'../app/entity-db/schema.ts',metrics:'../app/entity-db/metrics.ts',embeddings:'../app/entity-db/embeddings.ts',units:'../app/entity-db/units.ts',reserved:'../app/entity-db/reserved.ts',repo:'../app/entity-db/repo.ts',inherit:'../app/entity-db/inherit.ts',dedup:'../app/entity-db/dedup.ts',bulk:'../app/entity-db/bulk.ts'};
for(const [f,src] of Object.entries(files)){
 let js=ts.transpileModule(readFileSync(new URL(src,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 js=js.replace(/(from\s*|import\()\s*(['"])([^'"]+)\2/g,(m,pre,q,spec)=>stubs[spec]?`${pre}'${stubs[spec]}'`:spec.startsWith('./')?`${pre}'${spec}.mjs'`:m);
 writeFileSync(new URL(f+'.mjs',out),js);
}
process.env.DATA_DIR=mkdtempSync(join(tmpdir(),'bulk-'));
const client=await import(new URL('client.mjs',out));
const bulk=await import(new URL('bulk.mjs',out));
const db=await client.createEntityDb({memory:true,embedDim:16});client.setEntityDb(db);

// 3 shards of JSON Lines (gzip) = 300 papers with citations 0..299; one CSV with a quoted, multi-line field.
const papers=i=>({id:'W'+i,display_name:'Paper '+i,cited_by_count:i,meta:{year:2000+(i%20)}});
const shard=k=>gzipSync(Array.from({length:100},(_,j)=>JSON.stringify(papers(k*100+j))).join('\n')+'\n');
const csv='# comment\nname,mag,notes\n"Sirius",-1.46,"bright, ""dog star""\nsecond line"\nVega,0.03,x\nFaint,14.2,y\n';
const server=createServer((req,res)=>{
 const m=/^\/works\/part_(\d)\.jsonl\.gz$/.exec(req.url);
 if(m){res.writeHead(200,{'content-type':'application/gzip'});res.end(shard(Number(m[1])));return;}
 if(req.url==='/works/'){res.writeHead(200,{'content-type':'text/html'});res.end('<a href="part_0.jsonl.gz">0</a> <a href="part_1.jsonl.gz">1</a> <a href="part_2.jsonl.gz">2</a> <a href="readme.txt">r</a>');return;}
 if(req.url==='/stars.csv'){res.writeHead(200,{'content-type':'text/csv'});res.end(csv);return;}
 res.writeHead(404);res.end();
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
test.after(()=>{server.close();return db.close();});
const ctx={userId:'rankwiki-crawler',agent:{id:'crawler:test'}};
const paperSpec=(extra={})=>({urls:[],indexUrl:base+'/works/',indexPattern:'part_\\d\\.jsonl\\.gz$',format:'jsonl',fields:{id:'id',title:'display_name',cites:'cited_by_count',year:'meta.year'},
 where:{cites:{'>=':250}},mapping:{type:'paper',nameColumn:'title',idColumns:{openalex:'id'},metricColumns:{cites:{metric:'citations',unit:'',period:'2026'}},attributeColumns:['year']},source:'test works',...extra});
const count=async type=>Number((await db.query('select count(*)::int n from entities where type=$1',[type])).rows[0].n);

test('an admission rule is required',()=>{
 assert.throws(()=>bulk.checkSpec({...paperSpec(),where:{}}),/admission rule/);
 assert.equal(bulk.admits({a:'5'},{a:{'>=':5}}),true);assert.equal(bulk.admits({a:''},{a:{'>=':0}}),false);
 assert.equal(bulk.admits({t:'article'},{t:{in:['article','review']}}),true);assert.equal(bulk.admits({t:'x'},{t:'article'}),false);
});

test('shards from an index page are streamed; rows below the admission rule are never stored',async()=>{
 const r=await bulk.runBulk(db,paperSpec(),ctx,new AbortController().signal,{key:'papers',budgetMs:60_000,persist:true});
 assert.equal(r.files,3);assert.equal(r.scanned,300);assert.equal(r.admitted,50);assert.equal(r.done,true);assert.equal(r.partial,false);
 assert.equal(await count('paper'),50);
 const e=(await db.query("select attributes, ids from entities where type='paper' and name='Paper 299'")).rows[0];
 assert.equal(e.ids.openalex,'W299');assert.equal(String(e.attributes.year),'2019');
});

test('a refresh tied to the ranking only admits rows that can still rank ("rank:N")',async()=>{
 // The 10th best stored paper has 290 citations: the cut-off admits ≥290 (scanning all, storing 10).
 const spec=paperSpec({where:{cites:{'>=':'rank:10 or 100'}}});
 const r=await bulk.runBulk(db,spec,ctx,new AbortController().signal,{key:'papers-refresh',budgetMs:60_000,persist:true});
 assert.equal(r.cutoffs['cites >='],290);assert.equal(r.admitted,10);
 // Before enough are ranked, the static floor applies.
 const r2=await bulk.resolveCutoffs(db,{x:{'>=':'rank:5000 or 100'}},{type:'paper',nameColumn:'title',metricColumns:{x:{metric:'citations'}}});
 assert.equal(r2.cutoffs['x >='],100);assert.deepEqual(r2.where,{x:{'>=':100}});
});

test('keepTop keeps the N best rows of the whole source',async()=>{
 const r=await bulk.runBulk(db,paperSpec({where:{},keepTop:{by:'cites',n:5},mapping:{...paperSpec().mapping,type:'top_paper'}}),ctx,new AbortController().signal,{key:'top',budgetMs:60_000,persist:true});
 assert.equal(r.loaded,5);const names=(await db.query("select name from entities where type='top_paper' order by name")).rows.map(x=>x.name);
 assert.deepEqual(names,['Paper 295','Paper 296','Paper 297','Paper 298','Paper 299']);
});

test('a run that spends its budget stops and the next run resumes where it left off',async()=>{
 const spec=paperSpec({where:{cites:{'>=':0}},mapping:{...paperSpec().mapping,type:'all_paper'}});
 const first=await bulk.runBulk(db,spec,ctx,new AbortController().signal,{key:'resume',budgetMs:-1,persist:true});
 assert.equal(first.partial,true);assert.equal(first.scanned,1);
 let r=first,runs=1;while(r.partial&&runs<1000){r=await bulk.runBulk(db,spec,ctx,new AbortController().signal,{key:'resume',budgetMs:-1,persist:true});runs++;}
 assert.equal(r.done,true);assert.equal(await count('all_paper'),300);
});

test('trial runs scan only maxRows and save no progress; CSV with comments and quoted newlines',async()=>{
 const t=await bulk.runBulk(db,paperSpec({where:{cites:{'>=':0}},maxRows:7,mapping:{...paperSpec().mapping,type:'trial_paper'}}),{userId:'u',agent:{id:'a'}},new AbortController().signal,{key:'trial',budgetMs:60_000,persist:false});
 assert.equal(t.scanned,7);assert.equal(t.partial,true);assert.equal(await count('trial_paper'),7);
 const s=await bulk.runBulk(db,{urls:[base+'/stars.csv'],format:'csv',commentPrefix:'#',where:{mag:{'<':6}},mapping:{type:'star',nameColumn:'name',metricColumns:{mag:{metric:'magnitude',unit:'',period:'2026'}},descriptionColumn:'notes'},source:'test stars'},ctx,new AbortController().signal,{key:'stars',budgetMs:60_000,persist:true});
 assert.equal(s.scanned,3);assert.equal(s.admitted,2);
 const sirius=(await db.query("select description from entities where type='star' and name='Sirius'")).rows[0];
 assert.equal(sirius.description,'bright, "dog star"\nsecond line');
});
