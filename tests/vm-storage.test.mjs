import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteDatabase } from '../server/sqlite.mjs';
import { FileBucket } from '../server/files.mjs';
import { migrate } from '../scripts/migrate.mjs';
test('all application migrations apply twice; persistent queries and atomic batches work', async () => {
 const dir = await mkdtemp(join(tmpdir(),'agenticwiki-db-'));
 try {
  const path=join(dir,'db.sqlite'); migrate(path); migrate(path);
  const db=new SqliteDatabase(path);
  assert.equal((await db.prepare('SELECT count(*) n FROM app_migrations').first()).n,25);
  await db.prepare('INSERT INTO generation_locks VALUES(?,?,?)').bind('test','one',1).run();
  await assert.rejects(db.batch([db.prepare('UPDATE generation_locks SET token=? WHERE name=?').bind('two','test'), db.prepare('INSERT INTO missing_table VALUES(1)')]));
  assert.equal(await db.prepare('SELECT token FROM generation_locks WHERE name=?').bind('test').first('token'),'one');
  const result=await db.prepare('UPDATE generation_locks SET token=? WHERE name=?').bind('three','test').run();assert.equal(result.meta.changes,1);
  assert.deepEqual(await db.prepare('SELECT token FROM generation_locks WHERE name=?').bind('test').raw({columnNames:true}),[['token'],['three']]);
  const returned=await db.prepare('UPDATE generation_locks SET expires=2 RETURNING token').all();assert.equal(returned.meta.changes,1);
  const taken=await db.prepare('DELETE FROM generation_locks WHERE name=? RETURNING token').bind('test').first();assert.equal(taken.token,'three');
  assert.equal(await db.prepare('SELECT token FROM generation_locks WHERE name=?').bind('test').first(),null);
  db.close();
  const reopened=new SqliteDatabase(path);assert.ok((await reopened.prepare("SELECT name FROM sqlite_master WHERE name='pages'").first()).name);reopened.close();
 } finally { await rm(dir,{recursive:true,force:true}); }
});
test('object persistence, binary roundtrip, deletion and traversal-resistant keys',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'agenticwiki-files-'));
 try{
  let bucket=new FileBucket(dir);await bucket.put('../../outside',new Uint8Array([0,255,1]));
  assert.ok(bucket.path('../../outside').startsWith(dir+'/'));bucket=new FileBucket(dir);
  const o=await bucket.get('../../outside');assert.equal(o.size,3);assert.deepEqual([...new Uint8Array(await o.arrayBuffer())],[0,255,1]);
  await bucket.put('draft','{"title":"India"}');assert.equal((await (await bucket.get('draft')).json()).title,'India');
  await bucket.delete(['draft','../../outside']);assert.equal(await bucket.get('draft'),null);
 }finally{await rm(dir,{recursive:true,force:true});}
});
