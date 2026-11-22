import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { listReports } from '../../repositories/reports.js';
import { reportListQuerySchema, reportPatchSchema } from '../../schemas.js';
import { applyReportPatch, buildReportDetail } from '../../services/report-admin.js';

const idParams = z.object({ id: z.coerce.number().int().positive() });

export function registerAdminReportRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db } = ctx;

  app.get('/api/admin/reports', async (req) => {
    const query = reportListQuerySchema.parse(req.query);
    return listReports(db, query);
  });

  app.get('/api/admin/reports/:id', async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const detail = buildReportDetail(ctx, id);
    if (!detail) return reply.code(404).send({ error: 'not_found' });
    return detail;
  });

  app.patch('/api/admin/reports/:id', async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const patch = reportPatchSchema.parse(req.body);
    const result = applyReportPatch(db, id, patch);
    if (!result.ok) {
      return reply.code(result.status).send({ error: result.error, message: result.message });
    }
    return buildReportDetail(ctx, id);
  });
}
