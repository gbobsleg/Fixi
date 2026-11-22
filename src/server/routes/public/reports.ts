import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../context.js';
import { getAppBySlug } from '../../repositories/apps.js';
import { insertReport } from '../../repositories/reports.js';
import { reportPayloadSchema } from '../../schemas.js';
import { safeEqual } from '../../security.js';
import { notifyNewReport } from '../../services/notifications.js';
import { analyzeTimeline } from '../../services/timeline-analysis.js';
import {
  sanitizeOriginalName,
  UploadError,
  validateAttachment,
  validateScreenshot,
  type ValidatedFile,
} from '../../services/upload-validation.js';

export function registerReportRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post(
    '/api/reports',
    { config: { rateLimit: { max: ctx.config.rateLimit.reportsPerMin, timeWindow: '1 minute' } } },
    async (req, reply) => {
      if (!req.isMultipart()) return reply.code(400).send({ error: 'multipart_required' });

      // 1. Read the multipart body. A file over the size limit makes toBuffer() throw a 413.
      let payloadRaw: string | undefined;
      let screenshotBuf: Buffer | undefined;
      let attachment: { buffer: Buffer; filename: string } | undefined;

      for await (const part of req.parts()) {
        if (part.type === 'file') {
          const buffer = await part.toBuffer();
          if (buffer.length === 0) continue;
          if (part.fieldname === 'screenshot') screenshotBuf = buffer;
          else if (part.fieldname === 'attachment') attachment = { buffer, filename: part.filename };
        } else if (part.fieldname === 'payload' && typeof part.value === 'string') {
          if (part.valueTruncated) return reply.code(413).send({ error: 'payload_too_large' });
          payloadRaw = part.value;
        }
      }
      if (!payloadRaw) return reply.code(400).send({ error: 'payload_missing' });

      let json: unknown;
      try {
        json = JSON.parse(payloadRaw);
      } catch {
        return reply.code(400).send({ error: 'payload_invalid_json' });
      }
      const payload = reportPayloadSchema.parse(json);

      // 2. Application + API key (same answer whether the slug or the key is wrong).
      const target = getAppBySlug(ctx.db, payload.app);
      if (!target || !safeEqual(payload.apiKey, target.api_key)) {
        return reply.code(401).send({ error: 'invalid_credentials' });
      }

      // 3. The browser origin must be allowed for THIS application.
      const origin = req.headers.origin;
      if (!origin || !target.allowed_origins.includes(origin)) {
        return reply.code(403).send({ error: 'origin_not_allowed' });
      }

      // 4. Files: real content type and size.
      let screenshotInfo: ValidatedFile | undefined;
      let attachmentInfo: ValidatedFile | undefined;
      try {
        if (screenshotBuf) screenshotInfo = await validateScreenshot(screenshotBuf);
        if (attachment) attachmentInfo = await validateAttachment(attachment.buffer, attachment.filename);
      } catch (err) {
        if (err instanceof UploadError) {
          return reply
            .code(err.code === 'too_large' ? 413 : 400)
            .send({ error: err.code === 'too_large' ? 'file_too_large' : 'invalid_file', message: err.message });
        }
        throw err;
      }

      // 5. A comment is mandatory unless a screenshot is attached.
      if (!screenshotBuf && payload.comment.trim() === '') {
        return reply.code(400).send({ error: 'comment_required' });
      }

      // 6. Store the files, then the report (files are removed again if the insert fails).
      const stored: string[] = [];
      try {
        const screenshotPath =
          screenshotBuf && screenshotInfo ? await ctx.storage.save(screenshotBuf, screenshotInfo.ext) : null;
        if (screenshotPath) stored.push(screenshotPath);
        const attachmentPath =
          attachment && attachmentInfo ? await ctx.storage.save(attachment.buffer, attachmentInfo.ext) : null;
        if (attachmentPath) stored.push(attachmentPath);

        const analysis = analyzeTimeline(payload.timeline);
        const id = insertReport(ctx.db, {
          app_id: target.id,
          category: payload.category,
          comment: payload.comment,
          user_info: payload.user,
          user_email: payload.userEmail ?? null,
          app_version: payload.version ?? null,
          url: payload.url,
          user_agent: payload.userAgent,
          viewport: payload.viewport,
          client_created_at: payload.clientCreatedAt,
          screenshot_path: screenshotPath,
          attachment_path: attachmentPath,
          attachment_original_name: attachment ? sanitizeOriginalName(attachment.filename) : null,
          attachment_mime: attachmentInfo?.mime ?? null,
          timeline: payload.timeline,
          has_http_error: analysis.hasHttpError,
          max_http_status: analysis.maxHttpStatus,
          has_js_error: analysis.hasJsError,
        });

        reply.code(201).send({ id });

        // Admin alert: fire-and-forget, never allowed to fail the request.
        setImmediate(() => {
          notifyNewReport(ctx, id).catch((err) => req.log.error({ err }, 'admin alert failed'));
        });
        return reply;
      } catch (err) {
        await Promise.all(stored.map((name) => ctx.storage.remove(name).catch(() => false)));
        throw err;
      }
    },
  );
}
