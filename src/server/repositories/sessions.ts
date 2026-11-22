import { randomBytes } from 'node:crypto';
import type { DB } from '../db/index.js';

export const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 h, sliding

export function createSession(db: DB, now = new Date()): string {
  const id = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (id, expires_at) VALUES (?, ?)').run(
    id,
    new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
  );
  return id;
}

/** Returns true if the session exists and is not expired; extends it (sliding window). */
export function touchSession(db: DB, id: string, now = new Date()): boolean {
  const row = db.prepare('SELECT expires_at FROM sessions WHERE id = ?').get(id) as
    | { expires_at: string }
    | undefined;
  if (!row) return false;
  if (row.expires_at <= now.toISOString()) {
    deleteSession(db, id);
    return false;
  }
  db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').run(
    new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
    id,
  );
  return true;
}

export function deleteSession(db: DB, id: string): void {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
}

export function deleteExpiredSessions(db: DB, now = new Date()): number {
  return db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now.toISOString()).changes;
}
