import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { CATEGORIES, STATUSES } from '../../../shared/types.js';
import type { AppContext } from '../../context.js';
import { readSession } from '../../plugins/auth.js';
import { getAppBySlug, listApps } from '../../repositories/apps.js';
import { listReports } from '../../repositories/reports.js';
import { PROJECT_ROOT } from '../../paths.js';
import { reportListQuerySchema } from '../../schemas.js';
import { formatDateTime } from '../../services/markdown.js';
import { buildReportDetail } from '../../services/report-admin.js';
import { describeUserAgent } from '../../services/user-agent.js';

const ALPINE_PATH = resolve(PROJECT_ROOT, 'node_modules/alpinejs/dist/cdn.min.js');

export const STATUS_LABELS: Record<string, string> = {
  new: 'Nouveau',
  in_progress: 'En cours',
  sent: 'Envoyé tracker',
  resolved: 'Résolu',
  rejected: 'Non retenu',
  duplicate: 'Doublon',
};

export const CATEGORY_LABELS: Record<string, string> = {
  bug: 'Bug',
  blocking: 'Bloquant',
  suggestion: 'Suggestion',
};

function excerpt(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** Query string built from the non-empty values (used by pagination links). */
function queryString(values: Record<string, string | number | boolean | undefined>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined || v === false || v === '') continue;
    params.set(k, v === true ? '1' : String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

const idParams = z.object({ id: z.coerce.number().int().positive() });

export function registerAdminPages(app: FastifyInstance, ctx: AppContext): void {
  const { db, config } = ctx;

  /** Data and helpers available in every template. Never put raw HTML in here. */
  const common = {
    statusLabels: STATUS_LABELS,
    categoryLabels: CATEGORY_LABELS,
    statuses: STATUSES,
    categories: CATEGORIES,
    fmt: (iso: string | null) => (iso ? formatDateTime(iso, config.displayTimezone) : ''),
    excerpt,
    describeUserAgent,
    appBaseUrl: config.appBaseUrl,
    adminUser: config.adminUser,
  };

  /** Fixi's own widget, only if an app `fixi` exists and allows this server's origin (else every send would be a 403). */
  const selfWidget = () => {
    const self = getAppBySlug(db, 'fixi');
    const origin = new URL(config.appBaseUrl).origin;
    return self && self.allowed_origins.includes(origin) ? { app: 'fixi', apiKey: self.api_key } : null;
  };

  const render = (reply: FastifyReply, template: string, data: Record<string, unknown>) =>
    reply.view(template, { ...common, nav: true, selfWidget: selfWidget(), ...data });

  // Alpine is served straight from node_modules: it works in `npm run dev` without any build step.
  let alpine: Buffer | undefined;
  app.get('/public/vendor/alpine.min.js', async (_req, reply) => {
    try {
      alpine ??= await readFile(ALPINE_PATH);
    } catch {
      return reply.code(404).send({ error: 'not_found' });
    }
    return reply
      .header('Content-Type', 'application/javascript; charset=utf-8')
      .header('Cache-Control', 'public, max-age=86400')
      .send(alpine);
  });

  app.get('/admin/login', async (req, reply) => {
    if (readSession(ctx, req)) return reply.redirect('/admin');
    return render(reply, 'login.eta', { nav: false, title: 'Connexion' });
  });

  app.get('/admin', async (req, reply) => {
    // An invalid query string falls back to the default list instead of an error page.
    const parsed = reportListQuerySchema.safeParse(req.query);
    const filters = parsed.success ? parsed.data : reportListQuerySchema.parse({});
    const result = listReports(db, filters);

    const base = {
      app_id: filters.app_id,
      status: filters.status,
      category: filters.category,
      q: filters.q,
      include_duplicates: filters.include_duplicates,
    };
    return render(reply, 'reports-list.eta', {
      title: 'Signalements',
      active: 'reports',
      apps: listApps(db),
      filters,
      result,
      pageUrl: (page: number) => `/admin${queryString({ ...base, page: page > 1 ? page : undefined })}`,
    });
  });

  app.get('/admin/reports/:id', async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const detail = buildReportDetail(ctx, id);
    if (!detail) {
      return reply.code(404).view('error.eta', {
        ...common,
        nav: true,
        active: 'reports',
        title: 'Introuvable',
        message: `Le signalement #${id} n'existe pas.`,
      });
    }
    return render(reply, 'report-detail.eta', { title: `Signalement #${id}`, active: 'reports', ...detail });
  });

  app.get('/admin/settings', async (_req, reply) =>
    render(reply, 'settings.eta', { title: 'Paramètres', active: 'settings' }),
  );
}
