import Database from 'better-sqlite3';
import type { Database as Db } from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { runMigrations } from './migrate.js';

export type DB = Db;

/** Opens (creating it if needed) the SQLite database and applies pending migrations. */
export function openDatabase(path: string): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL'); // readers do not block the writer
  db.pragma('foreign_keys = ON'); // enforce foreign keys
  runMigrations(db);
  return db;
}
