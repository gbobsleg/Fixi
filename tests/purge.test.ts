import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type DB } from '../src/server/db/index.js';
import { insertReport } from '../src/server/repositories/reports.js';
import { runPurge } from '../src/server/services/purge.js';
import { StorageService } from '../src/server/services/storage.js';
import { makeApp } from './helpers.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-11-22T12:00:00Z');

let db: DB;
let dir: string;
let storage: StorageService;
let appId: number;

beforeEach(() => {
  db = openDatabase(':memory:');
  dir = mkdtempSync(join(tmpdir(), 'fixi-purge-'));
  storage = new StorageService(dir);
  appId = makeApp(db).id;
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

async function addReport(opts: { status: string; ageDays: number; parentId?: number; withFiles?: boolean }) {
  let screenshot: string | null = null;
  let attachment: string | null = null;
  if (opts.withFiles !== false) {
    screenshot = await storage.save(Buffer.from('png'), 'png');
    attachment = await storage.save(Buffer.from('txt'), 'txt');
  }
  const id = insertReport(db, {
    app_id: appId,
    category: 'bug',
    comment: 'c',
    user_info: 'u',
    user_email: null,
    app_version: null,
    url: '',
    user_agent: '',
    viewport: '',
    client_created_at: NOW.toISOString(),
    screenshot_path: screenshot,
    attachment_path: attachment,
    attachment_original_name: attachment ? 'a.txt' : null,
    attachment_mime: attachment ? 'text/plain' : null,
    timeline: [],
    has_http_error: false,
    max_http_status: null,
    has_js_error: false,
  });
  const updatedAt = new Date(NOW.getTime() - opts.ageDays * DAY).toISOString();
  db.prepare('UPDATE bug_reports SET status = ?, parent_id = ?, updated_at = ? WHERE id = ?').run(
    opts.status,
    opts.parentId ?? null,
    updatedAt,
    id,
  );
  return { id, screenshot, attachment };
}

const count = () => (db.prepare('SELECT COUNT(*) AS n FROM bug_reports').get() as { n: number }).n;
const onDisk = (name: string | null) => existsSync(join(dir, name!));

describe('runPurge', () => {
  it('deletes a resolved parent older than the retention together with its duplicates and files (foreign keys ON)', async () => {
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    const parent = await addReport({ status: 'resolved', ageDays: 91 });
    const child1 = await addReport({ status: 'duplicate', ageDays: 91, parentId: parent.id });
    const child2 = await addReport({ status: 'duplicate', ageDays: 2, parentId: parent.id }); // recent child, still purged

    const result = await runPurge(db, storage, 90, NOW);

    expect(result.reportsDeleted).toBe(3);
    expect(result.filesDeleted).toBe(6);
    expect(count()).toBe(0);
    for (const r of [parent, child1, child2]) {
      expect(onDisk(r.screenshot)).toBe(false);
      expect(onDisk(r.attachment)).toBe(false);
    }
  });

  it('purges rejected parents too', async () => {
    await addReport({ status: 'rejected', ageDays: 120 });
    expect((await runPurge(db, storage, 90, NOW)).reportsDeleted).toBe(1);
  });

  it('keeps a resolved parent that is younger than the retention', async () => {
    const parent = await addReport({ status: 'resolved', ageDays: 89 });
    await runPurge(db, storage, 90, NOW);
    expect(count()).toBe(1);
    expect(onDisk(parent.screenshot)).toBe(true);
  });

  it('never purges reports sent to the tracker, however old', async () => {
    const sent = await addReport({ status: 'sent', ageDays: 400 });
    await runPurge(db, storage, 90, NOW);
    expect(count()).toBe(1);
    expect(onDisk(sent.screenshot)).toBe(true);
  });

  it('keeps open reports (new / in_progress)', async () => {
    await addReport({ status: 'new', ageDays: 400 });
    await addReport({ status: 'in_progress', ageDays: 400 });
    await runPurge(db, storage, 90, NOW);
    expect(count()).toBe(2);
  });

  it('does not touch a parent that is still open even if its duplicates are old', async () => {
    const parent = await addReport({ status: 'in_progress', ageDays: 5 });
    await addReport({ status: 'duplicate', ageDays: 300, parentId: parent.id });
    await runPurge(db, storage, 90, NOW);
    expect(count()).toBe(2);
  });

  it('does not fail when a file is already missing on disk', async () => {
    const parent = await addReport({ status: 'resolved', ageDays: 100 });
    rmSync(join(dir, parent.screenshot!));
    const result = await runPurge(db, storage, 90, NOW);
    expect(result.reportsDeleted).toBe(1);
    expect(result.filesDeleted).toBe(1); // only the attachment was still there
  });

  it('is a no-op when nothing is due', async () => {
    writeFileSync(join(dir, 'unrelated.txt'), 'keep me');
    const result = await runPurge(db, storage, 90, NOW);
    expect(result).toEqual({ reportsDeleted: 0, filesDeleted: 0 });
    expect(existsSync(join(dir, 'unrelated.txt'))).toBe(true);
  });
});
