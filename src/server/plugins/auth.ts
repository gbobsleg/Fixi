import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from '../context.js';
import {
  deleteExpiredSessions,
  SESSION_TTL_MS,
  touchSession,
} from '../repositories/sessions.js';

export const SESSION_COOKIE = 'fixi_sid';
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/** Paths that stay reachable without a session. */
const PUBLIC_ADMIN_PATHS = new Set(['/admin/login', '/api/admin/login', '/api/admin/logout']);

export function pathOf(req: FastifyRequest): string {
  const i = req.url.indexOf('?');
  const path = i === -1 ? req.url : req.url.slice(0, i);
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

export function isAdminPath(path: string): boolean {
  return path === '/admin' || path.startsWith('/admin/') || path.startsWith('/api/admin/');
}

export function setSessionCookie(ctx: AppContext, reply: FastifyReply, sessionId: string): void {
  reply.setCookie(SESSION_COOKIE, sessionId, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: ctx.config.nodeEnv === 'production',
    signed: true,
    maxAge: SESSION_TTL_MS / 1000,
  });
}

/** Returns the valid session id of the request, or null. Extends the session when valid. */
export function readSession(ctx: AppContext, req: FastifyRequest): string | null {
  const raw = req.cookies[SESSION_COOKIE];
  if (!raw) return null;
  const unsigned = req.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) return null;
  return touchSession(ctx.db, unsigned.value) ? unsigned.value : null;
}

/**
 * Protects /admin/* and /api/admin/* (except the login endpoints).
 * Registered directly on the root instance so the hook applies to every route.
 */
export function registerAuth(app: FastifyInstance, ctx: AppContext): void {
  app.addHook('onRequest', async (req, reply) => {
    const path = pathOf(req);
    if (!isAdminPath(path) || PUBLIC_ADMIN_PATHS.has(path)) return;

    const sessionId = readSession(ctx, req);
    if (sessionId) {
      setSessionCookie(ctx, reply, sessionId); // keep the cookie in sync with the sliding session
      return;
    }
    if (path.startsWith('/api/')) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    return reply.redirect('/admin/login');
  });

  // Housekeeping: drop expired sessions at startup and every hour.
  let timer: NodeJS.Timeout | undefined;
  app.addHook('onReady', async () => {
    deleteExpiredSessions(ctx.db);
    timer = setInterval(() => deleteExpiredSessions(ctx.db), CLEANUP_INTERVAL_MS);
    timer.unref();
  });
  app.addHook('onClose', async () => {
    if (timer) clearInterval(timer);
  });
}
