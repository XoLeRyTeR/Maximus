import pg from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDatabaseUrl } from '../config.js';

export type Database = pg.Pool;

export function createDatabase(): Database {
  return new pg.Pool({
    connectionString: getDatabaseUrl(),
    connectionTimeoutMillis: 8_000,
    max: 5,
  });
}

export async function applyMigrations(database: Database): Promise<void> {
  const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../migrations');
  const files = (await readdir(migrationsDir)).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
  const client = await database.connect();

  try {
    await client.query("SELECT pg_advisory_lock(hashtext('agrogrant_migrations'))");
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    for (const file of files) {
      const exists = await client.query('SELECT 1 FROM schema_migrations WHERE version = $1', [file]);
      if (exists.rowCount) continue;

      const sql = await readFile(resolve(migrationsDir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('agrogrant_migrations'))");
    client.release();
  }
}
