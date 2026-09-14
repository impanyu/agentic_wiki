import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { SqliteDatabase } from '../server/sqlite.mjs';

export function migrate(path = process.env.DATABASE_PATH || resolve(process.env.DATA_DIR || './data', 'agenticwiki.sqlite')) {
  const db = new SqliteDatabase(path), c = db.connection;
  try {
    c.exec('CREATE TABLE IF NOT EXISTS app_migrations(name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)');
    const journal = JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8'));
    for (const entry of journal.entries) {
      const name = entry.tag + '.sql';
      const sql = readFileSync(new URL('../drizzle/' + name, import.meta.url), 'utf8');
      const hash = createHash('sha256').update(sql).digest('hex');
      c.exec('BEGIN IMMEDIATE');
      try {
        const previous = c.prepare('SELECT checksum FROM app_migrations WHERE name=?').get(name);
        if (previous && previous.checksum !== hash) throw Error('Previously applied migration changed: ' + name);
        if (!previous) { c.exec(sql); c.prepare('INSERT INTO app_migrations VALUES(?,?,?)').run(name, hash, new Date().toISOString()); }
        c.exec('COMMIT');
      } catch (error) { c.exec('ROLLBACK'); throw error; }
    }
    c.exec(`CREATE TABLE IF NOT EXISTS auth_states(hash TEXT PRIMARY KEY, verifier TEXT NOT NULL, return_to TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS auth_sessions(hash TEXT PRIMARY KEY, user_json TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS auth_session_expiry ON auth_sessions(expires);`);
  } finally { db.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) { migrate(); console.log('Database migrations complete.'); }
