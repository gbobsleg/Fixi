import type { AppContext } from '../context.js';
import type { App } from '../repositories/apps.js';
import { getReportById, listChildren, type ReportRow } from '../repositories/reports.js';
import type { ActionResult } from './issue-actions.js';
import { formatDateTime } from './markdown.js';

export const NOTIFIABLE_STATUSES = ['resolved', 'rejected'] as const;

export interface Recipient {
  /** Lowercased. */
  email: string;
  /** Creation date of the earliest report of this person (used for {{date}}). */
  reported_at: string;
}

/** The parent's and every duplicate's e-mail, lowercased and deduplicated ("A@x.fr" and "a@x.fr" are one). */
export function collectRecipients(report: ReportRow, children: ReportRow[]): Recipient[] {
  const byEmail = new Map<string, Recipient>();
  for (const r of [report, ...children]) {
    const email = r.user_email?.trim().toLowerCase();
    if (!email) continue;
    const known = byEmail.get(email);
    if (!known || r.created_at < known.reported_at) byEmail.set(email, { email, reported_at: r.created_at });
  }
  return [...byEmail.values()];
}

export interface NotifyForm {
  /** False for a duplicate (notify from its parent) or a ticket that is not closed yet. */
  can_notify: boolean;
  reason: string | null;
  recipients: string[];
  subject: string;
  message: string;
  /** Display label of the last notification ("2026-11-22 14:03:00"), or null. */
  last_notified_label: string | null;
}

export function buildNotifyForm(
  ctx: AppContext,
  report: ReportRow,
  children: ReportRow[],
  app: App,
): NotifyForm {
  const recipients = collectRecipients(report, children).map((r) => r.email);
  let reason: string | null = null;
  if (report.parent_id !== null) reason = 'Ce signalement est un doublon : notifiez depuis le signalement parent.';
  else if (!(NOTIFIABLE_STATUSES as readonly string[]).includes(report.status)) {
    reason = 'Disponible quand le statut est « Résolu » ou « Non retenu ».';
  } else if (recipients.length === 0) reason = "Aucune adresse e-mail n'a été renseignée sur ce signalement.";

  const resolved = report.status !== 'rejected';
  return {
    can_notify: reason === null,
    reason,
    recipients,
    subject: resolved
      ? `[Fixi] Votre signalement sur ${app.name} a été traité`
      : `[Fixi] Votre signalement sur ${app.name} n'a pas été retenu`,
    // {{date}} is replaced, for each recipient, by the date of their own report.
    message: resolved
      ? `Bonjour,\n\nle problème que vous avez signalé le {{date}} sur ${app.name} a été corrigé.\n\nMerci pour votre retour.`
      : `Bonjour,\n\nvotre signalement du {{date}} sur ${app.name} n'a pas été retenu.\n\nMerci pour votre retour.`,
    last_notified_label: report.last_notified_at
      ? formatDateTime(report.last_notified_at, ctx.config.displayTimezone)
      : null,
  };
}

export interface NotifyOutcome {
  /** Number of e-mails that left. */
  sent: number;
  failed: { email: string; error: string }[];
  last_notified_label: string | null;
}

function formatDay(iso: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('fr-FR', {
      timeZone: timezone,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/**
 * Sends one e-mail per recipient (nobody sees the others' address).
 * `last_notified_at` is only set when at least one e-mail left.
 */
export async function notifyReport(
  ctx: AppContext,
  id: number,
  input: { subject: string; message: string },
): Promise<ActionResult<NotifyOutcome>> {
  const { db, config } = ctx;
  const report = getReportById(db, id);
  if (!report) return { ok: false, status: 404, error: 'not_found', message: 'Signalement introuvable.' };
  if (report.parent_id !== null) {
    return {
      ok: false,
      status: 409,
      error: 'report_is_duplicate',
      message: 'Ce signalement est un doublon : notifiez depuis le signalement parent.',
    };
  }
  if (!(NOTIFIABLE_STATUSES as readonly string[]).includes(report.status)) {
    return {
      ok: false,
      status: 409,
      error: 'status_not_notifiable',
      message: 'Notification possible uniquement pour un signalement « Résolu » ou « Non retenu ».',
    };
  }

  const children = listChildren(db, id);
  const recipients = collectRecipients(report, children);
  if (recipients.length === 0) {
    return { ok: false, status: 400, error: 'no_recipients', message: "Aucune adresse e-mail à notifier." };
  }

  let sent = 0;
  const failed: NotifyOutcome['failed'] = [];
  for (const recipient of recipients) {
    const text = input.message.replace(
      /\{\{\s*date\s*\}\}/g,
      formatDay(recipient.reported_at, config.displayTimezone),
    );
    try {
      await ctx.mailer.sendMail({ to: recipient.email, subject: input.subject, text });
      sent++;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      failed.push({ email: recipient.email, error: error.slice(0, 200) });
    }
  }

  let lastNotifiedAt = report.last_notified_at;
  if (sent > 0) {
    lastNotifiedAt = new Date().toISOString();
    // Parent and every duplicate. Not touched at all when every e-mail failed.
    db.prepare('UPDATE bug_reports SET last_notified_at = ? WHERE id = ? OR parent_id = ?').run(
      lastNotifiedAt,
      id,
      id,
    );
  }
  return {
    ok: true,
    sent,
    failed,
    last_notified_label: lastNotifiedAt ? formatDateTime(lastNotifiedAt, config.displayTimezone) : null,
  };
}
