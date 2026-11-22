import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import {
  countReportsForApp,
  createApp,
  deleteApp,
  getAppById,
  listApps,
  regenerateApiKey,
  updateApp,
} from '../../repositories/apps.js';
import { appInputSchema } from '../../schemas.js';

const idParams = z.object({ id: z.coerce.number().int().positive() });

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE';
}

export function registerAdminAppRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db } = ctx;

  app.get('/api/admin/apps', async () => ({ apps: listApps(db) }));

  app.get('/api/admin/apps/:id', async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const found = getAppById(db, id);
    if (!found) return reply.code(404).send({ error: 'not_found' });
    return { app: found };
  });

  app.post('/api/admin/apps', async (req, reply) => {
    const input = appInputSchema.parse(req.body);
    try {
      return reply.code(201).send({ app: createApp(db, input) });
    } catch (err) {
      if (isUniqueViolation(err)) return reply.code(409).send({ error: 'slug_already_used' });
      throw err;
    }
  });

  app.put('/api/admin/apps/:id', async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const input = appInputSchema.parse(req.body);
    try {
      const updated = updateApp(db, id, input);
      if (!updated) return reply.code(404).send({ error: 'not_found' });
      return { app: updated };
    } catch (err) {
      if (isUniqueViolation(err)) return reply.code(409).send({ error: 'slug_already_used' });
      throw err;
    }
  });

  app.post('/api/admin/apps/:id/regenerate-key', async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const updated = regenerateApiKey(db, id);
    if (!updated) return reply.code(404).send({ error: 'not_found' });
    return { app: updated };
  });

  app.delete('/api/admin/apps/:id', async (req, reply) => {
    const { id } = idParams.parse(req.params);
    if (!getAppById(db, id)) return reply.code(404).send({ error: 'not_found' });
    if (countReportsForApp(db, id) > 0) {
      return reply.code(409).send({ error: 'app_has_reports', message: 'Cette application a des signalements.' });
    }
    deleteApp(db, id);
    return reply.code(204).send();
  });
}
