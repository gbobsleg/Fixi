import type { AppContext } from '../context.js';
import { getAppById } from '../repositories/apps.js';
import { getReportById } from '../repositories/reports.js';

const CATEGORY_LABELS = { bug: 'Bug', blocking: 'Bloquant', suggestion: 'Suggestion' } as const;

/**
 * Sends the admin alert for a freshly received report (only when ADMIN_ALERT_EMAIL is set).
 * The caller runs it in the background and logs any rejection: it must never fail the request.
 */
export async function notifyNewReport(ctx: AppContext, reportId: number): Promise<void> {
  const to = ctx.config.adminAlertEmail;
  if (!to) return;
  const report = getReportById(ctx.db, reportId);
  if (!report) return;
  const app = getAppById(ctx.db, report.app_id);
  if (!app) return;

  const category = CATEGORY_LABELS[report.category];
  const anomalies: string[] = [];
  if (report.has_http_error) {
    anomalies.push(report.max_http_status !== null && report.max_http_status >= 500 ? 'HTTP 5xx' : 'HTTP 4xx');
  }
  if (report.has_js_error) anomalies.push('JS Error');

  const flat = report.comment.replace(/\s+/g, ' ').trim();
  const excerpt = flat.length > 200 ? `${flat.slice(0, 200)}…` : flat;

  // Only fixed values go in the subject: user-provided text stays in the body.
  await ctx.mailer.sendMail({
    to,
    subject: `[Fixi][${category}] ${app.slug} — nouveau signalement #${report.id}`,
    text: [
      `Application : ${app.name} (${app.slug})`,
      `Catégorie : ${category}`,
      `Utilisateur : ${report.user_info || 'inconnu'}${report.user_email ? ` — ${report.user_email}` : ''}`,
      `Commentaire : ${excerpt || '(capture seule)'}`,
      `Anomalies : ${anomalies.length ? anomalies.join(', ') : 'aucune'}`,
      '',
      `Fiche : ${ctx.config.appBaseUrl}/admin/reports/${report.id}`,
    ].join('\n'),
  });
}
