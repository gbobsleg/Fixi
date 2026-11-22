import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { PROJECT_ROOT } from '../../paths.js';

const WIDGET_PATH = resolve(PROJECT_ROOT, 'dist/public/widget.js');

/** Serves the bundled widget. The bundle itself is produced in lot 2 (`npm run build`). */
export function registerWidgetRoute(app: FastifyInstance): void {
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
}
