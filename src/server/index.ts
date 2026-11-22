import { buildApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';
import { openDatabase } from './db/index.js';
import { startPurgeScheduler } from './services/purge.js';
import { StorageService } from './services/storage.js';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  const db = openDatabase(config.databasePath);
  const app = await buildApp({ config, db });
  const stopPurge = startPurgeScheduler(db, new StorageService(config.storageDir), config.retentionDays, app.log);

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    stopPurge();
    await app.close();
    db.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: config.port, host: '0.0.0.0' });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
