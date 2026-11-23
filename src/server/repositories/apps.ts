import { randomBytes } from 'node:crypto';
import { DEFAULT_WIDGET_COLOR } from '../../shared/types.js';
import type { DB } from '../db/index.js';

export type IssueProvider = 'gitlab' | 'github';

export interface App {
  id: number;
  slug: string;
  name: string;
  api_key: string;
  allowed_origins: string[];
  issue_provider: IssueProvider | null;
  issue_project: string | null;
  issue_default_labels: string | null;
  issue_anonymize: boolean;
  /** `#rrggbb`, color of the widget's tab and buttons in this app. */
  widget_color: string;
  created_at: string;
}

export interface AppInput {
  slug: string;
  name: string;
  allowed_origins: string[];
  issue_provider: IssueProvider | null;
  issue_project: string | null;
  issue_default_labels: string | null;
  issue_anonymize: boolean;
  /** Defaults to DEFAULT_WIDGET_COLOR on creation; left unchanged on update when absent. */
  widget_color?: string;
}

interface AppRow {
  id: number;
  slug: string;
  name: string;
  api_key: string;
  allowed_origins: string;
  issue_provider: IssueProvider | null;
  issue_project: string | null;
  issue_default_labels: string | null;
  issue_anonymize: number;
  widget_color: string;
  created_at: string;
}

function fromRow(row: AppRow): App {
  let origins: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.allowed_origins);
    if (Array.isArray(parsed)) origins = parsed.filter((o): o is string => typeof o === 'string');
  } catch {
    origins = [];
  }
  return { ...row, allowed_origins: origins, issue_anonymize: row.issue_anonymize === 1 };
}

export function generateApiKey(): string {
  return randomBytes(24).toString('base64url');
}

export function listApps(db: DB): App[] {
  return (db.prepare('SELECT * FROM apps ORDER BY name COLLATE NOCASE').all() as AppRow[]).map(fromRow);
}

export function getAppById(db: DB, id: number): App | undefined {
  const row = db.prepare('SELECT * FROM apps WHERE id = ?').get(id) as AppRow | undefined;
  return row ? fromRow(row) : undefined;
}

export function getAppBySlug(db: DB, slug: string): App | undefined {
  const row = db.prepare('SELECT * FROM apps WHERE slug = ?').get(slug) as AppRow | undefined;
  return row ? fromRow(row) : undefined;
}

export function createApp(db: DB, input: AppInput): App {
  const info = db
    .prepare(
      `INSERT INTO apps (slug, name, api_key, allowed_origins, issue_provider, issue_project,
                         issue_default_labels, issue_anonymize, widget_color, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.slug,
      input.name,
      generateApiKey(),
      JSON.stringify(input.allowed_origins),
      input.issue_provider,
      input.issue_project,
      input.issue_default_labels,
      input.issue_anonymize ? 1 : 0,
      input.widget_color ?? DEFAULT_WIDGET_COLOR,
      new Date().toISOString(),
    );
  return getAppById(db, Number(info.lastInsertRowid))!;
}

export function updateApp(db: DB, id: number, input: AppInput): App | undefined {
  const info = db
    .prepare(
      `UPDATE apps SET slug = ?, name = ?, allowed_origins = ?, issue_provider = ?, issue_project = ?,
                       issue_default_labels = ?, issue_anonymize = ?, widget_color = COALESCE(?, widget_color)
       WHERE id = ?`,
    )
    .run(
      input.slug,
      input.name,
      JSON.stringify(input.allowed_origins),
      input.issue_provider,
      input.issue_project,
      input.issue_default_labels,
      input.issue_anonymize ? 1 : 0,
      input.widget_color ?? null, // absent: keep the current color
      id,
    );
  return info.changes > 0 ? getAppById(db, id) : undefined;
}

export function regenerateApiKey(db: DB, id: number): App | undefined {
  const info = db.prepare('UPDATE apps SET api_key = ? WHERE id = ?').run(generateApiKey(), id);
  return info.changes > 0 ? getAppById(db, id) : undefined;
}

export function deleteApp(db: DB, id: number): boolean {
  return db.prepare('DELETE FROM apps WHERE id = ?').run(id).changes > 0;
}

export function countReportsForApp(db: DB, appId: number): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM bug_reports WHERE app_id = ?').get(appId) as { n: number };
  return row.n;
}

/** True if `origin` is allowed by at least one application (used for CORS preflight). */
export function isOriginAllowedByAnyApp(db: DB, origin: string): boolean {
  const rows = db.prepare('SELECT allowed_origins FROM apps').all() as { allowed_origins: string }[];
  return rows.some((r) => {
    try {
      const list: unknown = JSON.parse(r.allowed_origins);
      return Array.isArray(list) && list.includes(origin);
    } catch {
      return false;
    }
  });
}
