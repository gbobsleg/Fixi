import { z } from 'zod';
import { CATEGORIES, JS_ERROR_SOURCES, LIMITS, NAV_KINDS } from '../shared/types.js';

/** String that is silently truncated (never rejected) when too long. */
const clip = (max: number) => z.string().transform((v) => v.slice(0, max));

const navEvent = z.object({
  t: z.number(),
  type: z.literal('nav'),
  url: clip(300),
  kind: z.enum(NAV_KINDS),
});

const clickEvent = z.object({
  t: z.number(),
  type: z.literal('click'),
  selector: clip(200),
  text: clip(50).optional(),
});

const netEvent = z.object({
  t: z.number(),
  type: z.literal('net'),
  method: clip(10),
  url: clip(300),
  status: z.number().int().min(0).max(999),
  durationMs: z.number().min(0),
  requestId: clip(100).optional(),
  requestBody: clip(LIMITS.bodyExcerptChars).optional(),
  responseBody: clip(LIMITS.bodyExcerptChars).optional(),
});

const jsErrorEvent = z.object({
  t: z.number(),
  type: z.literal('js_error'),
  source: z.enum(JS_ERROR_SOURCES),
  message: clip(300),
  file: clip(300).optional(),
  line: z.number().int().optional(),
  col: z.number().int().optional(),
  stack: clip(1000).optional(),
});

const timelineEvent = z.discriminatedUnion('type', [navEvent, clickEvent, netEvent, jsErrorEvent]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Payload of POST /api/reports (the `payload` multipart field). */
export const reportPayloadSchema = z.object({
  app: z.string().min(1).max(100),
  apiKey: z.string().min(1).max(200),
  user: clip(200).default(''),
  // A malformed e-mail must not reject the whole report: it is simply dropped.
  userEmail: z
    .string()
    .max(254)
    .optional()
    .transform((v) => (v && EMAIL_RE.test(v) ? v : undefined)),
  version: clip(100).optional(),
  category: z.enum(CATEGORIES).default('bug'),
  comment: clip(5000).default(''),
  url: clip(2000).default(''),
  viewport: clip(30).default(''),
  userAgent: clip(500).default(''),
  // Invalid or missing dates fall back to the server time.
  clientCreatedAt: z
    .string()
    .optional()
    .transform((v) => {
      const ms = v ? Date.parse(v) : NaN;
      return new Date(Number.isNaN(ms) ? Date.now() : ms).toISOString();
    }),
  timeline: z.array(timelineEvent).max(LIMITS.timelineMaxEvents).default([]),
});

export type ParsedReportPayload = z.infer<typeof reportPayloadSchema>;

const isValidOrigin = (value: string): boolean => {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
};

/** Accepts `https://host:port` (a trailing slash is tolerated) and normalizes it. */
const originSchema = z
  .string()
  .refine(isValidOrigin, 'must be a valid http(s) origin, e.g. https://shifti.interne')
  .transform((v) => new URL(v).origin);

export const appInputSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'only lowercase letters, digits and dashes'),
  name: z.string().trim().min(1).max(100),
  allowed_origins: z
    .array(originSchema)
    .max(50)
    .default([])
    .transform((list) => [...new Set(list)]),
  issue_provider: z.enum(['gitlab', 'github']).nullable().default(null),
  issue_project: z.string().trim().max(200).nullable().default(null),
  issue_default_labels: z.string().trim().max(300).nullable().default(null),
  issue_anonymize: z.boolean().default(false),
});

export const loginSchema = z.object({
  username: z.string().min(1).max(200),
  password: z.string().min(1).max(500),
});
