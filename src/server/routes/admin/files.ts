import { createReadStream } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../context.js';
import { findReportByFile } from '../../repositories/reports.js';

const CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  csv: 'text/csv; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
};
const INLINE_EXTENSIONS = new Set(['png', 'jpg', 'gif', 'webp']);

/** RFC 5987 encoding so that accented or quoted names survive in Content-Disposition. */
function contentDisposition(type: 'inline' | 'attachment', filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export function registerAdminFileRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get<{ Params: { name: string }; Querystring: { download?: string } }>(
    '/api/admin/files/:name',
    async (req, reply) => {
      const { name } = req.params;
      const path = ctx.storage.pathFor(name); // null when the name does not match <uuid>.<ext>
      if (!path || !(await ctx.storage.exists(name))) {
        return reply.code(404).send({ error: 'not_found' });
      }

      const ext = name.slice(name.lastIndexOf('.') + 1);
      const owner = findReportByFile(ctx.db, name);
      const isAttachment = owner?.attachment_path === name;
      const downloadName = isAttachment && owner.attachment_original_name ? owner.attachment_original_name : name;
      const inline = INLINE_EXTENSIONS.has(ext) && req.query.download !== '1';

      reply
        .header('Content-Type', CONTENT_TYPES[ext] ?? 'application/octet-stream')
        .header('X-Content-Type-Options', 'nosniff')
        .header('Content-Security-Policy', "default-src 'none'; sandbox")
        .header('Cache-Control', 'private, max-age=0, no-store')
        .header('Content-Disposition', contentDisposition(inline ? 'inline' : 'attachment', downloadName));
      return reply.send(createReadStream(path));
    },
  );
}
