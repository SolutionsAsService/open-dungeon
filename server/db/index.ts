/**
 * Database boundary. Production uses PostgreSQL via DATABASE_URL; local development and tests
 * use PGlite (embedded Postgres) so the same SQL and migrations run everywhere.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Queryable { query<T = any>(sql: string, params?: unknown[]): Promise<T[]> }
export interface Db extends Queryable {
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export async function openDb(opts: { databaseUrl: string | null; dataDir: string | null }): Promise<Db> {
  if (opts.databaseUrl) {
    const pg = (await import('pg')).default;
    const pool = new pg.Pool({ connectionString: opts.databaseUrl });
    return {
      async query(sql, params = []) { return (await pool.query(sql, params as any[])).rows; },
      async tx(fn) {
        const c = await pool.connect();
        try {
          await c.query('BEGIN');
          const r = await fn({ async query(sql, params = []) { return (await c.query(sql, params as any[])).rows; } });
          await c.query('COMMIT');
          return r;
        } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
      },
      async close() { await pool.end(); },
    };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  if (opts.dataDir) fs.mkdirSync(opts.dataDir, { recursive: true });
  const db = opts.dataDir ? new PGlite(path.join(opts.dataDir, 'db')) : new PGlite();
  await db.waitReady;
  // PGlite is single-connection: serialise transactions so concurrent requests can't interleave.
  let chain: Promise<unknown> = Promise.resolve();
  const q: Queryable = { async query(sql, params = []) { return (await db.query(sql, params as any[])).rows as any[]; } };
  return {
    query: q.query,
    tx(fn) {
      const run = chain.then(() => db.transaction(async (t) => fn({ async query(sql, params = []) { return (await t.query(sql, params as any[])).rows as any[]; } })));
      chain = run.catch(() => undefined);
      return run;
    },
    async close() { await db.close(); },
  };
}

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export async function migrate(db: Db): Promise<string[]> {
  await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  const done = new Set((await db.query<{ id: string }>('SELECT id FROM schema_migrations')).map((r) => r.id));
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    await db.tx(async (t) => {
      for (const stmt of sql.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) await t.query(stmt);
      await t.query('INSERT INTO schema_migrations (id) VALUES ($1)', [file]);
    });
    applied.push(file);
  }
  return applied;
}
