// Types shared between the widget (browser) and the server.
// Keep this file free of any runtime dependency: it is bundled into widget.js.

export const CATEGORIES = ['bug', 'blocking', 'suggestion'] as const;
export type Category = (typeof CATEGORIES)[number];

export const STATUSES = ['new', 'in_progress', 'sent', 'resolved', 'rejected', 'duplicate'] as const;
export type Status = (typeof STATUSES)[number];

export const NAV_KINDS = ['load', 'push', 'replace', 'pop', 'hash'] as const;
export type NavKind = (typeof NAV_KINDS)[number];

export const JS_ERROR_SOURCES = ['error', 'unhandledrejection', 'console'] as const;
export type JsErrorSource = (typeof JS_ERROR_SOURCES)[number];

/** `t` is always a timestamp in milliseconds since the epoch. */
export interface NavEvent {
  t: number;
  type: 'nav';
  url: string;
  kind: NavKind;
}

export interface ClickEvent {
  t: number;
  type: 'click';
  selector: string;
  text?: string;
}

export interface NetEvent {
  t: number;
  type: 'net';
  method: string;
  url: string;
  /** 0 means a network error (no HTTP response). */
  status: number;
  durationMs: number;
  requestId?: string;
  requestBody?: string;
  responseBody?: string;
}

export interface JsErrorEvent {
  t: number;
  type: 'js_error';
  source: JsErrorSource;
  message: string;
  file?: string;
  line?: number;
  col?: number;
  stack?: string;
}

export type TimelineEvent = NavEvent | ClickEvent | NetEvent | JsErrorEvent;

/** JSON sent by the widget in the `payload` field of POST /api/reports. */
export interface ReportPayload {
  app: string;
  apiKey: string;
  user: string;
  userEmail?: string;
  version?: string;
  category: Category;
  comment: string;
  url: string;
  viewport: string;
  userAgent: string;
  /** ISO 8601 */
  clientCreatedAt: string;
  timeline: TimelineEvent[];
}

/** Default color of the widget (tab, buttons, focus): the teal of Shifti and Flowi. */
export const DEFAULT_WIDGET_COLOR = '#318f9b';

/** A widget color as stored and sent: `#rrggbb`. */
export const WIDGET_COLOR_RE = /^#[0-9a-f]{6}$/i;

/** Hard limits shared by widget and server. */
export const LIMITS = {
  timelineMaxEvents: 40,
  maxFileBytes: 5 * 1024 * 1024,
  bodyExcerptChars: 500,
} as const;
