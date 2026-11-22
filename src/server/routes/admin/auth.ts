import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../context.js';
import { SESSION_COOKIE, setSessionCookie } from '../../plugins/auth.js';
import { createSession, deleteSession } from '../../repositories/sessions.js';
import { safeEqual } from '../../security.js';
import { loginSchema } from '../../schemas.js';

export function registerAdminAuthRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post(
    '/api/admin/login',
    { config: { rateLimit: { max: ctx.config.rateLimit.loginPerMin, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { username, password } = loginSchema.parse(req.body);

      // Always run bcrypt, even when the username is wrong, so timing does not reveal valid usernames.
      const passwordOk = await bcrypt.compare(password, ctx.config.adminPasswordHash);
      const userOk = safeEqual(username, ctx.config.adminUser);
      if (!passwordOk || !userOk) {
        return reply.code(401).send({ error: 'invalid_credentials' });
      }

      setSessionCookie(ctx, reply, createSession(ctx.db));
      return { ok: true };
    },
  );

  app.post('/api/admin/logout', async (req, reply) => {
    const raw = req.cookies[SESSION_COOKIE];
    const unsigned = raw ? req.unsignCookie(raw) : undefined;
    if (unsigned?.valid && unsigned.value) deleteSession(ctx.db, unsigned.value);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  // The auth hook has already validated the session when this handler runs.
  app.get('/api/admin/me', async () => ({ user: ctx.config.adminUser }));
}
