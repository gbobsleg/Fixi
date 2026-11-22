import type { TimelineEvent } from '../../shared/types.js';
import type { AppContext } from '../context.js';
import type { DB } from '../db/index.js';
import { getAppById, type App } from '../repositories/apps.js';
import {
  countChildren,
  getReportById,
  listChildren,
  updateReport,
  type ReportRow,
  type ReportUpdate,
} from '../repositories/reports.js';
import type { z } from 'zod';
import type { reportPatchSchema } from '../schemas.js';
import { buildIssueForm } from './issue-actions.js';
import { buildReportMarkdown } from './markdown.js';
import { buildNotifyForm } from './notify-actions.js';

export type ReportPatch = z.infer<typeof reportPatchSchema>;

export interface IssueLink {
  provider: string | null;
  number: number | null;
  url: string;
  /** True when the link comes from the parent ticket. */
  inherited: boolean;
}

export type ReportDetail = NonNullable<ReturnType<typeof buildReportDetail>>;

function parseTimeline(json: string): TimelineEvent[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as TimelineEvent[]) : [];
  } catch {
    return [];
  }
}

function issueOf(row: ReportRow, inherited: boolean): IssueLink | null {
  return row.issue_url
    ? { provider: row.issue_provider, number: row.issue_number, url: row.issue_url, inherited }
    : null;
}

/** The API key is never exposed in the report detail. */
function publicApp(app: App): Omit<App, 'api_key'> {
  const { api_key: _apiKey, ...rest } = app;
  return rest;
}

export function buildReportDetail(ctx: AppContext, id: number) {
  const row = getReportById(ctx.db, id);
  if (!row) return undefined;
  const app = getAppById(ctx.db, row.app_id)!;

  const parent = row.parent_id ? getReportById(ctx.db, row.parent_id) : undefined;
  const children = listChildren(ctx.db, row.id);
  const fixiLink = `${ctx.config.appBaseUrl}/admin/reports/${row.id}`;

  // The copied Markdown is meant for Cursor (internal use): it is never anonymized.
  const markdown = buildReportMarkdown(row, children, {
    app,
    anonymize: false,
    fixiLink,
    timezone: ctx.config.displayTimezone,
  });

  const { timeline_json, ...report } = row;
  return {
    report: { ...report, timeline: parseTimeline(timeline_json) },
    app: publicApp(app),
    parent: parent
      ? {
          id: parent.id,
          comment: parent.comment,
          status: parent.status,
          user_info: parent.user_info,
          created_at: parent.created_at,
        }
      : null,
    children,
    issue: issueOf(row, false) ?? (parent ? issueOf(parent, true) : null),
    issue_form: buildIssueForm(ctx, row, app),
    notify_form: buildNotifyForm(ctx, row, children, app),
    markdown,
  };
}

export type PatchResult =
  | { ok: true }
  | { ok: false; status: number; error: string; message: string };

const fail = (status: number, error: string, message: string): PatchResult => ({
  ok: false,
  status,
  error,
  message,
});

/** Attachment rules: one level only, same application, never a ticket onto itself. */
function checkAttach(db: DB, report: ReportRow, targetId: number): PatchResult {
  if (targetId === report.id) {
    return fail(409, 'parent_is_self', 'Un signalement ne peut pas être son propre doublon.');
  }
  const target = getReportById(db, targetId);
  if (!target) return fail(404, 'parent_not_found', 'Le signalement cible est introuvable.');
  if (target.app_id !== report.app_id) {
    return fail(409, 'parent_other_app', 'Le signalement cible appartient à une autre application.');
  }
  if (target.parent_id !== null) {
    return fail(409, 'parent_is_child', 'Le signalement cible est déjà un doublon : un seul niveau est autorisé.');
  }
  if (countChildren(db, report.id) > 0) {
    return fail(409, 'report_has_children', 'Ce signalement a déjà des doublons rattachés : il ne peut pas en devenir un.');
  }
  return { ok: true };
}

/**
 * Applies a PATCH on a report, all-or-nothing.
 * Order: parent (attach/detach), then status, then notes and issue link.
 */
export function applyReportPatch(db: DB, id: number, patch: ReportPatch): PatchResult {
  const report = getReportById(db, id);
  if (!report) return fail(404, 'not_found', 'Signalement introuvable.');

  const changes: ReportUpdate = {};
  let isChild = report.parent_id !== null;

  if (patch.parent_id !== undefined) {
    if (patch.parent_id === null) {
      if (isChild) {
        changes.parent_id = null;
        changes.status = 'new'; // a detached duplicate goes back to triage
        isChild = false;
      }
    } else {
      if (patch.status !== undefined && patch.status !== 'duplicate') {
        return fail(400, 'status_conflict', 'Le rattachement impose le statut « Doublon ».');
      }
      const check = checkAttach(db, report, patch.parent_id);
      if (!check.ok) return check;
      changes.parent_id = patch.parent_id;
      changes.status = 'duplicate';
      isChild = true;
    }
  }

  if (patch.status !== undefined && patch.parent_id === undefined) {
    if (isChild && patch.status !== 'duplicate') {
      return fail(409, 'child_status_locked', 'Le statut d\'un doublon suit celui de son parent : détachez-le d\'abord.');
    }
    if (!isChild && patch.status === 'duplicate') {
      return fail(409, 'duplicate_needs_parent', 'Pour passer en « Doublon », rattachez le signalement à un parent.');
    }
    changes.status = patch.status;
  } else if (patch.status !== undefined && patch.parent_id === null) {
    // Detach + explicit status in the same request: the explicit status wins.
    if (patch.status === 'duplicate') {
      return fail(409, 'duplicate_needs_parent', 'Pour passer en « Doublon », rattachez le signalement à un parent.');
    }
    changes.status = patch.status;
  }

  if (patch.admin_notes !== undefined) changes.admin_notes = patch.admin_notes;

  if (patch.issue_url !== undefined) {
    if (isChild) {
      return fail(409, 'child_issue_locked', 'Un doublon affiche l\'issue de son parent : liez l\'issue au parent.');
    }
    changes.issue_url = patch.issue_url;
    changes.issue_provider = null; // a manual link has no provider
    changes.issue_number = null;
    if (patch.issue_url !== null && patch.status === undefined) changes.status = 'sent';
  }

  db.transaction(() => updateReport(db, id, changes))();
  return { ok: true };
}
