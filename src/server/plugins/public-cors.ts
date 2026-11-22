import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { isOriginAllowedByAnyApp } from '../repositories/apps.js';
import { pathOf } from './auth.js';

const REPORTS_PATH = '/api/reports';

/**
 * CORS for POST /api/reports. The Origin is echoed back only if at least one application lists it;
 * the strict check (origin <-> the application named in the payload) happens in the route.
 */
export function registerPublicCors(app: FastifyInstance, ctx: AppContext): void {
  // Preflight: answered here, before routing.
  app.addHook('onRequest', async (req, reply) => {
    if (req.method === 'OPTIONS' && pathOf(req) === REPORTS_PATH) {
      return reply.code(204).send();
    }
  });

  // Headers are added on every response (including errors), so the widget can read 401/403/413 bodies.
  app.addHook('onSend', async (req, reply, payload) => {
    if (pathOf(req) !== REPORTS_PATH) return payload;
    reply.header('Vary', 'Origin');
    const origin = req.headers.origin;
    if (origin && isOriginAllowedByAnyApp(ctx.db, origin)) {
      reply.header('Access-Control-Allow-Origin', origin);
      if (req.method === 'OPTIONS') {
        reply.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
        reply.header('Access-Control-Allow-Headers', 'Content-Type');
        reply.header('Access-Control-Max-Age', '600');
      }
    }
    return payload;
  });
}
