import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';import {z} from 'zod';import {isIP} from 'node:net';import {EventEmitter} from 'node:events';
const strip=p=>readFileSync(p,'utf8').replace(/^import .*;$/gm,'');
const load=s=>import('data:text/javascript;base64,'+Buffer.from(ts.transpile(s,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
globalThis.urlTestNet={isIP};
const parsing=await load('const {isIP}=globalThis.urlTestNet;\n'+strip('app/url-content/fetch.ts'));
test('URL recognition rejects local, credentialed and unsupported addresses; extraction uses body text',()=>{
 assert.equal(parsing.sourceUrl('photosynthesis'),null);
 assert.equal(parsing.sourceUrl('www.example.org/article').href,'https://www.example.org/article');
 assert.equal(parsing.sourceUrl('https://example.org/a#section').href,'https://example.org/a');
 for(const url of ['http://localhost/a','http://127.1','http://169.254.169.254/','http://10.0.0.1','http://user:pass@example.org','file:///etc/passwd','https://example.org:9000'])assert.throws(()=>parsing.sourceUrl(url));
 assert.equal(parsing.publicIPv4('8.8.8.8'),true);assert.equal(parsing.publicIPv4('100.64.0.1'),false);
 assert.equal(parsing.sourceText('<script>bad()</script><nav>Menu</nav><main>A &amp; B &#x4e2d;</main>'),'A & B 中');
});
test('fetch pins validated DNS and validates every redirect before opening another socket',async()=>{
 let sockets=0,target;
 const request=(url,options,callback)=>{sockets++;target=url.href;options.lookup(url.hostname,{},(err,address,family)=>{assert.equal(address,'8.8.8.8');assert.equal(family,4);});
  const req=new EventEmitter();req.end=()=>{const res=new EventEmitter();res.statusCode=302;res.headers={location:'http://169.254.169.254/latest'};res.destroy=()=>{};callback(res);};return req;
 };
 globalThis.urlFetchNet={isIP,lookup:async()=>[{address:'8.8.8.8',family:4}],httpRequest:request,httpsRequest:request};
 const m=await load('const {'+Object.keys(globalThis.urlFetchNet).join(',')+'}=globalThis.urlFetchNet;\n'+strip('app/url-content/fetch.ts'));
 await assert.rejects(m.fetchSource(new URL('https://example.org/article'),new AbortController().signal),/URL_PRIVATE/);
 assert.equal(sockets,1);assert.equal(target,'https://example.org/article');
});
test('URL navigation embeds the fetched content summary, never the URL, and does not fall back on failures',async()=>{
 let readable=true,embedded=[],summarizerInput,failed=false;
 const summary='This document explains significant permission identification for Android malware detection, including the original research publication, feature selection methods, experimental results and limitations.';
 globalThis.urlResolve={z,sourceUrl:parsing.sourceUrl,sourceText:parsing.sourceText,fetchSource:async()=>{if(failed)throw Error('URL_UNAVAILABLE');return {url:'https://example.org/paper',type:'text/html',bytes:Buffer.from('<article>'+summary+'</article>')};},model:()=> 'test',api:async(path,payload)=>{summarizerInput=payload.input;return {title:'Research paper',summary,notes:'Detailed findings from the source.',readable};},output:r=>JSON.stringify(r),embed:async text=>{embedded.push(text);return [1,2];},detectLanguages:async()=>new Map([['question','en']])};
 const m=await load('const {'+Object.keys(globalThis.urlResolve).join(',')+'}=globalThis.urlResolve;\n'+strip('app/url-content/index.ts'));
 const result=await m.prepareNavigationInput('https://example.org/paper',new AbortController().signal);
 assert.deepEqual(embedded,[summary]);assert.equal(result.sourceDocument.url,'https://example.org/paper');assert.equal(result.vector[0],1);
 assert.ok(summarizerInput[0].content[0].text.includes('experimental results'));
 assert.ok(!result.routingQuestion.includes('https://'));assert.ok(result.routingQuestion.includes(summary));
 readable=false;await assert.rejects(m.prepareNavigationInput('https://example.org/login',new AbortController().signal),/URL_UNREADABLE/);assert.equal(embedded.length,1);
 failed=true;await assert.rejects(m.prepareNavigationInput('https://example.org/blocked',new AbortController().signal),/URL_UNAVAILABLE/);assert.equal(embedded.length,1);
 await m.prepareNavigationInput('Explain photosynthesis',new AbortController().signal);assert.equal(embedded[1],'Explain photosynthesis');
});
test('saved URL lookup reuses canonical identity with access checks and deterministic owner preference',async()=>{
 const {DatabaseSync}=await import('node:sqlite');const {readdirSync}=await import('node:fs');
 const db=new DatabaseSync(':memory:');for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('drizzle/'+f,'utf8'));
 const add=(id,owner,visibility,url,date)=>{
  db.prepare("INSERT INTO pages(id,owner_id,question,title,summary,body,category,sources,language,created_at,kind,visibility) VALUES(?,?,?,'Title','','','Web','[]','en',?,'static',?)").run(id,owner,url,date,visibility);
  db.prepare('INSERT INTO questions(id,page_id,normalized,question,embedding,created_at) VALUES(?,?,?,?,?,?)').run(id,id,'url:'+url,'Content summary','[1]',date);
 };
 const url='https://example.org/Paper?a=1';
 add('public','bob','public',url,'2020');add('own','alice','private',url,'2021');add('later','alice','private',url,'2022');add('hidden','eve','private','https://example.org/secret','2019');
 let lookups=0;
 globalThis.urlMatching={sourceUrl:parsing.sourceUrl,database:()=>({prepare:sql=>({bind:(...args)=>({all:async()=>({results:db.prepare(sql).all(...args)})})})}),getPage:async(id,userId)=>{lookups++;return db.prepare("SELECT id,kind FROM pages WHERE id=? AND (visibility='public' OR owner_id=?)").get(id,userId)||null;}};
 const m=await load('const {sourceUrl,database,getPage}=globalThis.urlMatching;\n'+strip('app/url-content/matching.ts'));
 assert.equal((await m.matchSourceUrl('https://EXAMPLE.org:443/Paper?a=1#section','alice')).id,'own');
 assert.equal((await m.matchSourceUrl(url,'alice')).id,'own');
 assert.equal((await m.matchSourceUrl(url,'visitor')).id,'public');
 assert.equal(await m.matchSourceUrl('https://example.org/secret','visitor'),null);
 assert.equal(await m.matchSourceUrl('https://example.org/paper?a=1','alice'),null);
 assert.equal(await m.matchSourceUrl('https://example.org/Paper?a=2','alice'),null);
 assert.equal(await m.matchSourceUrl('ordinary question','alice'),null);
 assert.equal(lookups,3);
 db.prepare("UPDATE pages SET visibility='private' WHERE id='public'").run();assert.equal(await m.matchSourceUrl(url,'visitor'),null);
 db.close();
});
test('URL fast path precedes AI configuration and content reading, and explicit forks bypass it',()=>{
 const route=readFileSync('app/api/ask/route.ts','utf8');
 const fast=route.indexOf('if(!fork){const page=await matchSourceUrl(question,uid)');
 assert.ok(fast>0);assert.ok(fast<route.indexOf('if(!aiKey())'));assert.ok(fast<route.indexOf('await prepareNavigationInput('));
 assert.match(route,/if\(sourceDocument\)\{const exact=await matchSourceUrl\(question,uid\);if\(exact\)return exact.id;/);
});

test('new URL pages and reused pages store separate URL and summary questions with summary vectors',()=>{
 const route=readFileSync('app/api/ask/route.ts','utf8');
 const pair='sourceDocument?[[originalKey,sourceDocument.url],[normalize(sourceDocument.summary),sourceDocument.summary]]';
 assert.equal(route.split(pair).length-1,2);
 assert.ok(route.includes('key,text,JSON.stringify(vector)'));
 const search=readFileSync('app/api/ask/question-search.ts','utf8');
 assert.ok(search.includes("NOT (q.normalized LIKE 'url:%' AND q.question=substr(q.normalized,5))"));
});
