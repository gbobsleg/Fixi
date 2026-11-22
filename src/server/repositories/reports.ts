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
