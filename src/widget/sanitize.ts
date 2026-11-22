// Pure functions that strip sensitive data BEFORE anything is stored or sent.

import { LIMITS } from '../shared/types.js';

const SENSITIVE_KEY = /password|passwd|pwd|token|secret|auth|authorization|cookie|csrf|api_key|apikey/i;
const REDACTED = '[REDACTED]';
const MAX_DEPTH = 12;

export function clip(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

/** Recursively replaces the value of every sensitive key by "[REDACTED]". Never mutates the input. */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[too deep]';
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSensitiveKey(key) ? REDACTED : redact(v, depth + 1);
  }
  return out;
}

// Fallback patterns for free text.
// 1. Header-like values may contain spaces ("Authorization: Bearer abc"): mask up to the end of the value.
const INLINE_HEADER = /((?:authorization|cookie|set-cookie)["']?\s*[:=]\s*["']?)([^\r\n"',}&]+)/gi;
// 2. Other secrets are a single token: `password=abc`, `"api_key": "abc"`, `x-csrf-token: abc`.
const INLINE_SECRET =
  /((?:password|passwd|pwd|token|secret|auth|csrf|api_key|apikey)[\w-]*["']?\s*[:=]\s*["']?)([^"'&\s,}]+)/gi;

export function redactText(text: string): string {
  return text.replace(INLINE_HEADER, `$1${REDACTED}`).replace(INLINE_SECRET, `$1${REDACTED}`);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '[unserializable]';
  }
}

/**
 * Cleans a text body (request payload or response): JSON and form-encoded bodies are parsed and
 * redacted key by key, anything else goes through the inline pattern fallback.
 * Truncation happens AFTER parsing so that a long JSON body is still redacted correctly.
 */
export function sanitizeText(text: string, max: number = LIMITS.bodyExcerptChars): string {
  const trimmed = text.length > 200_000 ? text.slice(0, 200_000) : text;
  const start = trimmed.trimStart()[0];
  if (start === '{' || start === '[') {
    try {
      return clip(JSON.stringify(redact(JSON.parse(trimmed))), max);
    } catch {
      /* truncated or invalid JSON: fall through to the text fallback */
    }
  }
  if (/^[^=&\s]+=[^\s]*$/.test(trimmed.trim()) && !trimmed.includes('\n')) {
    try {
      const params = new URLSearchParams(trimmed.trim());
      return clip(safeJson(redact(Object.fromEntries(params.entries()))), max);
    } catch {
      /* ignore */
    }
  }
  return clip(redactText(trimmed), max);
}

/** Cleans any value that can be passed as a fetch / XHR body. Returns undefined when there is none. */
export function sanitizeBody(body: unknown, max: number = LIMITS.bodyExcerptChars): string | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === 'string') return body === '' ? undefined : sanitizeText(body, max);
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    const obj: Record<string, unknown> = {};
    body.forEach((value, key) => {
      obj[key] = typeof value === 'string' ? value : `[File ${(value as File).name}]`;
    });
    return clip(safeJson(redact(obj)), max);
  }
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
    return clip(safeJson(redact(Object.fromEntries(body.entries()))), max);
  }
  if (
    (typeof Blob !== 'undefined' && body instanceof Blob) ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body)
  ) {
    return '[binary]';
  }
  if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) return '[stream]';
  if (typeof Document !== 'undefined' && body instanceof Document) return '[document]';
  if (typeof body === 'object') return clip(safeJson(redact(body)), max);
  return clip(String(body), max);
}

/**
 * Masks the value of sensitive query parameters (`?token=...`) in a URL.
 * By default same-origin URLs are reduced to path + query + hash (compact breadcrumbs), other URLs are
 * kept whole. With `keepOrigin` the full URL is always returned (used for the report's page URL).
 */
export function sanitizeUrl(raw: string, max = 300, keepOrigin = false): string {
  try {
    const url = new URL(raw, location.href);
    for (const key of [...url.searchParams.keys()]) {
      if (isSensitiveKey(key)) url.searchParams.set(key, REDACTED);
    }
    const sameOrigin = url.origin === location.origin && !keepOrigin;
    const text = sameOrigin ? url.pathname + url.search + url.hash : url.href;
    return clip(decodeURIComponent(text), max);
  } catch {
    return clip(redactText(raw), max);
  }
}
