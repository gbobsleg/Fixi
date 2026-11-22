import { STATUS_CODES } from 'node:http';
import type { Category, NavKind, TimelineEvent } from '../../shared/types.js';
import type { ReportRow } from '../repositories/reports.js';
import { describeUserAgent } from './user-agent.js';

export interface MarkdownOptions {
  app: { slug: string; name: string };
  /** Drops personal data (user, e-mail, payloads, response bodies, screenshot). */
  anonymize: boolean;
  /** Link to the Fixi ticket page. */
  fixiLink?: string;
  /** IANA timezone used to display dates. */
  timezone: string;
}

const CATEGORY_LABELS: Record<Category, string> = {
  bug: 'Bug',
  blocking: 'Bloquant',
  suggestion: 'Suggestion',
};

const NAV_LABELS: Record<NavKind, string> = {
  load: 'Chargement',
  push: 'Navigation (pushState)',
  replace: 'Navigation (replaceState)',
  pop: 'Navigation (retour/avance)',
  hash: 'Changement de hash',
};

/** Inline code span whose delimiter is longer than any backtick run of the content. */
function inlineCode(text: string): string {
  const flat = text.replace(/\s*\n\s*/g, ' ');
  const longest = Math.max(0, ...(flat.match(/`+/g) ?? []).map((m) => m.length));
  const fence = '`'.repeat(longest + 1);
  const pad = flat.startsWith('`') || flat.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${flat}${pad}${fence}`;
}

/** Fenced code block whose delimiter is longer than any backtick run of the content, indented. */
function codeBlock(text: string, indent: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((m) => m.length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  const lines = [fence, ...text.split(/\r?\n/), fence];
  return lines.map((l) => `${indent}${l}`).join('\n');
}

function stripQuery(url: string): string {
  const i = url.search(/[?#]/);
  return i === -1 ? url : url.slice(0, i);
}

/** "2026-11-20 14:32:10" in the given timezone. */
export function formatDateTime(iso: string, timezone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    // The Swedish locale formats dates as "YYYY-MM-DD HH:mm:ss".
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).format(date);
  } catch {
    return iso;
  }
}

/** "-18.4s", "0.0s", "+1.2s": seconds relative to the moment of the report. */
function relativeSeconds(t: number, base: number): string {
  const value = (t - base) / 1000;
  const text = value.toFixed(1);
  if (text === '0.0' || text === '-0.0') return '0.0s';
  return `${value > 0 ? '+' : ''}${text}s`;
}

function statusLabel(status: number): string {
  if (status === 0) return '**Erreur réseau**';
  const name = STATUS_CODES[status];
  return `**${status}${name ? ` ${name}` : ''}**`;
}

function parseTimeline(json: string): TimelineEvent[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as TimelineEvent[]) : [];
  } catch {
    return [];
  }
}

function eventLines(event: TimelineEvent, base: number, anonymize: boolean): string[] {
  const stamp = `\`[${relativeSeconds(event.t, base)}]\``;
  switch (event.type) {
    case 'nav': {
      const url = anonymize ? stripQuery(event.url) : event.url;
      return [`- ${stamp} **[NAV]** ${NAV_LABELS[event.kind] ?? event.kind} ${inlineCode(url)}`];
    }
    case 'click': {
      const text = !anonymize && event.text ? ` (${JSON.stringify(event.text)})` : '';
      return [`- ${stamp} **[CLICK]** ${inlineCode(event.selector)}${text}`];
    }
    case 'net': {
      const url = anonymize ? stripQuery(event.url) : event.url;
      const reqId = event.requestId ? ` ${inlineCode(`[X-Request-Id: ${event.requestId}]`)}` : '';
      const lines = [
        `- ${stamp} **[NET]** ${inlineCode(`${event.method} ${url}`)} -> ${statusLabel(event.status)} (${Math.round(event.durationMs)}ms)${reqId}`,
      ];
      if (!anonymize && event.requestBody) {
        lines.push('  - Payload:', codeBlock(event.requestBody, '    '));
      }
      if (!anonymize && event.responseBody) {
        lines.push('  - Response:', codeBlock(event.responseBody, '    '));
      }
      return lines;
    }
    case 'js_error': {
      const prefix = event.source === 'console' ? 'console.error: ' : '';
      const position = `${event.file ?? ''}${event.line !== undefined ? `:${event.line}` : ''}${event.col !== undefined ? `:${event.col}` : ''}`;
      const where = event.file ? ` at ${inlineCode(position)}` : '';
      return [`- ${stamp} **[JS_ERROR]** ${inlineCode(prefix + event.message)}${where}`];
    }
  }
}

/** Number of distinct reporters among a ticket and its duplicates (e-mail, else user_info). */
export function countReporters(report: ReportRow, children: ReportRow[]): number {
  const keys = new Set<string>();
  for (const r of [report, ...children]) {
    const identity = (r.user_email || r.user_info || '').trim().toLowerCase();
    keys.add(identity || `anonymous-${r.id}`);
  }
  return keys.size;
}

/**
 * Builds the "Cursor-Ready" report. The private `admin_notes` field is deliberately never read here.
 */
export function buildReportMarkdown(
  report: ReportRow,
  children: ReportRow[],
  options: MarkdownOptions,
): string {
  const { anonymize, app, fixiLink, timezone } = options;
  const category = CATEGORY_LABELS[report.category];
  const out: string[] = [];

  out.push(`# [Fixi] Bug Report - ${app.name} (#${report.id}) [${category}]`);

  const comment = report.comment.trim();
  if (!comment) {
    out.push("**Symptôme utilisateur :** *(aucun commentaire, voir la capture d'écran)*");
  } else if (comment.includes('\n')) {
    out.push('**Symptôme utilisateur :**', '', ...comment.split(/\r?\n/).map((l) => `> ${l}`));
  } else {
    out.push(`**Symptôme utilisateur :** "${comment}"`);
  }

  if (children.length > 0) {
    out.push(`*(Signalé par ${countReporters(report, children)} utilisateurs)*`);
  }

  out.push('', '## Contexte');
  out.push(
    `- **App :** ${app.slug}${report.app_version ? ` | **Version (Git) :** ${inlineCode(report.app_version)}` : ''}`,
  );
  out.push(`- **Catégorie :** ${category}`);
  out.push(`- **URL :** ${anonymize ? stripQuery(report.url) : report.url}`);
  if (!anonymize) {
    const who = [report.user_info, report.user_email].filter(Boolean).join(' — ');
    if (who) out.push(`- **Utilisateur :** ${who}`);
  }
  out.push(
    `- **Viewport :** ${report.viewport || 'inconnu'} | **UA :** ${describeUserAgent(report.user_agent)}`,
  );
  out.push(`- **Date :** ${formatDateTime(report.client_created_at, timezone)}`);
  if (fixiLink) out.push(`- **Fiche Fixi :** ${fixiLink}`);

  const base = Date.parse(report.client_created_at);
  const baseMs = Number.isNaN(base) ? Date.parse(report.created_at) : base;
  out.push('', '## Chronologie (dernières actions avant signalement)');
  for (const event of parseTimeline(report.timeline_json)) {
    out.push(...eventLines(event, baseMs, anonymize));
  }
  out.push('- `[0.0s]` **[REPORT]** Signalement déclenché');

  return `${out.join('\n')}\n`;
}
