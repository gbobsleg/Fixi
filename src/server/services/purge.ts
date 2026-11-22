import type { DB } from '../db/index.js';
import type { StorageService } from './storage.js';

export interface PurgeLogger {
  info(obj: object | string, msg?: string): void;
  warn(obj: object | string, msg?: string): void;
  error(obj: object | string, msg?: string): void;
}

export interface PurgeResult {
  reportsDeleted: number;
  filesDeleted: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Deletes closed parent reports (resolved / rejected) not updated for `retentionDays`,
 * together with their duplicates and their files. Reports with status `sent` are never purged.
 *
 * Order matters because foreign keys are enforced and `parent_id` has no ON DELETE CASCADE:
 *  1. collect the file names (parent + children),
 *  2. in ONE transaction delete the children, then the parent,
 *  3. only after the commit, delete the files from disk.
 */
export async function runPurge(
  db: DB,
  storage: StorageService,
  retentionDays: number,
  now: Date = new Date(),
  logger?: PurgeLogger,
): Promise<PurgeResult> {
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS).toISOString();

  const parents = db
    .prepare(
      `SELECT id FROM bug_reports
       WHERE parent_id IS NULL AND status IN ('resolved', 'rejected') AND updated_at < ?`,
    )
    .all(cutoff) as { id: number }[];

  const filesToDelete: string[] = [];
  const selectFiles = db.prepare(
    `SELECT screenshot_path, attachment_path FROM bug_reports WHERE id = @id OR parent_id = @id`,
  );
  const deleteChildren = db.prepare('DELETE FROM bug_reports WHERE parent_id = ?');
  const deleteParent = db.prepare('DELETE FROM bug_reports WHERE id = ?');

  let reportsDeleted = 0;
  db.transaction(() => {
    for (const { id } of parents) {
      const rows = selectFiles.all({ id }) as { screenshot_path: string | null; attachment_path: string | null }[];
      for (const row of rows) {
        if (row.screenshot_path) filesToDelete.push(row.screenshot_path);
        if (row.attachment_path) filesToDelete.push(row.attachment_path);
      }
      reportsDeleted += deleteChildren.run(id).changes;
      reportsDeleted += deleteParent.run(id).changes;
    }
  })();

  let filesDeleted = 0;
  for (const name of filesToDelete) {
    try {
      if (await storage.remove(name)) filesDeleted++;
      else logger?.warn({ file: name }, 'purge: file already missing on disk');
    } catch (err) {
      logger?.error({ err, file: name }, 'purge: could not delete file');
    }
  }

  logger?.info({ reportsDeleted, filesDeleted, retentionDays }, 'purge done');
  return { reportsDeleted, filesDeleted };
}

/** Runs the purge once at startup, then every 24 h. Returns a function that stops the schedule. */
export function startPurgeScheduler(
  db: DB,
  storage: StorageService,
  retentionDays: number,
  logger?: PurgeLogger,
): () => void {
  const run = () => {
    runPurge(db, storage, retentionDays, new Date(), logger).catch((err) =>
      logger?.error({ err }, 'purge failed'),
    );
  };
  run();
  const timer = setInterval(run, DAY_MS);
  timer.unref();
  return () => clearInterval(timer);
}
