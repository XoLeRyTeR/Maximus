import { config } from 'dotenv';
import pg from 'pg';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
config({ path: resolve(backendRoot, '../.env') });

const rawUrl = process.env.DATABASE_URL;
if (!rawUrl) throw new Error('DATABASE_URL is missing');

const url = new URL(rawUrl.replace(/^postgresql\+psycopg:/, 'postgresql:'));
const databaseName = decodeURIComponent(url.pathname.slice(1));
if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(databaseName)) {
  throw new Error('Unsupported database name in DATABASE_URL');
}

url.pathname = '/postgres';
const pool = new pg.Pool({ connectionString: url.toString(), connectionTimeoutMillis: 8000 });

try {
  const databases = await pool.query('SELECT datname FROM pg_database');
  if (databases.rows.some(({ datname }) => datname === databaseName)) {
    console.log('Database already exists.');
  } else {
    await pool.query(`CREATE DATABASE "${databaseName}"`);
    console.log('Database created.');
  }
} catch (error) {
  console.error('Could not create database:', error.code ?? error.name);
  process.exitCode = 1;
} finally {
  await pool.end();
}
