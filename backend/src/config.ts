import { config as loadEnv } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// src/ and dist/ are both one directory below backend/.
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
loadEnv({ path: resolve(projectRoot, '.env') });

export function getBotToken(): string {
  const token = process.env.BOT_TOKEN_MAX?.trim();
  if (!token) {
    throw new Error('BOT_TOKEN_MAX is missing. Set it in the project .env file.');
  }
  return token;
}

export function getCheckoKey(): string {
  const key = process.env.CHECKO_API?.trim();
  if (!key) {
    throw new Error('CHECKO_API is missing. Set it in the project .env file.');
  }
  return key;
}

export function getGigaKey(): string {
  const key = process.env.GIGA_API_KEY?.trim();
  if (!key) throw new Error('GIGA_API_KEY is missing. Set it in the project .env file.');
  return key;
}

export function getDatabaseUrl(): string {
  const host = process.env.DB_HOST?.trim();
  if (host) {
    const user = process.env.DB_USER?.trim();
    const password = process.env.DB_PASSWORD;
    const database = process.env.DB_NAME?.trim();
    if (!user || !password || !database) {
      throw new Error('DB_HOST requires DB_USER, DB_PASSWORD and DB_NAME.');
    }
    const url = new URL('postgresql://localhost');
    url.hostname = host;
    url.username = user;
    url.password = password;
    url.pathname = `/${encodeURIComponent(database)}`;
    return url.toString();
  }
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error('DATABASE_URL is missing. Set it in the project .env file.');
  }
  // SQLAlchemy's driver suffix is not understood by node-postgres.
  return url.replace(/^postgresql\+psycopg:/, 'postgresql:');
}
