import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

// Keys are opaque: hashing prevents traversal and preserves legacy r2:// references.
// Files live outside public/. Only authorized application routes can read them.
export class FileBucket {
  constructor(root) { this.root = resolve(root); }
  path(key) { if (typeof key !== 'string' || !key) throw Error('Invalid object key'); const hash = createHash('sha256').update(key).digest('hex'); return resolve(this.root, hash.slice(0, 2), hash); }
  async put(key, value) {
    const path = this.path(key); await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const bytes = typeof value === 'string' ? Buffer.from(value) : Buffer.from(await new Response(value).arrayBuffer());
    const temp = path + '.' + randomUUID();
    try { await writeFile(temp, bytes, { mode: 0o600 }); await rename(temp, path); } finally { await rm(temp, { force: true }); }
    return { key, size: bytes.length };
  }
  async get(key) {
    let bytes;
    try { bytes = await readFile(this.path(key)); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
    return { key, size: bytes.length, body: new Response(bytes).body, text: async () => bytes.toString('utf8'), json: async () => JSON.parse(bytes.toString('utf8')), arrayBuffer: async () => Uint8Array.from(bytes).buffer };
  }
  async delete(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) await rm(this.path(key), { force: true }); }
}
