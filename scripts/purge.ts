// Manual purge: npm run purge
import { loadConfig } from '../src/server/config.js';
import { openDatabase } from '../src/server/db/index.js';
import { runPurge } from '../src/server/services/purge.js';
import { StorageService } from '../src/server/services/storage.js';

const config = loadConfig();
const db = openDatabase(config.databasePath);
const logger = {
  info: (o: object | string, m?: string) => console.log(m ?? '', typeof o === 'string' ? o : JSON.stringify(o)),
  warn: (o: object | string, m?: string) => console.warn(m ?? '', typeof o === 'string' ? o : JSON.stringify(o)),
  error: (o: object | string, m?: string) => console.error(m ?? '', typeof o === 'string' ? o : JSON.stringify(o)),
};

const result = await runPurge(db, new StorageService(config.storageDir), config.retentionDays, new Date(), logger);
console.log(`Purge terminée : ${result.reportsDeleted} signalement(s), ${result.filesDeleted} fichier(s).`);
db.close();
