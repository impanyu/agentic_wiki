import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { migrate } from '../scripts/migrate.mjs';
import { SqliteDatabase } from '../server/sqlite.mjs';
const dir=mkdtempSync(join(tmpdir(),'agenticwiki-auth-')),path=join(dir,'db');migrate(path);
const db=new SqliteDatabase(path);globalThis.__vmEnv={DB:db};
process.env.APP_URL='https://wiki.example.com';
const load=async source=>import('data:text/javascript;base64,'+Buffer.from(ts.transpile(source,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
const auth=await load(readFileSync('server/auth.ts','utf8').replace("import { env } from './runtime';",'const env=globalThis.__vmEnv;'));
globalThis.__vmAuth=auth;
const callback=await load(readFileSync('app/auth/google/callback/route.ts','utf8').replace("from 'zod'",`from '${new URL('../node_modules/zod/index.js',import.meta.url)}'`).replace("import { env } from '@/server/runtime';",'const env=globalThis.__vmEnv;').replace(/import \{ token, hash, cookie, stateCookie, sessionCookie, requestCookie, origin \} from '@\/server\/auth';/,'const {token,hash,cookie,stateCookie,sessionCookie,requestCookie,origin}=globalThis.__vmAuth;'));
test('cookie-only sessions expire, reject malformed tokens and use safe return paths',async()=>{
 const value=auth.token(),user={userId:'google:123',email:'me@example.com',displayName:'Me',fullName:'Me'};
 await db.prepare('INSERT INTO auth_sessions VALUES(?,?,?)').bind(auth.hash(value),JSON.stringify(user),Date.now()+10000).run();
 assert.deepEqual(await auth.sessionUser(value),user);assert.equal(await auth.sessionUser('forged'),null);
 await db.prepare('UPDATE auth_sessions SET expires=0').run();assert.equal(await auth.sessionUser(value),null);
 assert.equal(auth.safeReturn('//evil.example/'),'/');assert.equal(auth.safeReturn('/?page=abc'),'/?page=abc');assert.match(auth.cookie('test','x',10),/HttpOnly; SameSite=Lax.*Secure/);
});
test('OAuth callback binds browser state, consumes it once, and creates a hashed session',async()=>{
 const state=auth.token();await db.prepare('INSERT INTO auth_states VALUES(?,?,?,?)').bind(auth.hash(state),'verifier','/?page=example',Date.now()+60000).run();
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async url=>{calls++;return Response.json(String(url).includes('/token')?{access_token:'provider-token'}:{sub:'123',email:'me@example.com',email_verified:true,name:'Me'});};
 try{
  const bad=await callback.GET(new Request('https://wiki.example.com/auth/google/callback?state='+state+'&code=code'));assert.equal(bad.status,400);assert.equal(calls,0);
  const request=()=>new Request('https://wiki.example.com/auth/google/callback?state='+state+'&code=code',{headers:{cookie:auth.stateCookie+'='+state}});
  const good=await callback.GET(request());assert.equal(good.status,302);assert.equal(good.headers.get('location'),'https://wiki.example.com/?page=example');assert.equal(calls,2);
  const session=good.headers.getSetCookie().find(s=>s.startsWith(auth.sessionCookie+'=')).split(';')[0].split('=')[1];assert.equal((await auth.sessionUser(session)).userId,'google:123');
  assert.equal((await db.prepare('SELECT hash FROM auth_sessions WHERE hash=?').bind(session).all()).results.length,0);
  assert.equal((await callback.GET(request())).status,400);assert.equal(calls,2);
 }finally{globalThis.fetch=original;}
});
test.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});delete globalThis.__vmEnv;delete globalThis.__vmAuth;});
