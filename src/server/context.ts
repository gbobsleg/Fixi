import type { Config } from './config.js';
import type { DB } from './db/index.js';
import type { StorageService } from './services/storage.js';

/** Shared dependencies passed explicitly to every plugin and route. */
export interface AppContext {
  config: Config;
  db: DB;
  storage: StorageService;
}
