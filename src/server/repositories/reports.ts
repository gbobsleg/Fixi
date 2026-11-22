import type { DB } from '../db/index.js';
import type { Category, Status, TimelineEvent } from '../../shared/types.js';

export interface ReportRow {
  id: number;
  app_id: number;
  parent_id: number | null;
  category: Category;
  status: Status;
  comment: string;
  user_info: string;
  user_email: string | null;
  app_version: string | null;
  url: string;
  user_agent: string;
  viewport: string;
  client_created_at: string;
  screenshot_path: string | null;
  attachment_path: string | null;
  attachment_original_name: string | null;
  attachment_mime: string | null;
  timeline_json: string;
  has_http_error: number;
  max_http_status: number | null;
  has_js_error: number;
  issue_provider: string | null;
  issue_number: number | null;
  issue_url: string | null;
  admin_notes: string | null;
  last_notified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface NewReport {
  app_id: number;
  category: Category;
  comment: string;
  user_info: string;
  user_email: string | null;
  app_version: string | null;
  url: string;
  user_agent: string;
  viewport: string;
  client_created_at: string;
  screenshot_path: string | null;
  attachment_path: string | null;
  attachment_original_name: string | null;
  attachment_mime: string | null;
  timeline: TimelineEvent[];
  has_http_error: boolean;
  max_http_status: number | null;
  has_js_error: boolean;
}

export function insertReport(db: DB, r: NewReport): number {
  const now = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO bug_reports (
         app_id, category, status, comment, user_info, user_email, app_version, url, user_agent, viewport,
         client_created_at, screenshot_path, attachment_path, attachment_original_name, attachment_mime,
         timeline_json, has_http_error, max_http_status, has_js_error, created_at, updated_at
       ) VALUES (?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      r.app_id,
      r.category,
      r.comment,
      r.user_info,
      r.user_email,
      r.app_version,
      r.url,
      r.user_agent,
      r.viewport,
      r.client_created_at,
      r.screenshot_path,
      r.attachment_path,
      r.attachment_original_name,
      r.attachment_mime,
      JSON.stringify(r.timeline),
      r.has_http_error ? 1 : 0,
      r.max_http_status,
      r.has_js_error ? 1 : 0,
      now,
      now,
    );
  return Number(info.lastInsertRowid);
}

export function getReportById(db: DB, id: number): ReportRow | undefined {
  return db.prepare('SELECT * FROM bug_reports WHERE id = ?').get(id) as ReportRow | undefined;
}

/** Looks up the report owning a stored file (used to serve the original attachment name). */
export function findReportByFile(db: DB, filename: string): ReportRow | undefined {
  return db
    .prepare('SELECT * FROM bug_reports WHERE screenshot_path = ? OR attachment_path = ? LIMIT 1')
    .get(filename, filename) as ReportRow | undefined;
}

// ---------------------------------------------------------------------------
// Admin queries (lot 3)
// ---------------------------------------------------------------------------

export const PAGE_SIZE = 50;

export interface ReportFilters {
  app_id?: number;
  status?: Status;
  category?: Category;
  q?: string;
  include_duplicates?: boolean;
  /** Only tickets that can be the target of an attachment (not themselves duplicates). */
  parents_only?: boolean;
  page?: number;
}

/** A report row enriched with the data the admin list needs. */
export interface ReportListItem extends ReportRow {
  app_slug: string;
  app_name: string;
  duplicates_count: number;
}

export interface ReportPage {
  reports: ReportListItem[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

const LIST_COLUMNS = `
  b.*,
  a.slug AS app_slug,
  a.name AS app_name,
  (SELECT COUNT(*) FROM bug_reports c WHERE c.parent_id = b.id) AS duplicates_count`;

/** Escapes the LIKE wildcards of user input (used with ESCAPE '!': no backslash to mangle). */
function likePattern(input: string): string {
  return `%${input.replace(/[!%_]/g, (c) => `!${c}`)}%`;
}

export function listReports(db: DB, filters: ReportFilters): ReportPage {
  const where: string[] = [];
  const params: (string | number)[] = [];

  if (filters.app_id !== undefined) {
    where.push('b.app_id = ?');
    params.push(filters.app_id);
  }
  if (filters.status) {
    where.push('b.status = ?');
    params.push(filters.status);
  }
  if (filters.category) {
    where.push('b.category = ?');
    params.push(filters.category);
  }
  if (filters.q) {
    const like = likePattern(filters.q);
    const clauses = [
      "b.comment LIKE ? ESCAPE '!'",
      "b.user_info LIKE ? ESCAPE '!'",
      "b.url LIKE ? ESCAPE '!'",
    ];
    params.push(like, like, like);
    const asId = /^#?(\d{1,9})$/.exec(filters.q.trim());
    if (asId) {
      clauses.push('b.id = ?');
      params.push(Number(asId[1]));
    }
    where.push(`(${clauses.join(' OR ')})`);
  }
  // Duplicates are hidden by default, except when explicitly filtering on the "duplicate" status.
  if (filters.parents_only || (!filters.include_duplicates && filters.status !== 'duplicate')) {
    where.push('b.parent_id IS NULL');
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM bug_reports b ${whereSql}`).get(...params) as { n: number }
  ).n;

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, filters.page ?? 1), totalPages);
  const reports = db
    .prepare(
      `SELECT ${LIST_COLUMNS}
       FROM bug_reports b JOIN apps a ON a.id = b.app_id
       ${whereSql}
       ORDER BY b.created_at DESC, b.id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, PAGE_SIZE, (page - 1) * PAGE_SIZE) as ReportListItem[];

  return { reports, total, page, page_size: PAGE_SIZE, total_pages: totalPages };
}

export function getReportListItem(db: DB, id: number): ReportListItem | undefined {
  return db
    .prepare(
      `SELECT ${LIST_COLUMNS}
       FROM bug_reports b JOIN apps a ON a.id = b.app_id
       WHERE b.id = ?`,
    )
    .get(id) as ReportListItem | undefined;
}

/** Duplicates attached to a parent, oldest first. */
export function listChildren(db: DB, parentId: number): ReportRow[] {
  return db
    .prepare('SELECT * FROM bug_reports WHERE parent_id = ? ORDER BY created_at, id')
    .all(parentId) as ReportRow[];
}

export function countChildren(db: DB, parentId: number): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM bug_reports WHERE parent_id = ?').get(parentId) as {
    n: number;
  };
  return row.n;
}

export interface ReportUpdate {
  parent_id?: number | null;
  status?: Status;
  admin_notes?: string | null;
  issue_provider?: string | null;
  issue_number?: number | null;
  issue_url?: string | null;
}

const UPDATABLE = [
  'parent_id',
  'status',
  'admin_notes',
  'issue_provider',
  'issue_number',
  'issue_url',
] as const;

/** Applies a partial update (only the keys present in `changes`) and bumps `updated_at`. */
export function updateReport(db: DB, id: number, changes: ReportUpdate): void {
  const keys = UPDATABLE.filter((k) => k in changes);
  const sets = [...keys.map((k) => `${k} = ?`), 'updated_at = ?'];
  const values = keys.map((k) => changes[k] ?? null);
  db.prepare(`UPDATE bug_reports SET ${sets.join(', ')} WHERE id = ?`).run(
    ...values,
    new Date().toISOString(),
    id,
  );
}
