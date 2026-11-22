import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { listReports } from '../../repositories/reports.js';
import { createIssueSchema, notifySchema, reportListQuerySchema, reportPatchSchema } from '../../schemas.js';
import { createIssueForReport } from '../../services/issue-actions.js';
import { notifyReport } from '../../services/notify-actions.js';
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

  // Replaces the cahier's /gitlab route: GitLab or GitHub depending on the application.
  app.post('/api/admin/reports/:id/issue', async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const input = createIssueSchema.parse(req.body);
    const result = await createIssueForReport(ctx, id, input);
    if (!result.ok) return reply.code(result.status).send({ error: result.error, message: result.message });
    return buildReportDetail(ctx, id);
  });

  app.post('/api/admin/reports/:id/notify', async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const input = notifySchema.parse(req.body);
    const result = await notifyReport(ctx, id, input);
    if (!result.ok) return reply.code(result.status).send({ error: result.error, message: result.message });
    const { ok: _ok, ...outcome } = result;
    return outcome;
  });
}
