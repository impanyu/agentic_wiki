import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Keep the application's prepared-query interface while running real SQLite.
// Batch operations are synchronous within one transaction, with no await gaps.
export class SqliteDatabase {
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.connection = new DatabaseSync(path);
    this.connection.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  }
  prepare(sql) { return new Statement(this, sql); }
  async batch(statements) {
    this.connection.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map(s => { if (s.db !== this) throw Error('Cross-database batch'); return s.execute(); });
      this.connection.exec('COMMIT');
      return results;
    } catch (error) { this.connection.exec('ROLLBACK'); throw error; }
  }
  async exec(sql) { this.connection.exec(sql); return { count: 0, duration: 0 }; }
  close() { this.connection.close(); }
}
class Statement {
  constructor(db, sql, values = []) { this.db = db; this.sql = sql; this.values = values; }
  bind(...values) { return new Statement(this.db, this.sql, values.map(v => typeof v === 'boolean' ? Number(v) : v)); }
  execute() {
    const statement = this.db.connection.prepare(this.sql);
    const before = this.db.connection.prepare('SELECT total_changes() n').get().n;
    let rows = [], change;
    if (statement.columns().length) rows = statement.all(...this.values);
    else change = statement.run(...this.values);
    const after = this.db.connection.prepare('SELECT total_changes() n, last_insert_rowid() id').get();
    return { success: true, results: rows, meta: { changes: Number(after.n - before), last_row_id: Number(change?.lastInsertRowid ?? after.id) } };
  }
  async all() { return this.execute(); }
  async run() { return this.execute(); }
  async first(column) { const row = this.db.connection.prepare(this.sql).get(...this.values); return row ? (column ? row[column] : row) : null; }
  async raw(options) { const s = this.db.connection.prepare(this.sql); s.setReturnArrays(true); const rows = s.all(...this.values); return options?.columnNames ? [s.columns().map(c => c.name), ...rows] : rows; }
}
