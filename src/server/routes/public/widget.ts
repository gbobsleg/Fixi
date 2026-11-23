import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DEFAULT_WIDGET_COLOR } from '../../../shared/types.js';
import type { AppContext } from '../../context.js';
import { PROJECT_ROOT } from '../../paths.js';
import { getAppBySlug } from '../../repositories/apps.js';

export const WIDGET_CONFIG_PATH = '/api/widget/config';
const configQuery = z.object({ app: z.string().max(50).default('') });

const WIDGET_PATH = resolve(PROJECT_ROOT, 'dist/public/widget.js');

/** Serves the bundled widget. The bundle itself is produced in lot 2 (`npm run build`). */
export function registerWidgetRoute(app: FastifyInstance, ctx: AppContext): void {
  app.get('/widget.js', async (_req, reply) => {
    try {
      const body = await readFile(WIDGET_PATH);
      return reply
        .header('Content-Type', 'application/javascript; charset=utf-8')
        .header('Cache-Control', 'public, max-age=300')
        .send(body);
    } catch {
      return reply
        .code(404)
        .header('Content-Type', 'application/javascript; charset=utf-8')
        .send('/* Fixi widget not built yet */');
    }
  });

  /**
   * Display settings of the widget for one application (today: its color). Public and without API key:
   * nothing here is secret. The real value is only given to a page whose Origin is allowed for THIS
   * application; any other caller (unknown app, other site) gets the default, with the same 200, so that
   * the answer never tells which applications exist. CORS headers: plugins/public-cors.ts.
   */
  app.get(WIDGET_CONFIG_PATH, async (req, reply) => {
    const parsed = configQuery.safeParse(req.query);
    const target = parsed.success ? getAppBySlug(ctx.db, parsed.data.app) : undefined;
    const origin = req.headers.origin;
    const allowed = !!target && !!origin && target.allowed_origins.includes(origin);
    return reply
      .header('Cache-Control', 'public, max-age=300')
      .header('Vary', 'Origin')
      .send({ color: allowed ? target.widget_color : DEFAULT_WIDGET_COLOR });
  });
}
