import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import fastifyView from '@fastify/view';
import { Eta } from 'eta';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import type { Config } from './config.js';
import type { AppContext } from './context.js';
import { openDatabase, type DB } from './db/index.js';
import { registerAdminOriginCheck } from './plugins/admin-origin-check.js';
import { registerAuth } from './plugins/auth.js';
import { registerPublicCors } from './plugins/public-cors.js';
import { registerSecurityHeaders } from './plugins/security-headers.js';
import { registerAdminAppRoutes } from './routes/admin/apps.js';
import { registerAdminAuthRoutes } from './routes/admin/auth.js';
import { registerAdminFileRoutes } from './routes/admin/files.js';
import { registerAdminPages } from './routes/admin/pages.js';
import { registerAdminReportRoutes } from './routes/admin/reports.js';
import { registerReportRoutes } from './routes/public/reports.js';
import { registerWidgetRoute } from './routes/public/widget.js';
import { LIMITS } from '../shared/types.js';
import { createMailer, type Mailer } from './services/mailer.js';
import { StorageService } from './services/storage.js';

export interface BuildAppOptions {
  config: Config;
  /** Provide an already opened database (tests use ':memory:'); otherwise it is opened from the config. */
  db?: DB;
  /** Replace the SMTP mailer (tests); otherwise it is built from the SMTP_* configuration. */
  mailer?: Mailer;
}

export async function buildApp({ config, db, mailer }: BuildAppOptions): Promise<FastifyInstance> {
  const database = db ?? openDatabase(config.databasePath);
  const app = Fastify({
    logger: config.nodeEnv === 'test' ? false : { level: 'info' },
    trustProxy: config.trustProxy,
  });

  const ctx: AppContext = {
    config,
    db: database,
    storage: new StorageService(config.storageDir),
    mailer: mailer ?? createMailer(config.smtp, app.log),
  };

  app.setErrorHandler((error: unknown, req, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: 'validation_error',
        issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const err = error as { statusCode?: number; code?: string; message?: string };
    const status = err.statusCode ?? 500;
    if (status >= 500) {
      req.log.error({ err: error }, 'unhandled error');
      return reply.code(500).send({ error: 'internal_error' });
    }
    return reply.code(status).send({ error: err.code ?? 'error', message: err.message });
  });

  await app.register(cookie, { secret: config.sessionSecret });
  await app.register(rateLimit, { global: false });
  await app.register(multipart, {
    limits: { fileSize: LIMITS.maxFileBytes, files: 3, fields: 5, fieldSize: 512 * 1024 },
  });

  // Admin pages: Eta templates (auto-escaped with <%= %>) and static assets, both next to this file
  // so the same relative URLs work from src/ (dev) and dist/ (build copies them, see scripts/copy-assets.mjs).
  const viewsDir = fileURLToPath(new URL('./views', import.meta.url));
  await app.register(fastifyView, {
    engine: { eta: new Eta({ views: viewsDir, cache: config.nodeEnv === 'production' }) },
    templates: viewsDir,
    layout: 'layout.eta',
  });
  await app.register(fastifyStatic, {
    root: fileURLToPath(new URL('./public', import.meta.url)),
    prefix: '/public/',
    maxAge: config.nodeEnv === 'production' ? '1h' : 0,
  });

  // Hooks run in registration order: CSRF check, public CORS, then authentication.
  registerAdminOriginCheck(app, ctx);
  registerPublicCors(app, ctx);
  registerAuth(app, ctx);
  registerSecurityHeaders(app);

  app.get('/healthz', async (_req, reply) => {
    try {
      ctx.db.prepare('SELECT 1').get();
      return { ok: true };
    } catch {
      return reply.code(503).send({ ok: false });
    }
  });

  registerWidgetRoute(app);
  registerReportRoutes(app, ctx);
  registerAdminAuthRoutes(app, ctx);
  registerAdminAppRoutes(app, ctx);
  registerAdminFileRoutes(app, ctx);
  registerAdminReportRoutes(app, ctx);
  registerAdminPages(app, ctx);

  return app;
}

export type { AppContext };
