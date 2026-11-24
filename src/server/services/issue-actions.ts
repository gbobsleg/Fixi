import type { TimelineEvent } from '../../shared/types.js';
import type { AppContext } from '../context.js';
import type { DB } from '../db/index.js';
import { getAppById, type App } from '../repositories/apps.js';
import { getReportById, listChildren, updateReport, type ReportRow } from '../repositories/reports.js';
import { buildReportMarkdown } from './markdown.js';
import {
  createTracker,
  isTrackerConfigured,
  TrackerConfigError,
  TrackerError,
  type IssueFile,
} from './trackers/index.js';

const ZERO_WIDTH_SPACE = '​';

const CATEGORY_LABELS = { bug: 'Bug', blocking: 'Bloquant', suggestion: 'Suggestion' } as const;

/**
 * Breaks every "@mention" of user-provided text: "@" followed by a zero-width space no longer
 * notifies anybody (a comment containing "@all" would otherwise ping the whole project).
 * Apply it once only.
 */
export function neutralizeMentions(text: string): string {
  return text.replace(/@/g, `@${ZERO_WIDTH_SPACE}`);
}

function excerpt(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

export function defaultLabels(app: App): string[] {
  return (app.issue_default_labels ?? '')
    .split(',')
    .map((l) => l.trim())
    .filter(Boolean);
}

/** What the "Créer l'issue" modal needs: availability, and the pre-filled title and labels. */
export interface IssueForm {
  provider: App['issue_provider'];
  can_create: boolean;
  /** Why the issue cannot be created (shown instead of the button), or null. */
  reason: string | null;
  title: string;
  labels: string[];
  anonymize: boolean;
}

export function buildIssueForm(ctx: AppContext, report: ReportRow, app: App): IssueForm {
  const title = neutralizeMentions(
    `[Fixi][${CATEGORY_LABELS[report.category]}] ${app.name} #${report.id} — ${
      excerpt(report.comment, 80) || '(capture seule)'
    }`,
  );
  let reason: string | null = null;
  if (report.parent_id !== null) reason = "Ce signalement est un doublon : créez le ticket depuis le signalement parent.";
  else if (!app.issue_provider) reason = "Aucun outil de tickets n'est configuré pour cette application (page Paramètres).";
  else if (!app.issue_project) reason = "Le projet de l'outil de tickets est vide (page Paramètres).";
  else if (!isTrackerConfigured(app.issue_provider, ctx.config)) {
    reason =
      app.issue_provider === 'gitlab'
        ? 'GITLAB_URL ou GITLAB_TOKEN manque dans la configuration du serveur.'
        : 'GITHUB_TOKEN manque dans la configuration du serveur.';
  }
  return {
    provider: app.issue_provider,
    can_create: reason === null,
    reason,
    title,
    labels: defaultLabels(app),
    anonymize: app.issue_anonymize,
  };
}

export type ActionResult<T = object> =
  | ({ ok: true } & T)
  | { ok: false; status: number; error: string; message: string };

const fail = (status: number, error: string, message: string): ActionResult<never> => ({
  ok: false,
  status,
  error,
  message,
});

/** Reports whose issue creation is running: blocks a double click while the tracker call is pending. */
const inFlight = new WeakMap<DB, Set<number>>();

/** Copy of the report whose user-provided texts cannot ping anybody on the tracker. */
function withNeutralizedMentions(report: ReportRow): ReportRow {
  let timeline: TimelineEvent[] = [];
  try {
    const parsed: unknown = JSON.parse(report.timeline_json);
    if (Array.isArray(parsed)) timeline = parsed as TimelineEvent[];
  } catch {
    timeline = [];
  }
  const cleaned = timeline.map((e) => (e.type === 'click' && e.text ? { ...e, text: neutralizeMentions(e.text) } : e));
  return {
    ...report,
    comment: neutralizeMentions(report.comment),
    user_info: neutralizeMentions(report.user_info),
    timeline_json: JSON.stringify(cleaned),
  };
}

async function filesFor(ctx: AppContext, report: ReportRow): Promise<IssueFile[]> {
  const files: IssueFile[] = [];
  if (report.screenshot_path && (await ctx.storage.exists(report.screenshot_path))) {
    files.push({
      path: ctx.storage.pathFor(report.screenshot_path)!,
      name: `capture-${report.id}.png`,
      mime: 'image/png',
    });
  }
  if (report.attachment_path && (await ctx.storage.exists(report.attachment_path))) {
    files.push({
      path: ctx.storage.pathFor(report.attachment_path)!,
      name: report.attachment_original_name ?? report.attachment_path,
      mime: report.attachment_mime ?? 'application/octet-stream',
    });
  }
  return files;
}

export async function createIssueForReport(
  ctx: AppContext,
  id: number,
  input: { title: string; labels: string[] },
): Promise<ActionResult> {
  const { db, config } = ctx;
  const report = getReportById(db, id);
  if (!report) return fail(404, 'not_found', 'Signalement introuvable.');

  // Anti-duplicate lock: one issue per ticket, and never from a duplicate.
  if (report.parent_id !== null) {
    return fail(409, 'report_is_duplicate', "Ce signalement est un doublon : créez le ticket depuis son parent.");
  }
  if (report.issue_url) {
    return fail(409, 'issue_already_linked', 'Un ticket est déjà lié à ce signalement.');
  }

  const app = getAppById(db, report.app_id)!;
  if (!app.issue_provider || !app.issue_project) {
    return fail(400, 'no_issue_tracker', "Aucun outil de tickets n'est configuré pour cette application.");
  }

  const pending = inFlight.get(db) ?? new Set<number>();
  inFlight.set(db, pending);
  if (pending.has(id)) return fail(409, 'issue_in_progress', 'Création du ticket déjà en cours.');
  pending.add(id);

  try {
    const tracker = createTracker(app.issue_provider, config);
    const fixiLink = `${config.appBaseUrl}/admin/reports/${id}`;
    const anonymize = app.issue_anonymize;

    let body = buildReportMarkdown(withNeutralizedMentions(report), listChildren(db, id), {
      app,
      anonymize,
      fixiLink,
      timezone: config.displayTimezone,
    });
    if (app.issue_provider === 'github') {
      // GitHub cannot host files: the body points to the Fixi ticket instead.
      body += `\n---\nCapture et pièce jointe disponibles dans Fixi : ${fixiLink}\n`;
    }

    // The screenshot may show names: with anonymization nothing is uploaded.
    const files = anonymize ? [] : await filesFor(ctx, report);
    const issue = await tracker.createIssue({
      project: app.issue_project,
      title: input.title,
      body,
      labels: input.labels,
      files,
    });

    // One transaction: provider, number, URL and status move together.
    db.transaction(() =>
      updateReport(db, id, {
        issue_provider: app.issue_provider,
        issue_number: issue.number,
        issue_url: issue.url,
        status: 'sent',
      }),
    )();
    return { ok: true };
  } catch (err) {
    // Nothing was written to the database: the ticket stays as it was.
    if (err instanceof TrackerConfigError) return fail(400, 'tracker_not_configured', err.message);
    if (err instanceof TrackerError) return fail(502, 'tracker_error', err.message);
    throw err;
  } finally {
    pending.delete(id);
  }
}
