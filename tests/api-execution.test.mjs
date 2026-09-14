import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
const moduleUrl=s=>'data:text/javascript;base64,'+Buffer.from(ts.transpile(s,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64');
const contracts=moduleUrl(readFileSync('app/components-registry/http-contracts.ts','utf8').replace("'zod'",JSON.stringify(import.meta.resolve('zod'))));
const {sendApiRequest}=await import(moduleUrl(readFileSync('app/components-registry/http-transport.ts','utf8').replace("'./http-contracts'",JSON.stringify(contracts))));
const {safeEndpoint}=await import(contracts);
const definition={operations:[{name:'get',method:'GET',path:'/v1/data',parameters:[{name:'count',location:'query',type:'number',required:true}],response:'json'}]};
const secret='fake-test-secret-123';
const grant={userIds:['alice'],endpoints:[{url:'https://api.example.com/v1/data',methods:['GET']}],auth:{location:'header',name:'Authorization',prefix:'Bearer '}};
const options={baseUrl:'https://api.example.com',definition,input:{operation:'get',parameters:{count:2}},userId:'alice',secretRef:'COMPONENT_SECRET_TEST',policy:{anonymous:[],credentials:{COMPONENT_SECRET_TEST:grant}},readSecret:()=>secret,fetcher:async()=>new Response('{"ok":true}')};
test('resolves secret after authorization and keeps auth out of response',async()=>{
 let called=false;
 const result=await sendApiRequest({...options,fetcher:async(url,init)=>{called=true;assert.equal(url.searchParams.get('count'),'2');assert.equal(init.headers.get('Authorization'),'Bearer '+secret);assert.equal(init.redirect,'manual');return new Response(JSON.stringify({echo:secret,encoded:encodeURIComponent(secret),base64:btoa(secret)}));}});
 assert.ok(called);assert.ok(!JSON.stringify(result).includes(secret));assert.deepEqual(result.data,{echo:'[redacted]',encoded:'[redacted]',base64:'[redacted]'});
});
test('denies other user and endpoint before touching secret storage or network',async()=>{
 const blocked={...options,readSecret:()=>{assert.fail('secret must not be read');},fetcher:async()=>assert.fail('network must not run')};
 await assert.rejects(()=>sendApiRequest({...blocked,userId:'bob'}),/CREDENTIAL_NOT_AUTHORIZED/);
 await assert.rejects(()=>sendApiRequest({...blocked,baseUrl:'https://attacker.example.com'}),/CREDENTIAL_NOT_AUTHORIZED/);
 await assert.rejects(()=>sendApiRequest({...blocked,definition:{operations:[{...definition.operations[0],path:'/other'}]}}),/CREDENTIAL_NOT_AUTHORIZED/);
});
test('missing secret has a safe actionable error',async()=>{await assert.rejects(()=>sendApiRequest({...options,readSecret:()=>undefined}),/CREDENTIAL_SECRET_MISSING/);});
test('query authentication overwrites caller parameter and redacts echoed key',async()=>{
 const value='test value / +';
 const result=await sendApiRequest({...options,readSecret:()=>value,policy:{anonymous:[],credentials:{COMPONENT_SECRET_TEST:{...grant,auth:{location:'query',name:'api_key'}}}},fetcher:async(url,init)=>{assert.equal(url.searchParams.get('api_key'),value);assert.equal(init.headers.has('Authorization'),false);return new Response(JSON.stringify({echo:value,url:url.toString()}));}});assert.equal(result.data.echo,'[redacted]');assert.ok(!result.data.url.includes('test+value'));assert.ok(result.data.url.includes('[redacted]'));
});
test('redirect and error bodies never expose authentication',async()=>{
 await assert.rejects(()=>sendApiRequest({...options,fetcher:async()=>new Response(null,{status:302,headers:{Location:'https://attacker.example.com'}})}),/API_REDIRECT_BLOCKED/);
 await assert.rejects(()=>sendApiRequest({...options,fetcher:async()=>new Response(secret,{status:401})}),/^Error: API_HTTP_401$/);
 await assert.rejects(()=>sendApiRequest({...options,fetcher:async()=>{throw new Error(secret);}}),/^Error: API_REQUEST_FAILED$/);
});
test('anonymous calls require exact enabled endpoint, and parameters are validated',async()=>{
 await assert.rejects(()=>sendApiRequest({...options,secretRef:undefined}),/API_ENDPOINT_NOT_ENABLED/);
 const result=await sendApiRequest({...options,secretRef:undefined,policy:{credentials:{},anonymous:grant.endpoints}});assert.equal(result.status,200);
 await assert.rejects(()=>sendApiRequest({...options,input:{operation:'get',parameters:{}}}),/MISSING_API_PARAMETER/);
 await assert.rejects(()=>sendApiRequest({...options,input:{operation:'get',parameters:{count:'2'}}}),/INVALID_API_PARAMETER/);
});
test('blocks unsafe URLs and oversized responses',async()=>{
 for(const base of ['http://example.com','https://127.0.0.1','https://[::1]','https://host.internal','https://user:pass@example.com'])assert.throws(()=>safeEndpoint(base,'/v1/data'));
 for(const path of ['//attacker.example.com','/v1/../admin','/v1/%2e%2e/admin','/v1/data?x=y'])assert.throws(()=>safeEndpoint('https://api.example.com',path));
 await assert.rejects(()=>sendApiRequest({...options,fetcher:async()=>new Response('x'.repeat(262145))}),/API_RESPONSE_TOO_LARGE/);
});
test('JSON writes use named operation and declared body fields',async()=>{
 const d={operations:[{name:'create',method:'POST',path:'/v1/data',parameters:[{name:'title',location:'body',type:'string',required:true}],response:'json'}]};
 await sendApiRequest({...options,definition:d,input:{operation:'create',parameters:{title:'Example'}},policy:{anonymous:[],credentials:{COMPONENT_SECRET_TEST:{...grant,endpoints:[{url:'https://api.example.com/v1/data',methods:['POST']}]}}},fetcher:async(url,init)=>{assert.equal(init.method,'POST');assert.equal(init.body,'{"title":"Example"}');return new Response('{}');}});
});
