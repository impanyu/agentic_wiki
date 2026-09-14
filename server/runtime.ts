import { resolve } from 'node:path';
import { SqliteDatabase } from './sqlite.mjs';
import { FileBucket } from './files.mjs';

const state = globalThis as typeof globalThis & { agenticDatabase?: D1Database; agenticFiles?: R2Bucket };
export const env = new Proxy({} as { DB: D1Database; FILES: R2Bucket }, {
  get(_target, name: string) {
    if (name === 'DB') return state.agenticDatabase ??= new SqliteDatabase(process.env.DATABASE_PATH || resolve(process.env.DATA_DIR || './data', 'agenticwiki.sqlite')) as unknown as D1Database;
    if (name === 'FILES') return state.agenticFiles ??= new FileBucket(process.env.FILES_PATH || resolve(process.env.DATA_DIR || './data', 'objects')) as unknown as R2Bucket;
    return process.env[name];
  },
});
