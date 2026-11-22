import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { isAdminPath, pathOf } from './auth.js';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * CSRF defense in depth (on top of SameSite=Lax): a state-changing admin request carrying an
 * `Origin` header that is not Fixi's own origin is refused.
 */
export function registerAdminOriginCheck(app: FastifyInstance, ctx: AppContext): void {
  const ownOrigin = new URL(ctx.config.appBaseUrl).origin;
  app.addHook('onRequest', async (req, reply) => {
    if (!UNSAFE_METHODS.has(req.method) || !isAdminPath(pathOf(req))) return;
    const origin = req.headers.origin;
    if (origin && origin !== ownOrigin) {
      return reply.code(403).send({ error: 'origin_not_allowed' });
    }
  });
}
