import pg from 'pg';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getDatabaseUrl } from '../dist/config.js';

const pool = new pg.Pool({ connectionString: getDatabaseUrl(), connectionTimeoutMillis: 3000 });
try {
  const files = (await readdir(resolve('migrations'))).filter((name) => /^\d+_.+\.sql$/.test(name));
  const result = await pool.query('SELECT version FROM schema_migrations');
  const applied = new Set(result.rows.map((row) => row.version));
  if (files.some((file) => !applied.has(file))) process.exitCode = 1;
} catch {
  process.exitCode = 1;
} finally {
  await pool.end();
}
