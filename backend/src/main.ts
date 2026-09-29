import { createMaxBot } from './bots/max_client.js';
import { getCheckoKey } from './config.js';
import { applyMigrations, createDatabase } from './db/client.js';
import { setTimeout as delay } from 'node:timers/promises';

async function main(): Promise<void> {
  getCheckoKey();
  const database = createDatabase();
  try {
    await applyMigrations(database);
  } catch (error) {
    await database.end();
    throw error;
  }

  const bot = createMaxBot(database);
  console.log('Database ready. MAX bot is starting in Long Polling mode.');

  process.once('SIGINT', () => bot.stopPolling());
  process.once('SIGTERM', () => bot.stopPolling());

  try {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await bot.start({ mode: 'polling' });
        return;
      } catch (error) {
        if (attempt === 3) throw error;
        console.warn(`MAX is temporarily unreachable; retrying (${attempt}/2).`);
        await delay(attempt * 2_000);
      }
    }
  } finally {
    await database.end();
  }
}

main().catch((error) => {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'unknown';
  console.error('Bot startup or connection failed:', code);
  process.exitCode = 1;
});
